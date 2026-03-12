import hashlib
import os
import re
import uuid
from datetime import datetime, UTC
from pathlib import Path
from typing import Optional, List, Dict, Any

import httpx
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
import asyncio
import json

from backend.app.database.connection import get_db
from backend.app.database.models import Paper, Tooltip
from backend.app.database.models import TooltipSuggestion as TooltipSuggestionModel
from backend.app.compiler.latexml_compiler import compile_latex_to_html, CompilationResult
from backend.app.llm import (
    AIConfig,
    TASK_HTML_INJECTION,
    TASK_KNOWLEDGE_GRAPH,
    TASK_TOOLTIP_FILTER,
    check_openrouter_models,
    get_ai_capabilities,
    validate_ai_config,
)

app = FastAPI(title="Scholar Agent API")
app.add_middleware(
    CORSMiddleware,
    # Allow any HTTP/HTTPS origin so direct backend SSE connections work when the
    # frontend is accessed via LAN IP, hostname, or any non-localhost address.
    allow_origin_regex=r"https?://.*",
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {"status": "ok"}


# Storage directories (absolute paths relative to project root)
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent  # backend/app/api/main.py -> project root
UPLOADS_DIR = PROJECT_ROOT / "storage" / "uploads"
ASSETS_DIR = PROJECT_ROOT / "storage" / "assets"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

# Knowledge graph build progress tracking
# Format: {paper_id: {stage: str, progress: {stage_name: {current: int, total: int}}}}
kg_build_progress: Dict[str, Dict[str, Any]] = {}

# Compilation progress tracking
# Format: {paper_id: {stage: str, message: str}} or {stage: "error", error: str}
compile_progress: Dict[str, Dict[str, Any]] = {}

# Configuration
USE_DOCKER = os.getenv("LATEXML_USE_DOCKER", "true").lower() == "true"


def _validate_request_ai_config(
    ai_config: AIConfig | dict[str, Any] | None,
    *,
    tasks: tuple[str, ...],
) -> None:
    try:
        validate_ai_config(ai_config, tasks=tasks)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# =============================================================================
# Pydantic Models
# =============================================================================

class PaperResponse(BaseModel):
    id: str
    filename: str
    arxiv_id: Optional[str] = None
    uploaded_at: datetime
    compiled_at: Optional[datetime] = None
    has_html: bool

    class Config:
        from_attributes = True


class PaperDetailResponse(PaperResponse):
    html_content: Optional[str] = None
    # Pre-extracted metadata for frontend and agents
    sections: Optional[List[Dict[str, Any]]] = None
    equations: Optional[List[Dict[str, Any]]] = None
    citations: Optional[List[Dict[str, Any]]] = None
    paper_metadata: Optional[Dict[str, Any]] = None
    has_knowledge_graph: bool = False


class TooltipCreate(BaseModel):
    dom_node_id: str
    target_text: Optional[str] = None
    content: str


class TooltipUpdate(BaseModel):
    target_text: Optional[str] = None
    content: str
    is_pinned: Optional[bool] = None
    display_order: Optional[int] = None


class TooltipResponse(BaseModel):
    id: str
    paper_id: str
    dom_node_id: Optional[str] = None  # Nullable for semantic tooltips (entity_id set instead)
    entity_id: Optional[str] = None  # For semantic tooltips linked to KG entities
    user_id: str
    target_text: Optional[str] = None
    content: str
    is_pinned: bool
    display_order: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# Tooltip Suggestion Models (Phase 2)

class TooltipSuggestionRequest(BaseModel):
    """Request for tooltip suggestions based on knowledge graph"""
    user_expertise: str  # Free-form text describing reader's background/expertise
    entity_types: Optional[List[str]] = None  # Optional filter: ["symbol", "definition", "theorem"]
    ai_config: Optional[AIConfig] = None


class OccurrenceData(BaseModel):
    """A single occurrence of an entity in the document"""
    section_id: str
    dom_node_id: str
    char_offset: int
    length: int
    snippet: str


class TooltipSuggestion(BaseModel):
    """A suggested tooltip for an entity"""
    entity_id: str
    entity_label: str
    entity_type: str
    tooltip_content: str
    occurrences: List[OccurrenceData]


class TooltipSuggestionResponse(BaseModel):
    """Response from tooltip suggestion endpoint"""
    suggestions: List[TooltipSuggestion]
    total_entities: int
    suggested_count: int


# Stored Tooltip Suggestion Models

class StoredSuggestionResponse(BaseModel):
    """Response for a stored tooltip suggestion"""
    id: str
    paper_id: str
    entity_id: Optional[str]
    entity_label: str
    entity_type: str
    tooltip_content: str
    is_ai_generated: bool
    created_at: datetime

    class Config:
        from_attributes = True


class CreateManualSuggestionRequest(BaseModel):
    """Request to create a manual tooltip suggestion"""
    entity_label: str
    entity_type: str  # symbol, definition, theorem, other
    tooltip_content: str


# Tooltip Application Models (Phase 3)

class TooltipApplicationRequest(BaseModel):
    """Request to apply suggested tooltips by injecting spans into HTML"""
    suggestions: List[TooltipSuggestion]
    ai_config: Optional[AIConfig] = None


class TooltipApplicationResponse(BaseModel):
    """Response from tooltip application endpoint"""
    success: bool
    spans_injected: int
    tooltips_created: int
    errors: List[str]


class KnowledgeGraphBuildRequest(BaseModel):
    """Optional request-scoped AI settings for graph construction."""

    ai_config: Optional[AIConfig] = None


class OpenRouterModelCheckRequest(BaseModel):
    """Request to validate one or more OpenRouter model ids."""

    models: List[str]


# =============================================================================
# Root
# =============================================================================

@app.get("/")
async def root():
    return {"message": "Scholar Agent API - LaTeX-first MVP"}


@app.get("/api/ai/capabilities")
async def get_ai_capabilities_endpoint():
    """Return configured AI providers and fixed server-side model defaults."""
    return get_ai_capabilities()


@app.post("/api/ai/openrouter/check-models")
async def check_openrouter_models_endpoint(request: OpenRouterModelCheckRequest):
    """Validate OpenRouter models against the live OpenRouter model catalog."""
    try:
        return {"results": check_openrouter_models(request.models)}
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to validate OpenRouter models: {exc}",
        ) from exc


