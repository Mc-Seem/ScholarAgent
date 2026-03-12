"""
Tests for shared AI provider configuration.
"""

from types import SimpleNamespace
import pytest

from backend.app import llm


class DummyChatModel:
    """Capture model init kwargs for assertions."""

    def __init__(self, **kwargs):
        self.kwargs = kwargs


def test_anthropic_defaults(monkeypatch):
    """Anthropic remains the default provider and fixed model mapping."""
    monkeypatch.delenv("HTML_INJECTION_MODEL", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    assert llm.get_llm_provider() == "anthropic"
    assert llm.get_default_chat_model_name() == llm.DEFAULT_ANTHROPIC_MODEL
    assert llm.get_html_injection_model_name() == llm.DEFAULT_ANTHROPIC_HTML_INJECTION_MODEL


def test_request_scoped_openrouter_model_overrides_env(monkeypatch):
    """Request config should fully define the OpenRouter model selection."""
    config = llm.AIConfig(
        provider="openrouter",
        openrouter=llm.OpenRouterPreferences(
            shared_model="anthropic/claude-3.7-sonnet",
            html_injection_model="openai/gpt-4.1-mini",
        ),
    )

    provider, knowledge_model = llm.resolve_chat_settings(llm.TASK_KNOWLEDGE_GRAPH, config)
    _, html_model = llm.resolve_chat_settings(llm.TASK_HTML_INJECTION, config)

    assert provider == "openrouter"
    assert knowledge_model == "anthropic/claude-3.7-sonnet"
    assert html_model == "openai/gpt-4.1-mini"


def test_anthropic_html_injection_model_honors_env_override(monkeypatch):
    """Anthropic keeps the legacy server-side HTML injection override."""
    monkeypatch.setenv("HTML_INJECTION_MODEL", "claude-sonnet-4-5-20250929")

    assert llm.get_html_injection_model_name() == "claude-sonnet-4-5-20250929"
    capabilities = llm.get_ai_capabilities()
    assert (
        capabilities["providers"]["anthropic"]["fixed_models"][llm.TASK_HTML_INJECTION]["id"]
        == llm.DEFAULT_ANTHROPIC_HTML_INJECTION_MODEL
    )


def test_openrouter_html_model_falls_back_to_shared_model(monkeypatch):
    """HTML injection reuses the shared OpenRouter model unless overridden."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.delenv("HTML_INJECTION_MODEL", raising=False)

    config = llm.AIConfig(
        provider="openrouter",
        openrouter=llm.OpenRouterPreferences(
            shared_model="anthropic/claude-3.7-sonnet",
        ),
    )

    assert llm.get_html_injection_model_name(config) == "anthropic/claude-3.7-sonnet"


def test_openrouter_does_not_use_html_injection_env_override(monkeypatch):
    """OpenRouter model selection must come from request-scoped UI preferences."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setenv("HTML_INJECTION_MODEL", "claude-sonnet-4-5-20250929")

    with pytest.raises(ValueError, match="requires a shared model or a task-specific model"):
        llm.resolve_chat_settings(
            llm.TASK_HTML_INJECTION,
            llm.AIConfig(provider="openrouter"),
        )


def test_validate_ai_config_requires_anthropic_credentials(monkeypatch):
    """Preflight validation should fail before Anthropic work starts without a key."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        llm.validate_ai_config(tasks=(llm.TASK_TOOLTIP_FILTER,))


def test_validate_ai_config_requires_openrouter_model_selection(monkeypatch):
    """OpenRouter preflight should reject requests without resolved task models."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    with pytest.raises(ValueError, match="requires a shared model or a task-specific model"):
        llm.validate_ai_config(
            llm.AIConfig(provider="openrouter"),
            tasks=(llm.TASK_HTML_INJECTION,),
        )


def test_create_chat_model_uses_openrouter(monkeypatch):
    """OpenRouter client picks up the task model."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    def fake_import(name: str):
        assert name == "langchain_openrouter"
        return SimpleNamespace(ChatOpenRouter=DummyChatModel)

    monkeypatch.setattr(llm, "import_module", fake_import)

    model = llm.create_chat_model(
        task=llm.TASK_TOOLTIP_FILTER,
        config={
            "provider": "openrouter",
            "openrouter": {"shared_model": "anthropic/claude-3.7-sonnet"},
        },
        max_tokens=1024,
    )

    assert isinstance(model, DummyChatModel)
    assert model.kwargs == {
        "model": "anthropic/claude-3.7-sonnet",
        "max_tokens": 1024,
    }


def test_create_chat_model_uses_anthropic(monkeypatch):
    """Anthropic client still receives fixed task defaults."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    def fake_import(name: str):
        assert name == "langchain_anthropic"
        return SimpleNamespace(ChatAnthropic=DummyChatModel)

    monkeypatch.setattr(llm, "import_module", fake_import)

    model = llm.create_chat_model(
        task=llm.TASK_HTML_INJECTION,
        max_tokens=2048,
    )

    assert isinstance(model, DummyChatModel)
    assert model.kwargs == {
        "model": llm.DEFAULT_ANTHROPIC_HTML_INJECTION_MODEL,
        "max_tokens": 2048,
    }


def test_get_ai_capabilities_reports_configured_providers(monkeypatch):
    """Capabilities should expose which server-side providers are usable."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-key")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    capabilities = llm.get_ai_capabilities()

    assert capabilities["providers"]["anthropic"]["available"] is True
    assert capabilities["providers"]["openrouter"]["available"] is False
    assert capabilities["default_provider"] == "anthropic"


def test_get_ai_capabilities_does_not_default_to_openrouter_without_ui_models(monkeypatch):
    """OpenRouter alone should still require a request-scoped model selection."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "openrouter-key")

    capabilities = llm.get_ai_capabilities()

    assert capabilities["providers"]["openrouter"]["available"] is True
    assert capabilities["default_provider"] is None


def test_get_llm_provider_uses_only_available_provider(monkeypatch):
    """Requests still resolve to OpenRouter when it is the only configured backend key."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "openrouter-key")

    assert llm.get_llm_provider() == "openrouter"


def test_check_openrouter_models_grades_function_calling_support(monkeypatch):
    """Model checks should distinguish good and limited OpenRouter choices."""
    monkeypatch.setattr(
        llm,
        "_fetch_openrouter_models",
        lambda: [
            {
                "id": "good/model",
                "name": "Good Model",
                "supported_parameters": ["tools", "tool_choice", "response_format"],
            },
            {
                "id": "limited/model",
                "name": "Limited Model",
                "supported_parameters": ["response_format"],
            },
        ],
    )

    results = llm.check_openrouter_models(["good/model", "limited/model", "missing/model"])

    assert results[0]["compatibility"] == "good"
    assert results[0]["supports_tools"] is True
    assert results[1]["compatibility"] == "limited"
    assert results[2]["exists"] is False
