"""API routes for LLM provider configuration.

Endpoints:
  GET  /api/settings/llm        — Get active config (key masked)
  PUT  /api/settings/llm        — Save config (encrypts key, deactivates old)
  GET  /api/settings/llm/models — List available models from the configured provider
  POST /api/settings/llm/test   — Send a ping to verify the config works
"""

import os
from typing import Optional, List, Dict, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.database.connection import get_db
from backend.app.database.models import LLMConfig
from backend.app.utils.crypto import encrypt, decrypt, mask_key

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Known provider defaults
_PROVIDER_DEFAULTS: Dict[str, Dict[str, Any]] = {
    "anthropic": {
        "base_url": None,
        "key_required": True,
        "key_label": "Anthropic API Key",
        "key_placeholder": "sk-ant-...",
        "models_endpoint": None,  # Anthropic doesn't have a public models list API
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "key_required": True,
        "key_label": "OpenAI API Key",
        "key_placeholder": "sk-...",
        "models_endpoint": "https://api.openai.com/v1/models",
    },
    "ollama": {
        "base_url": "https://ollama.com/v1",
        "key_required": True,
        "key_label": "Ollama API Key",
        "key_placeholder": "ollama-...",
        "models_endpoint": "{base_url}/models",
    },
    "custom": {
        "base_url": "",
        "key_required": False,
        "key_label": "API Key (optional)",
        "key_placeholder": "",
        "models_endpoint": "{base_url}/models",
    },
}


# ---- Pydantic models ----

class LLMConfigResponse(BaseModel):
    id: int
    provider: str
    base_url: Optional[str] = None
    api_key_masked: Optional[str] = None
    has_api_key: bool
    models: Dict[str, str]
    is_active: bool


class LLMConfigUpdate(BaseModel):
    provider: str  # "anthropic" | "openai" | "ollama" | "custom"
    base_url: Optional[str] = None
    api_key: Optional[str] = None  # plaintext; None = keep existing
    models: Dict[str, str]  # {workflow: model_name}


class ModelInfo(BaseModel):
    id: str
    name: str


class ModelsResponse(BaseModel):
    models: List[ModelInfo]


class TestResponse(BaseModel):
    success: bool
    message: str
    model_used: Optional[str] = None


# ---- Endpoints ----

@router.get("/llm", response_model=LLMConfigResponse)
async def get_llm_config(db: Session = Depends(get_db)):
    """Get the active LLM configuration. API key is masked."""
    config = db.query(LLMConfig).filter(LLMConfig.is_active == True).first()
    if config is None:
        # Return empty defaults
        return LLMConfigResponse(
            id=0,
            provider="anthropic",
            base_url=None,
            api_key_masked=None,
            has_api_key=bool(os.getenv("ANTHROPIC_API_KEY")),
            models={},
            is_active=False,
        )

    # Decrypt key for masking
    masked = None
    if config.api_key_enc:
        try:
            key = decrypt(config.api_key_enc)
            masked = mask_key(key)
        except ValueError:
            masked = "[decryption error]"

    return LLMConfigResponse(
        id=config.id,
        provider=config.provider,
        base_url=config.base_url,
        api_key_masked=masked,
        has_api_key=bool(config.api_key_enc),
        models=config.models or {},
        is_active=config.is_active,
    )