# =============================================================================
# Paper Management
# =============================================================================

@app.post("/api/papers/upload", response_model=PaperResponse)
async def upload_paper(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    compile_now: bool = Form(default=True),
    db: Session = Depends(get_db)
):
    """Upload a .tar.gz LaTeX source archive and start async compilation."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="File must have a name")

    archive_type = _get_archive_type(file.filename)
    if not archive_type:
        raise HTTPException(
            status_code=400,
            detail="Only .tar.gz, .tgz, .tar, or .zip archives are supported"
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="File is empty")

    file_hash = hashlib.sha256(data).hexdigest()
    upload_ext = ".tar.gz" if archive_type == "tar" else ".zip"
    upload_path = UPLOADS_DIR / f"{file_hash}{upload_ext}"

    # Check if paper already exists
    existing = db.query(Paper).filter(Paper.id == file_hash).first()
    if existing:
        return _paper_to_response(existing)

    # Save upload
    if not upload_path.exists():
        with open(upload_path, "wb") as handle:
            handle.write(data)

    # Create paper record (without HTML — compilation happens in background)
    paper = Paper(
        id=file_hash,
        filename=file.filename,
        uploaded_at=datetime.now(UTC)
    )
    db.add(paper)
    db.commit()
    db.refresh(paper)

    if compile_now:
        compile_progress[file_hash] = {"stage": "starting", "message": "Starting LaTeXML..."}
        background_tasks.add_task(_run_compile_task, file_hash, str(upload_path))

    return _paper_to_response(paper)


@app.post("/api/papers/upload/arxiv", response_model=PaperResponse)
async def upload_arxiv_source(
    background_tasks: BackgroundTasks,
    url_or_id: str = Form(...),
    compile_now: bool = Form(default=True),
    db: Session = Depends(get_db)
):
    """Download arXiv source and start async compilation."""
    arxiv_id = _extract_arxiv_id(url_or_id)
    if not arxiv_id:
        raise HTTPException(status_code=400, detail="Invalid arXiv URL or ID")

    file_hash, archive_path = await _download_arxiv_source(arxiv_id)

    # Check if paper already exists
    existing = db.query(Paper).filter(Paper.id == file_hash).first()
    if existing:
        return _paper_to_response(existing)

    # Create paper record (without HTML — compilation happens in background)
    paper = Paper(
        id=file_hash,
        filename=f"arXiv:{arxiv_id}",
        arxiv_id=arxiv_id,
        uploaded_at=datetime.now(UTC)
    )
    db.add(paper)
    db.commit()
    db.refresh(paper)

    if compile_now:
        compile_progress[file_hash] = {"stage": "starting", "message": "Starting LaTeXML..."}
        background_tasks.add_task(_run_compile_task, file_hash, str(archive_path))

    return _paper_to_response(paper)


@app.post("/api/papers/{paper_id}/compile", response_model=PaperResponse)
async def compile_paper(paper_id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Trigger async compilation for an uploaded paper."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    source_path = _find_source_file(paper_id)
    if not source_path:
        raise HTTPException(status_code=404, detail="Source file not found")

    if paper_id in compile_progress and compile_progress[paper_id].get("stage") not in ("complete", "error"):
        raise HTTPException(status_code=409, detail="Compilation already in progress")

    compile_progress[paper_id] = {"stage": "starting", "message": "Starting LaTeXML..."}
    background_tasks.add_task(_run_compile_task, paper_id, str(source_path))

    return _paper_to_response(paper)


@app.get("/api/papers", response_model=list[PaperResponse])
async def list_papers(db: Session = Depends(get_db)):
    """List all papers."""
    papers = db.query(Paper).order_by(Paper.uploaded_at.desc()).all()
    return [_paper_to_response(p) for p in papers]


@app.get("/api/papers/{paper_id}", response_model=PaperDetailResponse)
async def get_paper(paper_id: str, db: Session = Depends(get_db)):
    """Get paper with compiled HTML and pre-extracted metadata."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    return PaperDetailResponse(
        id=paper.id,
        filename=paper.filename,
        arxiv_id=paper.arxiv_id,
        uploaded_at=paper.uploaded_at,
        compiled_at=paper.compiled_at,
        has_html=paper.html_content is not None,
        html_content=paper.html_content,
        # Pre-extracted metadata for frontend and agents
        sections=paper.sections_data,
        equations=paper.equations_data,
        citations=paper.citations_data,
        paper_metadata=paper.paper_metadata,
        has_knowledge_graph=paper.knowledge_graph is not None,
    )


