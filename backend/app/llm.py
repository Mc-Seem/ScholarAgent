"""
Shared AI provider configuration for backend workflows.
"""

from __future__ import annotations

from importlib import import_module
import os
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field

TASK_KNOWLEDGE_GRAPH = "knowledge_graph"
TASK_TOOLTIP_FILTER = "tooltip_filter"
TASK_HTML_INJECTION = "html_injection"
AI_TASKS = (
    TASK_KNOWLEDGE_GRAPH,
    TASK_TOOLTIP_FILTER,
    TASK_HTML_INJECTION,
)

DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929"
DEFAULT_ANTHROPIC_HTML_INJECTION_MODEL = "claude-haiku-4-5-20251001"
SUPPORTED_LLM_PROVIDERS = {"anthropic", "openrouter"}
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

ANTHROPIC_TASK_MODELS = {
    TASK_KNOWLEDGE_GRAPH: {
        "id": DEFAULT_ANTHROPIC_MODEL,
        "label": "Claude Sonnet 4.5",
    },
    TASK_TOOLTIP_FILTER: {
        "id": DEFAULT_ANTHROPIC_MODEL,
        "label": "Claude Sonnet 4.5",
    },
    TASK_HTML_INJECTION: {
        "id": DEFAULT_ANTHROPIC_HTML_INJECTION_MODEL,
        "label": "Claude Haiku 4.5",
    },
}


def _get_anthropic_html_injection_model() -> str:
    override = os.getenv("HTML_INJECTION_MODEL", "").strip()
    if override:
        return override
    return DEFAULT_ANTHROPIC_HTML_INJECTION_MODEL


def get_anthropic_task_models() -> dict[str, dict[str, str]]:
    """Return the public Anthropic task model map."""
    return {
        TASK_KNOWLEDGE_GRAPH: ANTHROPIC_TASK_MODELS[TASK_KNOWLEDGE_GRAPH],
        TASK_TOOLTIP_FILTER: ANTHROPIC_TASK_MODELS[TASK_TOOLTIP_FILTER],
        TASK_HTML_INJECTION: ANTHROPIC_TASK_MODELS[TASK_HTML_INJECTION],
    }


class OpenRouterPreferences(BaseModel):
    """Task-specific OpenRouter model preferences."""

    shared_model: str | None = None
    knowledge_graph_model: str | None = None
    tooltip_filter_model: str | None = None
    html_injection_model: str | None = None

    model_config = {"extra": "ignore"}


class AIConfig(BaseModel):
    """Request-scoped AI configuration passed from the UI."""

    provider: Literal["anthropic", "openrouter"] | None = None
    openrouter: OpenRouterPreferences = Field(default_factory=OpenRouterPreferences)

    model_config = {"extra": "ignore"}


def _coerce_ai_config(config: AIConfig | dict[str, Any] | None) -> AIConfig:
    if config is None:
        return AIConfig()
    if isinstance(config, AIConfig):
        return config
    return AIConfig.model_validate(config)


def _normalize_provider(provider: str) -> str:
    normalized = provider.strip().lower()
    if normalized not in SUPPORTED_LLM_PROVIDERS:
        supported = ", ".join(sorted(SUPPORTED_LLM_PROVIDERS))
        raise ValueError(
            f"Unsupported LLM provider '{provider}'. Expected one of: {supported}"
        )
    return normalized


def _require_known_task(task: str) -> str:
    if task not in AI_TASKS:
        supported = ", ".join(AI_TASKS)
        raise ValueError(f"Unsupported AI task '{task}'. Expected one of: {supported}")
    return task


def get_available_providers() -> list[str]:
    """Return providers with configured credentials."""
    providers: list[str] = []
    if os.getenv("ANTHROPIC_API_KEY", "").strip():
        providers.append("anthropic")
    if os.getenv("OPENROUTER_API_KEY", "").strip():
        providers.append("openrouter")
    return providers


def get_default_provider_for_capabilities() -> str | None:
    """Return the provider the UI can treat as an implicit default."""
    available = get_available_providers()
    if available == ["anthropic"]:
        return available[0]
    return None


