"""Shared provider metadata and normalization for LLM settings."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal, Mapping, cast
from urllib.parse import urlsplit, urlunsplit


LlmProvider = Literal["anthropic", "openai", "ollama", "custom"]
Workflow = Literal["kg_extraction", "html_injection", "tooltip_suggestion"]
CredentialSource = Literal["database", "environment", "none"]

PROVIDERS: tuple[LlmProvider, ...] = (
    "anthropic",
    "openai",
    "ollama",
    "custom",
)
WORKFLOWS: tuple[Workflow, ...] = (
    "kg_extraction",
    "html_injection",
    "tooltip_suggestion",
)


@dataclass(frozen=True)
class ProviderModel:
    id: str
    name: str


@dataclass(frozen=True)
class ProviderSpec:
    id: LlmProvider
    default_base_url: str | None
    credential_required: bool
    credential_env: str | None
    supports_model_discovery: bool
    known_models: tuple[ProviderModel, ...]
    recommended_models: Mapping[Workflow, str]


PROVIDER_SPECS: dict[LlmProvider, ProviderSpec] = {
    "anthropic": ProviderSpec(
        id="anthropic",
        default_base_url="https://api.anthropic.com",
        credential_required=True,
        credential_env="ANTHROPIC_API_KEY",
        supports_model_discovery=False,
        known_models=(
            ProviderModel("claude-sonnet-4-5-20250929", "Claude Sonnet 4.5"),
            ProviderModel("claude-haiku-4-5-20251001", "Claude Haiku 4.5"),
            ProviderModel("claude-opus-4-1-20250805", "Claude Opus 4.1"),
        ),
        recommended_models={
            "kg_extraction": "claude-sonnet-4-5-20250929",
            "html_injection": "claude-haiku-4-5-20251001",
            "tooltip_suggestion": "claude-sonnet-4-5-20250929",
        },
    ),
    "openai": ProviderSpec(
        id="openai",
        default_base_url="https://api.openai.com/v1",
        credential_required=True,
        credential_env="OPENAI_API_KEY",
        supports_model_discovery=True,
        known_models=(
            ProviderModel("gpt-4.1", "GPT-4.1"),
            ProviderModel("gpt-4.1-mini", "GPT-4.1 mini"),
            ProviderModel("gpt-4.1-nano", "GPT-4.1 nano"),
        ),
        recommended_models={
            "kg_extraction": "gpt-4.1",
            "html_injection": "gpt-4.1-mini",
            "tooltip_suggestion": "gpt-4.1-mini",
        },
    ),
    "ollama": ProviderSpec(
        id="ollama",
        default_base_url="https://ollama.com/v1",
        credential_required=True,
        credential_env="OLLAMA_API_KEY",
        supports_model_discovery=True,
        known_models=(
            ProviderModel("qwen3-235b-a22b:cloud", "Qwen3 235B (cloud)"),
            ProviderModel("qwen3-32b:cloud", "Qwen3 32B (cloud)"),
            ProviderModel("qwen3-14b:cloud", "Qwen3 14B (cloud)"),
            ProviderModel("deepseek-r1:cloud", "DeepSeek R1 (cloud)"),
            ProviderModel("llama3.3-70b:cloud", "Llama 3.3 70B (cloud)"),
            ProviderModel("gpt-oss-120b:cloud", "GPT-OSS 120B (cloud)"),
        ),
        recommended_models={
            "kg_extraction": "qwen3-235b-a22b:cloud",
            "html_injection": "qwen3-14b:cloud",
            "tooltip_suggestion": "qwen3-32b:cloud",
        },
    ),
    "custom": ProviderSpec(
        id="custom",
        default_base_url=None,
        credential_required=False,
        credential_env=None,
        supports_model_discovery=True,
        known_models=(),
        recommended_models={},
    ),
}


def get_provider_spec(provider: str) -> ProviderSpec:
    """Return provider metadata or raise a user-facing validation error."""
    try:
        return PROVIDER_SPECS[cast(LlmProvider, provider)]
    except KeyError as error:
        raise ValueError(f"Unknown provider: {provider}") from error


def normalize_base_url(provider: str, base_url: str | None) -> str:
    """Return a canonical effective HTTP(S) endpoint for a provider."""
    spec = get_provider_spec(provider)
    candidate = (base_url or spec.default_base_url or "").strip()
    parsed = urlsplit(candidate)
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("A valid HTTP(S) base URL without credentials, query, or fragment is required.")

    host = parsed.hostname.lower()
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    netloc = f"{host}:{parsed.port}" if parsed.port is not None else host
    path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme.lower(), netloc, path, "", ""))


def connection_identity(provider: str, base_url: str | None) -> tuple[LlmProvider, str]:
    """Build the normalized identity used to decide whether a DB key is reusable."""
    spec = get_provider_spec(provider)
    return spec.id, normalize_base_url(provider, base_url)


def credential_from_environment(provider: str) -> str | None:
    """Read the configured provider credential without exposing its name to clients."""
    env_name = get_provider_spec(provider).credential_env
    if not env_name:
        return None
    value = os.getenv(env_name)
    return value if value and value.strip() else None


def normalize_workflow_models(
    provider: str,
    models: Mapping[str, object] | None,
) -> dict[Workflow, str]:
    """Fill absent workflow values from provider recommendations for display/runtime."""
    values = models or {}
    recommendations = get_provider_spec(provider).recommended_models
    normalized: dict[Workflow, str] = {}
    for workflow in WORKFLOWS:
        raw = values.get(workflow)
        explicit = raw.strip() if isinstance(raw, str) else ""
        normalized[workflow] = explicit or recommendations.get(workflow, "")
    return normalized


def validate_workflow_models(models: Mapping[str, object] | None) -> dict[Workflow, str]:
    """Require one explicit, non-empty model ID for every user-facing workflow."""
    values = models or {}
    normalized: dict[Workflow, str] = {}
    missing: list[str] = []
    for workflow in WORKFLOWS:
        raw = values.get(workflow)
        value = raw.strip() if isinstance(raw, str) else ""
        if not value:
            missing.append(workflow)
        normalized[workflow] = value
    if missing:
        raise ValueError(f"Model is required for: {', '.join(missing)}")
    return normalized


def known_models(provider: str) -> list[ProviderModel]:
    """Return a copy of the provider's non-authoritative model catalog."""
    return list(get_provider_spec(provider).known_models)