@app.delete("/api/papers/{paper_id}")
async def delete_paper(paper_id: str, db: Session = Depends(get_db)):
    """Delete a paper and all associated tooltips."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    # Delete source files
    deleted_files = []
    for ext in [".tar.gz", ".tgz", ".tar", ".zip"]:
        path = UPLOADS_DIR / f"{paper_id}{ext}"
        if path.exists():
            path.unlink()
            deleted_files.append(str(path))

    # Delete assets directory
    assets_path = ASSETS_DIR / paper_id
    if assets_path.exists():
        import shutil
        shutil.rmtree(assets_path)
        deleted_files.append(str(assets_path))

    # Delete from database (cascades to tooltips)
    db.delete(paper)
    db.commit()

    return {"status": "success", "paper_id": paper_id, "deleted_files": deleted_files}


@app.get("/api/papers/{paper_id}/assets/{filename}")
async def get_paper_asset(paper_id: str, filename: str):
    """Serve a paper's compiled asset (images, CSS, etc.)."""
    asset_path = ASSETS_DIR / paper_id / filename

    if not asset_path.exists() or not asset_path.is_file():
        raise HTTPException(status_code=404, detail="Asset not found")

    # Security check: ensure path is within assets directory
    try:
        asset_path = asset_path.resolve()
        assets_base = (ASSETS_DIR / paper_id).resolve()
        if not str(asset_path).startswith(str(assets_base)):
            raise HTTPException(status_code=403, detail="Access denied")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")

    return FileResponse(asset_path)


# =============================================================================
# Tooltip Management
# =============================================================================

@app.get("/api/papers/{paper_id}/tooltips", response_model=list[TooltipResponse])
async def get_tooltips(paper_id: str, db: Session = Depends(get_db)):
    """Get all tooltips for a paper."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    tooltips = db.query(Tooltip).filter(Tooltip.paper_id == paper_id).all()
    return tooltips


@app.get("/api/papers/{paper_id}/tooltips/comments", response_model=list[TooltipResponse])
async def get_comment_tooltips(paper_id: str, db: Session = Depends(get_db)):
    """Get comment tooltips (DOM-based, not entity-based) for a paper."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    # Comments have dom_node_id set and entity_id is None
    tooltips = db.query(Tooltip).filter(
        Tooltip.paper_id == paper_id,
        Tooltip.dom_node_id.isnot(None),
        Tooltip.entity_id.is_(None)
    ).all()
    return tooltips


@app.get("/api/papers/{paper_id}/tooltips/glossary", response_model=list[TooltipResponse])
async def get_glossary_tooltips(paper_id: str, db: Session = Depends(get_db)):
    """Get glossary tooltips (entity-based) for a paper."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    # Glossary entries have entity_id set
    tooltips = db.query(Tooltip).filter(
        Tooltip.paper_id == paper_id,
        Tooltip.entity_id.isnot(None)
    ).all()
    return tooltips


@app.post("/api/papers/{paper_id}/tooltips", response_model=TooltipResponse)
async def create_tooltip(
    paper_id: str,
    tooltip: TooltipCreate,
    db: Session = Depends(get_db)
):
    """Create a new tooltip anchored to a DOM node. Supports multiple annotations per node."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    # Create new tooltip (allow multiple per node now)
    new_tooltip = Tooltip(
        id=str(uuid.uuid4()),
        paper_id=paper_id,
        dom_node_id=tooltip.dom_node_id,
        target_text=tooltip.target_text,
        content=tooltip.content,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC)
    )

    db.add(new_tooltip)
    db.commit()
    db.refresh(new_tooltip)

    return new_tooltip