def get_llm_provider(config: AIConfig | dict[str, Any] | None = None) -> str:
    """Return the provider to use for the current request."""
    ai_config = _coerce_ai_config(config)
    if ai_config.provider:
        return _normalize_provider(ai_config.provider)

    available = get_available_providers()
    if len(available) == 1:
        return available[0]
    return "anthropic"


def _validate_provider_credentials(provider: str) -> None:
    if provider == "anthropic":
        if not os.getenv("ANTHROPIC_API_KEY", "").strip():
            raise ValueError("Anthropic support requires ANTHROPIC_API_KEY to be set.")
        return

    if not os.getenv("OPENROUTER_API_KEY", "").strip():
        raise ValueError("OpenRouter support requires OPENROUTER_API_KEY to be set.")


def _get_openrouter_model_for_task(
    task: str,
    config: AIConfig | dict[str, Any] | None = None,
) -> str:
    ai_config = _coerce_ai_config(config)
    prefs = ai_config.openrouter

    override_by_task = {
        TASK_KNOWLEDGE_GRAPH: prefs.knowledge_graph_model,
        TASK_TOOLTIP_FILTER: prefs.tooltip_filter_model,
        TASK_HTML_INJECTION: prefs.html_injection_model,
    }

    configured_model = override_by_task[task] or prefs.shared_model
    if configured_model:
        return configured_model

    raise ValueError(
        "OpenRouter support requires a shared model or a task-specific model to be set."
    )


def resolve_chat_settings(
    task: str,
    config: AIConfig | dict[str, Any] | None = None,
) -> tuple[str, str]:
    """Resolve provider and model for a specific AI task."""
    normalized_task = _require_known_task(task)
    provider = get_llm_provider(config)

    if provider == "anthropic":
        if normalized_task == TASK_HTML_INJECTION:
            return provider, _get_anthropic_html_injection_model()
        return provider, ANTHROPIC_TASK_MODELS[normalized_task]["id"]

    return provider, _get_openrouter_model_for_task(normalized_task, config)


def get_default_chat_model_name(
    config: AIConfig | dict[str, Any] | None = None,
) -> str:
    """Return the model for knowledge graph and tooltip filtering."""
    _, model = resolve_chat_settings(TASK_KNOWLEDGE_GRAPH, config)
    return model


def get_html_injection_model_name(
    config: AIConfig | dict[str, Any] | None = None,
) -> str:
    """Return the model used for HTML span injection."""
    _, model = resolve_chat_settings(TASK_HTML_INJECTION, config)
    return model


def validate_ai_config(
    config: AIConfig | dict[str, Any] | None = None,
    *,
    tasks: tuple[str, ...] = AI_TASKS,
) -> str:
    """Validate that the provider is configured and all required task models resolve."""
    provider = get_llm_provider(config)
    _validate_provider_credentials(provider)
    for task in tasks:
        resolve_chat_settings(task, config)
    return provider


def create_chat_model(
    *,
    task: str,
    config: AIConfig | dict[str, Any] | None = None,
    max_tokens: int | None = None,
) -> Any:
    """Instantiate the configured chat model for a task."""
    provider, model = resolve_chat_settings(task, config)

    _validate_provider_credentials(provider)

    if provider == "anthropic":
        module = import_module("langchain_anthropic")
        kwargs: dict[str, Any] = {"model": model}
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        return module.ChatAnthropic(**kwargs)

    try:
        module = import_module("langchain_openrouter")
    except ImportError as exc:
        raise ImportError(
            "OpenRouter support requires the 'langchain-openrouter' package."
        ) from exc

    kwargs = {"model": model}
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens

    return module.ChatOpenRouter(**kwargs)


def get_ai_capabilities() -> dict[str, Any]:
    """Return AI provider availability and server defaults for the UI."""
    available = set(get_available_providers())
    openrouter_available = "openrouter" in available
    return {
        "providers": {
            "anthropic": {
                "available": "anthropic" in available,
                "label": "Anthropic",
                "fixed_models": get_anthropic_task_models(),
            },
            "openrouter": {
                "available": openrouter_available,
                "label": "OpenRouter",
                "supports_arbitrary_models": True,
                "supports_model_validation": True,
            },
        },
        "default_provider": get_default_provider_for_capabilities(),
    }


