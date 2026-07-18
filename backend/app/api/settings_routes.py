"""API routes for LLM provider configuration.

Endpoints:
  GET  /api/settings/llm        — Get active config (key masked)
  PUT  /api/settings/llm        — Save config (encrypts key, deactivates old)
  POST /api/settings/llm/models — List models using an unsaved connection draft
  POST /api/settings/llm/test   — Test one unsaved workflow/model selection
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from backend.app.database.connection import get_db
from backend.app.database.models import LLMConfig
from backend.app.utils.crypto import encrypt, decrypt, mask_key
from backend.app.utils.llm_factory import build_llm_from_settings
from backend.app.utils.llm_settings import (
    CredentialSource,
    LlmProvider,
    Workflow,
    connection_identity,
    credential_from_environment,
    get_provider_spec,
    known_models,
    normalize_base_url,
    normalize_workflow_models,
    validate_workflow_models,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


# ---- Pydantic models ----

class LLMConfigResponse(BaseModel):
    id: int
    provider: LlmProvider
    base_url: str
    api_key_masked: Optional[str] = None
    has_api_key: bool
    credential_source: CredentialSource
    credential_required: bool
    models: Dict[str, str]
    is_active: bool


class LLMConnectionDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: LlmProvider
    base_url: Optional[str] = None
    api_key: str = ""
    clear_api_key: bool = False


class LLMConfigUpdate(LLMConnectionDraft):
    models: Dict[str, str]


class ModelInfo(BaseModel):
    id: str
    name: str


class ModelsResponse(BaseModel):
    provider: LlmProvider
    base_url: str
    source: Literal["provider", "catalog"]
    models: List[ModelInfo]
    warning: Optional[str] = None


class LLMTestRequest(LLMConnectionDraft):
    workflow: Workflow
    model: str


class TestResponse(BaseModel):
    success: bool
    message: str
    workflow: Workflow
    model_used: str


@dataclass(frozen=True)
class _ResolvedCredential:
    value: str | None
    source: Literal["replacement", "database", "environment", "none"]


def _active_config(db: Session) -> LLMConfig | None:
    return (
        db.query(LLMConfig)
        .filter(LLMConfig.is_active == True)
        .order_by(LLMConfig.id.desc())
        .first()
    )


def _normalized_base_url(provider: str, base_url: str | None) -> str:
    try:
        return normalize_base_url(provider, base_url)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


def _is_same_connection(
    config: LLMConfig | None,
    provider: str,
    base_url: str,
) -> bool:
    if config is None:
        return False
    try:
        return connection_identity(config.provider, config.base_url) == (provider, base_url)
    except ValueError:
        return False


def _resolve_draft_credential(
    draft: LLMConnectionDraft,
    db: Session,
    base_url: str,
) -> _ResolvedCredential:
    replacement = draft.api_key.strip()
    if replacement and draft.clear_api_key:
        raise HTTPException(
            status_code=422,
            detail="An API key cannot be replaced and removed in the same request.",
        )
    if replacement:
        return _ResolvedCredential(replacement, "replacement")

    environment = credential_from_environment(draft.provider)
    if draft.clear_api_key:
        return _ResolvedCredential(
            environment,
            "environment" if environment else "none",
        )

    active = _active_config(db)
    if _is_same_connection(active, draft.provider, base_url) and active.api_key_enc:
        try:
            return _ResolvedCredential(decrypt(active.api_key_enc), "database")
        except ValueError as error:
            raise HTTPException(
                status_code=422,
                detail="The stored API key cannot be decrypted; replace or remove it.",
            ) from error
    return _ResolvedCredential(
        environment,
        "environment" if environment else "none",
    )


def _require_credential(provider: str, credential: _ResolvedCredential) -> None:
    if get_provider_spec(provider).credential_required and not credential.value:
        raise HTTPException(
            status_code=422,
            detail=f"An API credential is required for provider '{provider}'.",
        )


def _config_response(config: LLMConfig | None) -> LLMConfigResponse:
    provider: LlmProvider = config.provider if config else "anthropic"
    base_url = normalize_base_url(provider, config.base_url if config else None)
    source: CredentialSource = "none"
    masked: str | None = None

    if config and config.api_key_enc:
        source = "database"
        try:
            masked = mask_key(decrypt(config.api_key_enc))
        except ValueError:
            masked = None
    else:
        environment = credential_from_environment(provider)
        if environment:
            source = "environment"
            masked = mask_key(environment)

    spec = get_provider_spec(provider)
    return LLMConfigResponse(
        id=config.id if config else 0,
        provider=provider,
        base_url=base_url,
        api_key_masked=masked,
        has_api_key=source != "none",
        credential_source=source,
        credential_required=spec.credential_required,
        models=normalize_workflow_models(provider, config.models if config else None),
        is_active=bool(config and config.is_active),
    )


# ---- Endpoints ----

@router.get("/llm", response_model=LLMConfigResponse)
async def get_llm_config(db: Session = Depends(get_db)):
    """Get the active LLM configuration. API key is masked."""
    return _config_response(_active_config(db))


@router.put("/llm", response_model=LLMConfigResponse)
async def update_llm_config(update: LLMConfigUpdate, db: Session = Depends(get_db)):
    """Validate and transactionally save one normalized active configuration."""
    base_url = _normalized_base_url(update.provider, update.base_url)
    try:
        models = validate_workflow_models(update.models)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    active = _active_config(db)
    same_connection = _is_same_connection(active, update.provider, base_url)
    credential = _resolve_draft_credential(update, db, base_url)
    _require_credential(update.provider, credential)

    try:
        if credential.source == "replacement":
            api_key_enc = encrypt(credential.value)
        elif update.clear_api_key or not same_connection:
            api_key_enc = None
        else:
            api_key_enc = active.api_key_enc if active else None

        config = active
        if config is None:
            db.query(LLMConfig).update(
                {LLMConfig.is_active: False},
                synchronize_session=False,
            )
            config = LLMConfig(
                provider=update.provider,
                base_url=base_url,
                api_key_enc=api_key_enc,
                models=models,
                is_active=True,
            )
            db.add(config)
        else:
            db.query(LLMConfig).filter(LLMConfig.id != config.id).update(
                {LLMConfig.is_active: False},
                synchronize_session=False,
            )
            config.provider = update.provider
            config.base_url = base_url
            config.api_key_enc = api_key_enc
            config.models = models
            config.is_active = True
        db.commit()
        db.refresh(config)
    except Exception as error:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Could not save LLM settings.",
        ) from error

    return _config_response(config)


@router.post("/llm/models", response_model=ModelsResponse)
async def list_models(
    draft: LLMConnectionDraft,
    db: Session = Depends(get_db),
):
    """Discover models with the unsaved connection draft, falling back to catalog data."""
    base_url = _normalized_base_url(draft.provider, draft.base_url)
    credential = _resolve_draft_credential(draft, db, base_url)
    spec = get_provider_spec(draft.provider)

    if spec.supports_model_discovery:
        endpoint = f"{base_url}/models"
        headers = (
            {"Authorization": f"Bearer {credential.value}"}
            if credential.value
            else {}
        )
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(endpoint, headers=headers)
            if response.status_code == 200:
                payload = response.json()
                raw_models = payload.get("data") if isinstance(payload, dict) else None
                if isinstance(raw_models, list):
                    discovered: dict[str, ModelInfo] = {}
                    for raw_model in raw_models:
                        if not isinstance(raw_model, dict):
                            continue
                        model_id = raw_model.get("id")
                        if not isinstance(model_id, str) or not model_id.strip():
                            continue
                        model_id = model_id.strip()
                        discovered[model_id] = ModelInfo(id=model_id, name=model_id)
                        if draft.provider == "ollama" and ":cloud" not in model_id:
                            cloud_id = f"{model_id}:cloud"
                            discovered[cloud_id] = ModelInfo(
                                id=cloud_id,
                                name=f"{model_id} (cloud)",
                            )
                    return ModelsResponse(
                        provider=draft.provider,
                        base_url=base_url,
                        source="provider",
                        models=[discovered[key] for key in sorted(discovered)],
                    )
        except (httpx.HTTPError, ValueError, TypeError):
            pass

        warning = "Provider model discovery failed; showing the built-in catalog."
    else:
        warning = None

    return ModelsResponse(
        provider=draft.provider,
        base_url=base_url,
        source="catalog",
        models=[ModelInfo(id=model.id, name=model.name) for model in known_models(draft.provider)],
        warning=warning,
    )


@router.post("/llm/test", response_model=TestResponse)
async def test_llm_config(
    request: LLMTestRequest,
    db: Session = Depends(get_db),
):
    """Invoke exactly one selected model using an unsaved connection draft."""
    base_url = _normalized_base_url(request.provider, request.base_url)
    credential = _resolve_draft_credential(request, db, base_url)
    _require_credential(request.provider, credential)
    model = request.model.strip()
    if not model:
        raise HTTPException(status_code=422, detail="A model is required for the selected workflow.")

    try:
        llm = build_llm_from_settings(
            provider=request.provider,
            base_url=base_url,
            api_key=credential.value,
            models={request.workflow: model},
            workflow=request.workflow,
        )
        llm.invoke("Reply with OK and nothing else.")
        actual_model = (
            getattr(llm, "model_name", None)
            or getattr(llm, "model", None)
            or model
        )
        return TestResponse(
            success=True,
            message="Connection succeeded.",
            workflow=request.workflow,
            model_used=str(actual_model),
        )
    except Exception:
        return TestResponse(
            success=False,
            message="Connection failed. Check the provider, endpoint, credential, and model.",
            workflow=request.workflow,
            model_used=model,
        )