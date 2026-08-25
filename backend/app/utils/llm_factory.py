"""LLM factory: provider-agnostic instantiation of LangChain chat models.

Replaces hardcoded `ChatAnthropic(model=...)` calls throughout the codebase.
Reads the active LLMConfig from the database; falls back to env vars for
backward compatibility when no config row exists.

Usage:
    from backend.app.utils.llm_factory import get_llm
    llm = get_llm("kg_extraction")  # returns a ChatAnthropic or ChatOpenAI instance
"""

import os
from typing import Mapping, Optional

from langchain_core.language_models.chat_models import BaseChatModel

from backend.app.database.connection import get_db_context
from backend.app.database.models import LLMConfig
from backend.app.utils.crypto import decrypt
from backend.app.utils.llm_settings import (
    Workflow,
    credential_from_environment,
    get_provider_spec,
    normalize_base_url,
    resolve_workflow_model,
)


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
        workflow: One of "kg_extraction", "html_injection", "tooltip_suggestion", "chat".
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
    api_key_enc = config.get("api_key_enc")
    api_key = decrypt(api_key_enc) if api_key_enc else None
    return build_llm_from_settings(
        provider=config.get("provider", "anthropic"),
        base_url=config.get("base_url"),
        api_key=api_key,
        models=config.get("models") or {},
        workflow=workflow,
        max_tokens=max_tokens,
        temperature=temperature,
    )


def _build_from_env(
    workflow: Workflow,
    max_tokens: Optional[int],
    temperature: Optional[float],
) -> BaseChatModel:
    """Backward-compatible fallback: build from environment variables."""
    models: dict[str, str] = {}
    if workflow == "html_injection" and os.getenv("HTML_INJECTION_MODEL"):
        models[workflow] = os.environ["HTML_INJECTION_MODEL"]
    return build_llm_from_settings(
        provider="anthropic",
        base_url=None,
        api_key=None,
        models=models,
        workflow=workflow,
        max_tokens=max_tokens,
        temperature=temperature,
    )


def build_llm_from_settings(
    *,
    provider: str,
    base_url: str | None,
    api_key: str | None,
    models: Mapping[str, object],
    workflow: Workflow,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
) -> BaseChatModel:
    """Build a model from resolved plaintext settings without reading or writing the DB."""
    spec = get_provider_spec(provider)
    endpoint = normalize_base_url(provider, base_url)
    model_name = resolve_workflow_model(provider, models, workflow)
    credential = api_key if api_key and api_key.strip() else credential_from_environment(provider)
    if spec.credential_required and not credential:
        raise ValueError(f"An API credential is required for provider '{provider}'.")

    kwargs: dict = {}
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    if temperature is not None:
        kwargs["temperature"] = temperature

    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=model_name,
            api_key=credential,
            base_url=endpoint,
            **kwargs,
        )

    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model=model_name,
        api_key=credential or "not-required",
        base_url=endpoint,
        **kwargs,
    )


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


def get_structured_llm(llm: BaseChatModel, schema, *, include_raw: bool = False):
    """Wrap an LLM with structured output and optional parsing diagnostics.

    Function calling passes the schema to both Anthropic and OpenAI-compatible
    providers. ``include_raw`` preserves the raw response and parsing error so
    callers can implement retries for malformed tool calls.

    Usage (replaces llm.with_structured_output(Schema)):
        structured_llm = get_structured_llm(llm, Schema)
    """
    method = get_structured_output_method(llm)
    return llm.with_structured_output(schema, method=method, include_raw=include_raw)