@app.put("/api/papers/{paper_id}/tooltips/{tooltip_id}", response_model=TooltipResponse)
async def update_tooltip(
    paper_id: str,
    tooltip_id: str,
    tooltip: TooltipUpdate,
    db: Session = Depends(get_db)
):
    """Update an existing tooltip."""
    existing = db.query(Tooltip).filter(
        Tooltip.id == tooltip_id,
        Tooltip.paper_id == paper_id
    ).first()

    if not existing:
        raise HTTPException(status_code=404, detail="Tooltip not found")

    if tooltip.target_text is not None:
        existing.target_text = tooltip.target_text
    existing.content = tooltip.content
    if tooltip.is_pinned is not None:
        existing.is_pinned = tooltip.is_pinned
    if tooltip.display_order is not None:
        existing.display_order = tooltip.display_order
    existing.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(existing)

    return existing


@app.delete("/api/papers/{paper_id}/tooltips/{tooltip_id}")
async def delete_tooltip(paper_id: str, tooltip_id: str, db: Session = Depends(get_db)):
    """
    Delete a tooltip and remove its spans from HTML.

    For semantic tooltips (with entity_id), this removes all <span> tags
    with matching data-entity-id from the compiled HTML.
    """
    existing = db.query(Tooltip).filter(
        Tooltip.id == tooltip_id,
        Tooltip.paper_id == paper_id
    ).first()

    if not existing:
        raise HTTPException(status_code=404, detail="Tooltip not found")

    # If this is a semantic tooltip with entity_id, remove its spans from HTML
    if existing.entity_id:
        from backend.app.compiler.html_injection import remove_tooltip_spans

        paper = db.query(Paper).filter(Paper.id == paper_id).first()
        if paper and paper.html_content:
            print(f"[Delete Tooltip] Removing spans for entity {existing.entity_id} from paper {paper_id}")
            modified_html = remove_tooltip_spans(paper.html_content, existing.entity_id)
            paper.html_content = modified_html

    db.delete(existing)
    db.commit()

    return {"status": "success", "tooltip_id": tooltip_id}


@app.delete("/api/papers/{paper_id}/tooltips/{tooltip_id}/occurrences/{dom_node_id}")
async def remove_tooltip_occurrence(
    paper_id: str,
    tooltip_id: str,
    dom_node_id: str,
    db: Session = Depends(get_db)
):
    """
    Remove a single occurrence of a tooltip span from a specific DOM node.

    This removes only the span within the specified dom_node_id, leaving other
    occurrences of the same tooltip intact.
    """
    tooltip = db.query(Tooltip).filter(
        Tooltip.id == tooltip_id,
        Tooltip.paper_id == paper_id
    ).first()

    if not tooltip:
        raise HTTPException(status_code=404, detail="Tooltip not found")

    # Only works for semantic tooltips with entity_id
    if not tooltip.entity_id:
        raise HTTPException(
            status_code=400,
            detail="Can only remove occurrences from semantic tooltips (with entity_id)"
        )

    from backend.app.compiler.html_injection import remove_single_tooltip_span

    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper or not paper.html_content:
        raise HTTPException(status_code=404, detail="Paper HTML not found")

    print(f"[Remove Occurrence] Removing span for entity {tooltip.entity_id} from node {dom_node_id}")
    modified_html = remove_single_tooltip_span(
        paper.html_content,
        tooltip.entity_id,
        dom_node_id
    )
    paper.html_content = modified_html
    db.commit()

    return {
        "status": "success",
        "tooltip_id": tooltip_id,
        "dom_node_id": dom_node_id
    }


