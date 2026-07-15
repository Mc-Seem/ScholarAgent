"""LLM factory: provider-agnostic instantiation of LangChain chat models.

Replaces hardcoded `ChatAnthropic(model=...)` calls throughout the codebase.
Reads the active LLMConfig from the database; falls back to env vars for
backward compatibility when no config row exists.

Usage:
    from backend.app.utils.llm_factory import get_llm
    llm = get_llm("kg_extraction")  # returns a ChatAnthropic or ChatOpenAI instance
"""

import os
from typing import Literal, Optional

from langchain_core.language_models.chat_models import BaseChatModel

from backend.app.database.connection import get_db_context
from backend.app.database.models import LLMConfig
from backend.app.utils.crypto import decrypt

# Workflow identifiers — each maps to a model name in LLMConfig.models
Workflow = Literal["kg_extraction", "html_injection", "tooltip_suggestion"]

# Default model names when falling back to env vars (backward compat)
_DEFAULT_MODELS: dict[str, str] = {
    "kg_extraction": "claude-sonnet-4-5-20250929",
    "html_injection": "claude-haiku-4-5-20251001",
    "tooltip_suggestion": "claude-sonnet-4-5-20250929",
}


def _get_active_config() -> Optional[dict]:
    """Load the active LLMConfig from the database as a plain dict.

    All attributes are extracted while the session is still open to avoid
    DetachedInstanceError when accessing them later.
    """
    try:
        with get_db_context() as db:
            row = db.query(LLMConfig).filter(LLMConfig.is_active == True).first()
            if row is None:
                return None
            # Extract all values into a plain dict before the session closes
            return {
                "provider": row.provider,
                "base_url": row.base_url,
                "api_key_enc": row.api_key_enc,
                "models": row.models or {},
            }
    except Exception:
        # Database not available (e.g. during tests) — fall back to env
        return None


def get_llm(
    workflow: Workflow,
    *,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
) -> BaseChatModel:
    """Get a LangChain chat model instance for the given workflow.

    Reads the active LLMConfig from the database. If no config exists,
    falls back to ANTHROPIC_API_KEY env var with default model names.

    Args:
        workflow: One of "kg_extraction", "html_injection", "tooltip_suggestion".
        max_tokens: Optional max output tokens override.
        temperature: Optional temperature override.

    Returns:
        A LangChain BaseChatModel instance (ChatAnthropic or ChatOpenAI).
    """
    config = _get_active_config()

    if config is not None:
        return _build_from_config(config, workflow, max_tokens, temperature)
    else:
        return _build_from_env(workflow, max_tokens, temperature)


def _build_from_config(
    config: dict,
    workflow: Workflow,
    max_tokens: Optional[int],
    temperature: Optional[float],
) -> BaseChatModel:
    """Build a chat model from a config dict (extracted from LLMConfig row)."""
    models = config.get("models") or {}
    model_name = models.get(workflow) or _DEFAULT_MODELS[workflow]

    # Decrypt API key if present
    api_key_enc = config.get("api_key_enc")
    api_key = decrypt(api_key_enc) if api_key_enc else None

    kwargs: dict = {}
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    if temperature is not None:
        kwargs["temperature"] = temperature

    provider = config.get("provider", "anthropic")
    base_url = config.get("base_url")

    if provider in ("openai", "ollama", "custom"):
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=model_name,
            api_key=api_key or "ollama",  # Ollama local doesn't need a key; use placeholder
            base_url=base_url,
            **kwargs,
        )
    elif provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=model_name,
            api_key=api_key or os.getenv("ANTHROPIC_API_KEY"),
            **kwargs,
        )
    else:
        raise ValueError(f"Unknown provider: {provider}")


def _build_from_env(
    workflow: Workflow,
    max_tokens: Optional[int],
    temperature: Optional[float],
) -> BaseChatModel:
    """Backward-compatible fallback: build from environment variables."""
    from langchain_anthropic import ChatAnthropic

    # html_injection already had an env override
    if workflow == "html_injection":
        model = os.getenv("HTML_INJECTION_MODEL", _DEFAULT_MODELS[workflow])
    else:
        model = _DEFAULT_MODELS[workflow]

    kwargs: dict = {}
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    if temperature is not None:
        kwargs["temperature"] = temperature

    return ChatAnthropic(model=model, **kwargs)


# ---- Structured output helpers ----

def get_structured_output_method(llm: BaseChatModel) -> str:
    """Return the best method argument for with_structured_output().

    Both ChatAnthropic and ChatOpenAI (including Ollama Cloud) support
    function_calling, which passes the full schema to the model via tool
    definitions. This works reliably across providers, unlike json_mode
    (which doesn't pass the schema) or json_schema (which some endpoints
    ignore).
    """
    return "function_calling"


def get_structured_llm(llm: BaseChatModel, schema):
    """Wrap an LLM with structured output, using the right method per provider.

    For ChatOpenAI (Ollama, custom), uses json_mode and relies on the prompt
    to convey the expected schema. For ChatAnthropic, uses tool_calling which
    passes the schema natively.

    Usage (replaces llm.with_structured_output(Schema)):
        structured_llm = get_structured_llm(llm, Schema)
    """
    method = get_structured_output_method(llm)
    return llm.with_structured_output(schema, method=method)