def _legacy_model_is_compatible(provider: LlmProvider, model: str) -> bool:
    lowered = model.lower()
    if provider == "anthropic":
        return lowered.startswith("claude-")
    if provider == "openai":
        return lowered.startswith(("gpt-", "chatgpt-", "o1", "o3", "o4"))
    if provider == "ollama":
        return not lowered.startswith(("claude-", "gpt-", "chatgpt-", "o1", "o3", "o4"))
    return True


def resolve_workflow_model(
    provider: str,
    models: Mapping[str, object] | None,
    workflow: Workflow,
) -> str:
    """Resolve explicit, compatible legacy, then provider-recommended workflow model."""
    if workflow not in WORKFLOWS:
        raise ValueError(f"Unknown workflow: {workflow}")

    spec = get_provider_spec(provider)
    values = models or {}
    explicit = values.get(workflow)
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()

    for legacy_key in ("default", "model"):
        legacy = values.get(legacy_key)
        if (
            isinstance(legacy, str)
            and legacy.strip()
            and _legacy_model_is_compatible(spec.id, legacy.strip())
        ):
            return legacy.strip()

    recommendation = spec.recommended_models.get(workflow)
    if recommendation:
        return recommendation
    raise ValueError(
        f"No model configured for workflow '{workflow}' and provider '{provider}'."
    )