def _fetch_openrouter_models() -> list[dict[str, Any]]:
    headers: dict[str, str] = {}
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    response = httpx.get(OPENROUTER_MODELS_URL, headers=headers, timeout=10.0)
    response.raise_for_status()
    payload = response.json()
    return payload.get("data", [])


def check_openrouter_model(model_id: str) -> dict[str, Any]:
    """Fetch model metadata from OpenRouter and grade compatibility."""
    target_model = model_id.strip()
    if not target_model:
        raise ValueError("Model id must not be empty.")

    models = _fetch_openrouter_models()
    model = next(
        (
            item
            for item in models
            if str(item.get("id", "")).strip().lower() == target_model.lower()
        ),
        None,
    )

    if model is None:
        return {
            "model": target_model,
            "exists": False,
            "compatibility": "unknown",
            "detail": "Model not found in the current OpenRouter catalog.",
            "supported_parameters": [],
        }

    supported_parameters = sorted(
        {
            parameter
            for parameter in model.get("supported_parameters", [])
            if isinstance(parameter, str)
        }
    )
    supports_tools = "tools" in supported_parameters and "tool_choice" in supported_parameters
    supports_json_schema = (
        "response_format" in supported_parameters
        or "structured_outputs" in supported_parameters
    )

    if supports_tools:
        compatibility = "good"
        detail = "Supports function calling, which matches the app's structured output path."
    elif supports_json_schema:
        compatibility = "limited"
        detail = (
            "Supports JSON schema style outputs, but the app currently relies on "
            "function calling for structured output."
        )
    elif supported_parameters:
        compatibility = "unsupported"
        detail = "Does not advertise structured output support required by the app."
    else:
        compatibility = "unknown"
        detail = "OpenRouter did not return structured output metadata for this model."

    return {
        "model": model.get("id", target_model),
        "exists": True,
        "name": model.get("name") or model.get("id", target_model),
        "description": model.get("description"),
        "context_length": model.get("context_length"),
        "pricing": model.get("pricing"),
        "supports_tools": supports_tools,
        "supports_json_schema": supports_json_schema,
        "compatibility": compatibility,
        "detail": detail,
        "supported_parameters": supported_parameters,
    }


def check_openrouter_models(model_ids: list[str]) -> list[dict[str, Any]]:
    """Validate a list of OpenRouter models in one catalog lookup."""
    unique_model_ids: list[str] = []
    for model_id in model_ids:
        normalized = model_id.strip()
        if normalized and normalized not in unique_model_ids:
            unique_model_ids.append(normalized)

    if not unique_model_ids:
        return []

    models = _fetch_openrouter_models()
    models_by_id = {
        str(item.get("id", "")).strip().lower(): item
        for item in models
    }

    results = []
    for model_id in unique_model_ids:
        model = models_by_id.get(model_id.lower())
        if model is None:
            results.append(
                {
                    "model": model_id,
                    "exists": False,
                    "compatibility": "unknown",
                    "detail": "Model not found in the current OpenRouter catalog.",
                    "supported_parameters": [],
                }
            )
            continue

        supported_parameters = sorted(
            {
                parameter
                for parameter in model.get("supported_parameters", [])
                if isinstance(parameter, str)
            }
        )
        supports_tools = "tools" in supported_parameters and "tool_choice" in supported_parameters
        supports_json_schema = (
            "response_format" in supported_parameters
            or "structured_outputs" in supported_parameters
        )

        if supports_tools:
            compatibility = "good"
            detail = (
                "Supports function calling, which matches the app's structured output path."
            )
        elif supports_json_schema:
            compatibility = "limited"
            detail = (
                "Supports JSON schema style outputs, but the app currently relies on "
                "function calling for structured output."
            )
        elif supported_parameters:
            compatibility = "unsupported"
            detail = "Does not advertise structured output support required by the app."
        else:
            compatibility = "unknown"
            detail = "OpenRouter did not return structured output metadata for this model."

        results.append(
            {
                "model": model.get("id", model_id),
                "exists": True,
                "name": model.get("name") or model.get("id", model_id),
                "description": model.get("description"),
                "context_length": model.get("context_length"),
                "pricing": model.get("pricing"),
                "supports_tools": supports_tools,
                "supports_json_schema": supports_json_schema,
                "compatibility": compatibility,
                "detail": detail,
                "supported_parameters": supported_parameters,
            }
        )

    return results