@app.post("/api/papers/{paper_id}/tooltips/suggest", response_model=TooltipSuggestionResponse)
async def suggest_tooltips_endpoint(
    paper_id: str,
    request: TooltipSuggestionRequest,
    db: Session = Depends(get_db)
):
    """
    Suggest tooltips based on knowledge graph and user expertise.

    This endpoint:
    1. Loads the knowledge graph from the paper
    2. Filters entities based on user expertise level
    3. Generates tooltip content from KG data
    4. Returns suggestions with occurrence positions

    Args:
        paper_id: ID of the paper
        request: Contains user_expertise (free-form text) and optional entity_types filter

    Returns:
        TooltipSuggestionResponse with:
        - suggestions: List of suggested tooltips with occurrences
        - total_entities: Total count in KG
        - suggested_count: Count after filtering
    """
    from backend.app.agents.tooltip_suggestion import suggest_tooltips

    # Load paper and verify it exists
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    # Check if knowledge graph exists
    if not paper.knowledge_graph:
        raise HTTPException(
            status_code=400,
            detail="Knowledge graph not built. Please build the knowledge graph first."
        )

    # user_expertise is free-form text passed to LLM - no validation needed

    # Validate entity types filter if provided
    if request.entity_types:
        valid_types = ["symbol", "definition", "theorem"]
        invalid_types = [t for t in request.entity_types if t not in valid_types]
        if invalid_types:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid entity types: {', '.join(invalid_types)}. Must be one of: {', '.join(valid_types)}"
            )

    _validate_request_ai_config(request.ai_config, tasks=(TASK_TOOLTIP_FILTER,))

    try:
        # Call suggestion agent
        result = suggest_tooltips(
            knowledge_graph=paper.knowledge_graph,
            user_expertise=request.user_expertise,
            entity_type_filter=request.entity_types,
            ai_config=request.ai_config,
        )

        # Cache the suggestions for later use by the apply endpoint
        paper.tooltip_suggestions_cache = {
            "expertise": request.user_expertise,
            "entity_types": request.entity_types,
            "suggestions": result.get("suggestions", []),
            "total_entities": result.get("total_entities", 0),
            "generated_at": datetime.now(UTC).isoformat()
        }

        # Clear existing AI suggestions for this paper (keep manual ones)
        db.query(TooltipSuggestionModel).filter(
            TooltipSuggestionModel.paper_id == paper_id,
            TooltipSuggestionModel.is_ai_generated == True
        ).delete()

        # Store new AI suggestions in database
        for suggestion in result.get("suggestions", []):
            stored_suggestion = TooltipSuggestionModel(
                id=str(uuid.uuid4()),
                paper_id=paper_id,
                entity_id=suggestion.get("entity_id"),
                entity_label=suggestion.get("entity_label"),
                entity_type=suggestion.get("entity_type"),
                tooltip_content=suggestion.get("tooltip_content"),
                is_ai_generated=True,
            )
            db.add(stored_suggestion)

        db.commit()

        return TooltipSuggestionResponse(**result)

    except Exception as e:
        # Log error and return helpful message
        print(f"Error suggesting tooltips: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to suggest tooltips: {str(e)}"
        )


# =============================================================================
# Stored Tooltip Suggestions Endpoints
# =============================================================================

@app.get("/api/papers/{paper_id}/suggestions", response_model=List[StoredSuggestionResponse])
async def get_stored_suggestions(
    paper_id: str,
    db: Session = Depends(get_db)
):
    """
    Get all stored tooltip suggestions for a paper (both AI and manual).

    Returns suggestions sorted by creation date.
    """
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    suggestions = db.query(TooltipSuggestionModel).filter(
        TooltipSuggestionModel.paper_id == paper_id
    ).order_by(TooltipSuggestionModel.created_at.desc()).all()

    return suggestions


@app.post("/api/papers/{paper_id}/suggestions/manual", response_model=StoredSuggestionResponse)
async def create_manual_suggestion(
    paper_id: str,
    request: CreateManualSuggestionRequest,
    db: Session = Depends(get_db)
):
    """
    Create a manual tooltip suggestion.

    Users can add custom tooltip suggestions that will appear alongside AI suggestions.
    """
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    suggestion_id = str(uuid.uuid4())
    # Give manual suggestions a special entity_id with "manual_" prefix
    manual_entity_id = f"manual_{suggestion_id}"

    suggestion = TooltipSuggestionModel(
        id=suggestion_id,
        paper_id=paper_id,
        entity_id=manual_entity_id,  # Manual suggestions get special entity_id
        entity_label=request.entity_label,
        entity_type=request.entity_type,
        tooltip_content=request.tooltip_content,
        is_ai_generated=False,
    )

    db.add(suggestion)
    db.commit()
    db.refresh(suggestion)

    return suggestion


@app.delete("/api/papers/{paper_id}/suggestions/{suggestion_id}")
async def delete_suggestion(
    paper_id: str,
    suggestion_id: str,
    db: Session = Depends(get_db)
):
    """Delete a stored tooltip suggestion."""
    suggestion = db.query(TooltipSuggestionModel).filter(
        TooltipSuggestionModel.id == suggestion_id,
        TooltipSuggestionModel.paper_id == paper_id
    ).first()

    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    db.delete(suggestion)
    db.commit()

    return {"status": "success"}