@router.put("/llm", response_model=LLMConfigResponse)
async def update_llm_config(update: LLMConfigUpdate, db: Session = Depends(get_db)):
    """Save LLM configuration. Deactivates any previous active config."""
    if update.provider not in _PROVIDER_DEFAULTS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {update.provider}")

    # Deactivate all existing configs
    db.query(LLMConfig).update({LLMConfig.is_active: False})

    # Get existing config if any (reuse the row)
    existing = db.query(LLMConfig).filter(LLMConfig.is_active == False).order_by(LLMConfig.id.desc()).first()

    # Determine base_url
    base_url = update.base_url
    if base_url is None:
        base_url = _PROVIDER_DEFAULTS[update.provider]["base_url"]

    # Handle API key: if api_key is None, try to keep existing
    api_key_enc = None
    if update.api_key:
        api_key_enc = encrypt(update.api_key)
    elif existing and existing.api_key_enc:
        api_key_enc = existing.api_key_enc

    if existing:
        # Update existing row
        existing.provider = update.provider
        existing.base_url = base_url
        existing.api_key_enc = api_key_enc
        existing.models = update.models
        existing.is_active = True
        config = existing
    else:
        # Create new row
        config = LLMConfig(
            provider=update.provider,
            base_url=base_url,
            api_key_enc=api_key_enc,
            models=update.models,
            is_active=True,
        )
        db.add(config)

    db.commit()
    db.refresh(config)

    # Return masked
    masked = None
    if config.api_key_enc:
        try:
            masked = mask_key(decrypt(config.api_key_enc))
        except ValueError:
            masked = "[decryption error]"

    return LLMConfigResponse(
        id=config.id,
        provider=config.provider,
        base_url=config.base_url,
        api_key_masked=masked,
        has_api_key=bool(config.api_key_enc),
        models=config.models or {},
        is_active=config.is_active,
    )


@router.get("/llm/models", response_model=ModelsResponse)
async def list_models(provider: str, base_url: Optional[str] = None, api_key: Optional[str] = None, db: Session = Depends(get_db)):
    """List available models from the given provider.

    For providers with a models endpoint, fetches the list live.
    Falls back to common model presets if the endpoint is unreachable.
    """
    if provider not in _PROVIDER_DEFAULTS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    defaults = _PROVIDER_DEFAULTS[provider]
    url = base_url or defaults["base_url"]

    # For Anthropic, there's no public models list — return known models
    if provider == "anthropic":
        return ModelsResponse(models=[
            ModelInfo(id="claude-sonnet-4-5-20250929", name="Claude Sonnet 4.5"),
            ModelInfo(id="claude-haiku-4-5-20251001", name="Claude Haiku 4.5"),
            ModelInfo(id="claude-opus-4-1-20250805", name="Claude Opus 4.1"),
        ])

    # Try to fetch from the provider's models endpoint
    models_endpoint = defaults["models_endpoint"]
    if models_endpoint:
        endpoint = models_endpoint.format(base_url=url) if "{base_url}" in models_endpoint else models_endpoint
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(endpoint, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    models = []
                    for m in data.get("data", []):
                        model_id = m["id"]
                        models.append(ModelInfo(id=model_id, name=model_id))
                        # For Ollama, add :cloud variant — the API lists base
                        # model names, but cloud versions are accessed by
                        # appending :cloud (e.g. "glm-5.2" → "glm-5.2:cloud").
                        # Cloud variants run on Ollama's infra, not locally.
                        if provider == "ollama" and ":cloud" not in model_id:
                            models.append(ModelInfo(
                                id=f"{model_id}:cloud",
                                name=f"{model_id} (cloud)",
                            ))
                    return ModelsResponse(models=models)
        except (httpx.HTTPError, httpx.TimeoutException):
            pass  # Fall through to presets

    # Fallback presets for Ollama Cloud
    if provider == "ollama":
        return ModelsResponse(models=[
            ModelInfo(id="qwen3-235b-a22b", name="Qwen3 235B"),
            ModelInfo(id="qwen3-32b", name="Qwen3 32B"),
            ModelInfo(id="qwen3-14b", name="Qwen3 14B"),
            ModelInfo(id="deepseek-r1", name="DeepSeek R1"),
            ModelInfo(id="llama3.3-70b", name="Llama 3.3 70B"),
            ModelInfo(id="gpt-oss-120b", name="GPT-OSS 120B"),
        ])

    return ModelsResponse(models=[])


@router.post("/llm/test", response_model=TestResponse)
async def test_llm_config(db: Session = Depends(get_db)):
    """Send a minimal prompt to the active LLM config to verify it works."""
    from backend.app.utils.llm_factory import get_llm

    try:
        llm = get_llm("kg_extraction")
        response = llm.invoke("Say 'hello' and nothing else.")
        return TestResponse(
            success=True,
            message=f"LLM responded: {response.content[:100]}",
            model_used=getattr(llm, 'model', 'unknown'),
        )
    except Exception as e:
        return TestResponse(
            success=False,
            message=f"Error: {str(e)}",
        )