@app.delete("/api/papers/{paper_id}/suggestions")
async def clear_all_suggestions(
    paper_id: str,
    db: Session = Depends(get_db)
):
    """Clear all stored tooltip suggestions for a paper."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    db.query(TooltipSuggestionModel).filter(
        TooltipSuggestionModel.paper_id == paper_id
    ).delete()

    db.commit()

    return {"status": "success"}


# =============================================================================
# Tooltip Application Endpoint
# =============================================================================

@app.post("/api/papers/{paper_id}/tooltips/apply", response_model=TooltipApplicationResponse)
async def apply_tooltips_endpoint(
    paper_id: str,
    request: TooltipApplicationRequest,
    db: Session = Depends(get_db)
):
    """
    Apply suggested tooltips by injecting <span> tags into HTML and creating Tooltip records.

    This endpoint:
    1. Loads the paper and original HTML
    2. Injects <span class="kg-entity"> tags at occurrence positions
    3. Validates HTML integrity
    4. Persists modified HTML back to database
    5. Creates Tooltip records with entity_id set

    Args:
        paper_id: ID of the paper
        request: Contains list of suggestions to apply (from /suggest endpoint)

    Returns:
        TooltipApplicationResponse with:
        - success: Whether operation completed
        - spans_injected: Number of successful span injections
        - tooltips_created: Number of Tooltip records created
        - errors: List of errors encountered

    Note: This operation modifies the paper's HTML content. Consider backing up before applying.
    """
    from backend.app.compiler.html_injection import validate_html_integrity

    # Load paper
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    if not paper.html_content:
        raise HTTPException(
            status_code=400,
            detail="Paper has no compiled HTML. Please compile the paper first."
        )

    # Store original HTML for rollback
    original_html = paper.html_content

    _validate_request_ai_config(request.ai_config, tasks=(TASK_HTML_INJECTION,))

    try:
        # Convert Pydantic models to dicts for injection function
        suggestions_dict = [s.model_dump() for s in request.suggestions]

        print(f"\n[Tooltip Apply] Received request to apply {len(suggestions_dict)} tooltip suggestions for paper {paper_id}")

        # Check for duplicates - skip entities that already have tooltips
        existing_entity_ids = {
            t.entity_id for t in db.query(Tooltip).filter(
                Tooltip.paper_id == paper_id,
                Tooltip.entity_id.isnot(None)
            ).all()
        }

        # Filter out already-applied entities
        original_count = len(suggestions_dict)
        suggestions_dict = [s for s in suggestions_dict if s.get('entity_id') not in existing_entity_ids]

        if len(suggestions_dict) < original_count:
            skipped = original_count - len(suggestions_dict)
            print(f"[Tooltip Apply] Skipped {skipped} entities that already have tooltips")

        if not suggestions_dict:
            return TooltipApplicationResponse(
                success=True,
                spans_injected=0,
                tooltips_created=0,
                errors=["All selected entities already have tooltips applied"]
            )

        # NEW APPROACH: Use AI model to inject spans into each subsection
        # This is much more robust than manual offset tracking
        print(f"[Tooltip Apply] Using AI model to inject spans into subsections...")

        from backend.app.compiler.ai_html_injection import inject_spans_with_ai

        modified_html, injection_errors = inject_spans_with_ai(
            html_content=paper.html_content,
            sections_data=paper.sections_data or [],
            suggestions=suggestions_dict,
            ai_config=request.ai_config,
        )

        if not modified_html:
            raise ValueError("AI injection failed to produce modified HTML")

        # Validate HTML integrity
        is_valid, validation_error = validate_html_integrity(original_html, modified_html)
        if not is_valid:
            raise ValueError(f"HTML validation failed: {validation_error}")

        # Persist modified HTML
        paper.html_content = modified_html

        # Create Tooltip records for each suggestion (use suggestions_dict which is already filtered)
        tooltips_created = 0
        for suggestion in suggestions_dict:
            # Create semantic tooltip (entity_id is set, dom_node_id is None)
            new_tooltip = Tooltip(
                id=str(uuid.uuid4()),
                paper_id=paper_id,
                entity_id=suggestion.get('entity_id'),  # NEW: Link to KG entity
                dom_node_id=None,  # Semantic tooltips don't have single anchor
                target_text=suggestion.get('entity_label'),  # Display label
                content=suggestion.get('tooltip_content'),
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC)
            )
            db.add(new_tooltip)
            tooltips_created += 1

        # Commit all changes
        db.commit()

        # Calculate successful spans (use suggestions_dict which has the populated occurrences)
        total_occurrences = sum(len(s.get('occurrences', [])) for s in suggestions_dict)
        spans_injected = total_occurrences - len(injection_errors)

        print(f"[Tooltip Apply] Complete: {spans_injected} spans injected, {tooltips_created} tooltips created")

        return TooltipApplicationResponse(
            success=True,
            spans_injected=spans_injected,
            tooltips_created=tooltips_created,
            errors=injection_errors
        )

    except Exception as e:
        # Rollback on error
        db.rollback()
        print(f"Error applying tooltips: {e}")
        import traceback
        traceback.print_exc()

        raise HTTPException(
            status_code=500,
            detail=f"Failed to apply tooltips: {str(e)}"
        )


# =============================================================================
# Knowledge Graph
# =============================================================================

class KnowledgeGraphResponse(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    metadata: Optional[Dict[str, Any]] = None


class KnowledgeGraphBuildResponse(BaseModel):
    status: str
    node_count: int
    edge_count: int
    errors: Optional[List[str]] = None


def _run_compile_task(paper_id: str, source_path: str):
    """Background task to compile a LaTeX paper via Docker."""
    from backend.app.database.connection import SessionLocal

    db = SessionLocal()
    try:
        compile_progress[paper_id] = {"stage": "compiling", "message": "Running LaTeXML compiler..."}

        paper_assets_dir = ASSETS_DIR / paper_id
        result = compile_latex_to_html(
            Path(source_path), paper_id, use_docker=USE_DOCKER, assets_dir=paper_assets_dir
        )

        paper = db.query(Paper).filter(Paper.id == paper_id).first()
        if paper:
            paper.html_content = result.html_content
            paper.sections_data = result.sections
            paper.equations_data = result.equations
            paper.citations_data = result.citations
            paper.paper_metadata = result.metadata
            paper.latex_source = result.latex_source
            paper.compiled_at = datetime.now(UTC)
            db.commit()

        compile_progress[paper_id] = {"stage": "complete", "message": "Compilation successful"}
    except Exception as e:
        compile_progress[paper_id] = {"stage": "error", "error": str(e)}
    finally:
        db.close()


@app.get("/api/papers/{paper_id}/compile/progress")
async def compile_progress_sse(paper_id: str):
    """
    SSE endpoint for real-time compilation progress.

    Sends periodic heartbeat comments to keep the connection alive through
    proxies (Next.js rewrite) during the compilation wait.
    """
    async def event_generator():
        try:
            yield f"data: {json.dumps({'type': 'connected', 'paper_id': paper_id})}\n\n"

            last_progress = None
            heartbeat_counter = 0
            wait_count = 0

            while True:
                if paper_id in compile_progress:
                    wait_count = 0
                    current = compile_progress[paper_id]

                    if current != last_progress:
                        yield f"data: {json.dumps(current)}\n\n"
                        last_progress = current.copy()

                    if current.get("stage") in ("complete", "error"):
                        await asyncio.sleep(1)
                        compile_progress.pop(paper_id, None)
                        break
                else:
                    wait_count += 1
                    if wait_count > 60:  # 30 s max wait for task to appear
                        yield f"data: {json.dumps({'stage': 'error', 'error': 'Compilation task not found'})}\n\n"
                        break

                await asyncio.sleep(0.5)

                # Heartbeat every 5 s keeps the Next.js proxy from closing the idle connection
                heartbeat_counter += 1
                if heartbeat_counter % 10 == 0:
                    yield ": heartbeat\n\n"

        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@app.get("/api/papers/{paper_id}/knowledge-graph/build/progress")
async def knowledge_graph_build_progress(paper_id: str):
    """
    SSE endpoint for real-time knowledge graph build progress.

    Returns Server-Sent Events with progress updates.
    """
    async def event_generator():
        """Generate SSE events for progress updates."""
        try:
            # Send initial connection confirmation
            yield f"data: {json.dumps({'type': 'connected', 'paper_id': paper_id})}\n\n"

            # Poll for progress updates
            last_progress = None
            while True:
                if paper_id in kg_build_progress:
                    current_progress = kg_build_progress[paper_id]

                    # Only send if progress changed
                    if current_progress != last_progress:
                        yield f"data: {json.dumps(current_progress)}\n\n"
                        last_progress = current_progress.copy()

                    # Check if complete or error
                    if current_progress.get('stage') in ['complete', 'error']:
                        # Clean up after a delay
                        await asyncio.sleep(2)
                        if paper_id in kg_build_progress:
                            del kg_build_progress[paper_id]
                        break

                await asyncio.sleep(0.5)  # Poll every 500ms
        except asyncio.CancelledError:
            # Client disconnected
            pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


def _run_kg_build_task(
    paper_id: str,
    ai_config: AIConfig | dict[str, Any] | None = None,
):
    """Background task to build knowledge graph."""
    from backend.app.database.connection import SessionLocal
    from backend.app.agents.knowledge_graph import build_kg_for_paper

    db = SessionLocal()

    def progress_callback(stage: str, current: int, total: int):
        """Update progress for SSE clients."""
        if paper_id in kg_build_progress:
            kg_build_progress[paper_id] = {
                "stage": "extracting",
                "progress": {
                    **kg_build_progress[paper_id].get("progress", {}),
                    stage: {"current": current, "total": total}
                }
            }

    try:
        print(f"[KG Build Task] Starting build for paper {paper_id}")
        graph_data = build_kg_for_paper(
            paper_id,
            progress_callback=progress_callback,
            ai_config=ai_config,
        )

        # Store graph data in paper record
        paper = db.query(Paper).filter(Paper.id == paper_id).first()
        if paper:
            paper.knowledge_graph = graph_data
            db.commit()
            print(f"[KG Build Task] Build complete for paper {paper_id}")

        # Mark as complete
        kg_build_progress[paper_id] = {
            "stage": "complete",
            "progress": {},
            "node_count": graph_data["metadata"]["node_count"],
            "edge_count": graph_data["metadata"]["edge_count"],
        }
    except Exception as e:
        print(f"[KG Build Task] Build failed for paper {paper_id}: {str(e)}")
        # Mark as error
        kg_build_progress[paper_id] = {"stage": "error", "error": str(e)}
    finally:
        db.close()


@app.post("/api/papers/{paper_id}/knowledge-graph/build")
async def build_knowledge_graph(
    paper_id: str,
    background_tasks: BackgroundTasks,
    request: Optional[KnowledgeGraphBuildRequest] = None,
    db: Session = Depends(get_db),
):
    """
    Trigger knowledge graph construction for a paper (async background task).

    Returns immediately with status 202 Accepted. Use the progress endpoint
    to monitor build status.
    """
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    if not paper.html_content:
        raise HTTPException(status_code=400, detail="Paper not compiled yet")

    if not paper.sections_data:
        raise HTTPException(status_code=400, detail="Paper has no extracted sections. Please recompile.")

    # Check if already building
    if paper_id in kg_build_progress and kg_build_progress[paper_id].get("stage") == "extracting":
        raise HTTPException(status_code=409, detail="Build already in progress")

    _validate_request_ai_config(request.ai_config if request else None, tasks=(TASK_KNOWLEDGE_GRAPH,))

    # Initialize progress tracking
    kg_build_progress[paper_id] = {"stage": "starting", "progress": {}}

    # Start background task
    background_tasks.add_task(
        _run_kg_build_task,
        paper_id,
        request.ai_config if request else None,
    )

    return {"status": "accepted", "message": "Build started in background"}


@app.get("/api/papers/{paper_id}/knowledge-graph", response_model=KnowledgeGraphResponse)
async def get_knowledge_graph(paper_id: str, db: Session = Depends(get_db)):
    """Get the knowledge graph for a paper."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    if not paper.knowledge_graph:
        raise HTTPException(status_code=404, detail="Knowledge graph not built yet. POST to /knowledge-graph/build first.")

    return KnowledgeGraphResponse(
        nodes=paper.knowledge_graph.get("nodes", []),
        edges=paper.knowledge_graph.get("edges", []),
        metadata=paper.knowledge_graph.get("metadata"),
    )


@app.delete("/api/papers/{paper_id}/knowledge-graph")
async def delete_knowledge_graph(paper_id: str, db: Session = Depends(get_db)):
    """Delete the knowledge graph for a paper (for rebuilding)."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    paper.knowledge_graph = None
    db.commit()

    return {"status": "success", "paper_id": paper_id}


# =============================================================================
# Helper Functions
# =============================================================================

def _paper_to_response(paper: Paper) -> PaperResponse:
    return PaperResponse(
        id=paper.id,
        filename=paper.filename,
        arxiv_id=paper.arxiv_id,
        uploaded_at=paper.uploaded_at,
        compiled_at=paper.compiled_at,
        has_html=paper.html_content is not None
    )


def _get_archive_type(filename: str) -> str | None:
    name = filename.lower()
    if name.endswith(".tar.gz") or name.endswith(".tgz") or name.endswith(".tar"):
        return "tar"
    if name.endswith(".zip"):
        return "zip"
    return None


def _extract_arxiv_id(value: str) -> str | None:
    value = value.strip()
    match = re.search(r"arxiv\.org/(abs|pdf|e-print)/([0-9.]+)", value)
    if match:
        return match.group(2)
    match = re.fullmatch(r"[0-9.]+", value)
    if match:
        return value
    return None


async def _download_arxiv_source(arxiv_id: str) -> tuple[str, Path]:
    url = f"https://arxiv.org/e-print/{arxiv_id}"
    async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        data = response.content

    file_hash = hashlib.sha256(data).hexdigest()
    archive_path = UPLOADS_DIR / f"{file_hash}.tar.gz"
    if not archive_path.exists():
        with open(archive_path, "wb") as handle:
            handle.write(data)
    return file_hash, archive_path


def _find_source_file(paper_id: str) -> Path | None:
    for ext in [".tar.gz", ".tgz", ".tar", ".zip"]:
        path = UPLOADS_DIR / f"{paper_id}{ext}"
        if path.exists():
            return path
    return None
