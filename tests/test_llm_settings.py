"""Regression tests for draft-aware LLM settings and runtime resolution."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.api import settings_routes
from backend.app.api.main import app
from backend.app.database.connection import get_db
from backend.app.database.models import Base, LLMConfig
from backend.app.utils import crypto
from backend.app.utils.crypto import decrypt, encrypt, mask_key
from backend.app.utils.llm_factory import build_llm_from_settings, get_llm
from backend.app.utils.llm_settings import (
    PROVIDER_SPECS,
    WORKFLOWS,
    normalize_base_url,
)


ANTHROPIC_MODELS = {
    "kg_extraction": "claude-sonnet-4-5-20250929",
    "html_injection": "claude-haiku-4-5-20251001",
    "tooltip_suggestion": "claude-sonnet-4-5-20250929",
}
OPENAI_MODELS = {
    "kg_extraction": "gpt-4.1",
    "html_injection": "gpt-4.1-mini",
    "tooltip_suggestion": "gpt-4.1-mini",
}
OLLAMA_MODELS = {
    "kg_extraction": "qwen3-235b-a22b:cloud",
    "html_injection": "qwen3-14b:cloud",
    "tooltip_suggestion": "qwen3-32b:cloud",
}
CUSTOM_MODELS = {
    "kg_extraction": "custom-kg",
    "html_injection": "custom-html",
    "tooltip_suggestion": "custom-tooltip",
}


@dataclass
class LlmApiContext:
    client: TestClient
    session_factory: sessionmaker


@pytest.fixture
def llm_api(monkeypatch) -> LlmApiContext:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=engine,
    )

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(crypto, "_fernet", Fernet(Fernet.generate_key()))
    for env_name in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OLLAMA_API_KEY"):
        monkeypatch.delenv(env_name, raising=False)

    with TestClient(app, raise_server_exceptions=False) as client:
        yield LlmApiContext(client=client, session_factory=session_factory)

    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


def seed_config(
    context: LlmApiContext,
    *,
    provider: str,
    base_url: str | None,
    models: dict[str, str],
    api_key: str | None = None,
    active: bool = True,
) -> tuple[int, str | None]:
    encrypted = encrypt(api_key) if api_key else None
    with context.session_factory() as db:
        config = LLMConfig(
            provider=provider,
            base_url=base_url,
            api_key_enc=encrypted,
            models=models,
            is_active=active,
        )
        db.add(config)
        db.commit()
        return config.id, encrypted


def read_configs(context: LlmApiContext) -> list[LLMConfig]:
    with context.session_factory() as db:
        rows = db.query(LLMConfig).order_by(LLMConfig.id).all()
        return [
            LLMConfig(
                id=row.id,
                provider=row.provider,
                base_url=row.base_url,
                api_key_enc=row.api_key_enc,
                models=dict(row.models or {}),
                is_active=row.is_active,
            )
            for row in rows
        ]


def settings_body(
    provider: str,
    models: dict[str, str],
    *,
    base_url: str | None = None,
    api_key: str = "",
    clear_api_key: bool = False,
) -> dict[str, Any]:
    return {
        "provider": provider,
        "base_url": base_url,
        "api_key": api_key,
        "clear_api_key": clear_api_key,
        "models": models,
    }


class TestProviderCatalog:
    def test_declares_three_workflows_and_cost_aware_recommendations(self):
        assert WORKFLOWS == (
            "kg_extraction",
            "html_injection",
            "tooltip_suggestion",
        )
        assert PROVIDER_SPECS["anthropic"].recommended_models == ANTHROPIC_MODELS
        assert PROVIDER_SPECS["openai"].recommended_models == OPENAI_MODELS
        assert PROVIDER_SPECS["ollama"].recommended_models == OLLAMA_MODELS
        assert PROVIDER_SPECS["custom"].recommended_models == {}

    @pytest.mark.parametrize(
        ("provider", "raw_url", "expected"),
        [
            ("anthropic", None, "https://api.anthropic.com"),
            ("openai", " https://API.OPENAI.COM/v1/ ", "https://api.openai.com/v1"),
            ("ollama", None, "https://ollama.com/v1"),
            ("custom", "http://localhost:11434/v1/", "http://localhost:11434/v1"),
        ],
    )
    def test_normalizes_effective_http_endpoints(self, provider, raw_url, expected):
        assert normalize_base_url(provider, raw_url) == expected

    @pytest.mark.parametrize(
        "raw_url",
        ["", "localhost:11434/v1", "ftp://example.test/v1", "https://example.test/v1?key=x"],
    )
    def test_rejects_invalid_custom_endpoints(self, raw_url):
        with pytest.raises(ValueError, match="HTTP"):
            normalize_base_url("custom", raw_url)


class TestLlmSettingsApi:
    def test_get_without_row_returns_normalized_defaults_and_environment_source(
        self,
        llm_api,
        monkeypatch,
    ):
        environment_key = "sk-ant-environment-secret"
        monkeypatch.setenv("ANTHROPIC_API_KEY", environment_key)

        response = llm_api.client.get("/api/settings/llm")

        assert response.status_code == 200
        payload = response.json()
        assert payload == {
            "id": 0,
            "provider": "anthropic",
            "base_url": "https://api.anthropic.com",
            "api_key_masked": mask_key(environment_key),
            "has_api_key": True,
            "credential_source": "environment",
            "credential_required": True,
            "models": ANTHROPIC_MODELS,
            "is_active": False,
        }
        assert environment_key not in response.text

    def test_get_prefers_database_credential_and_fills_missing_workflows(
        self,
        llm_api,
        monkeypatch,
    ):
        database_key = "sk-openai-database-secret"
        environment_key = "sk-openai-environment-secret"
        monkeypatch.setenv("OPENAI_API_KEY", environment_key)
        config_id, encrypted = seed_config(
            llm_api,
            provider="openai",
            base_url="https://api.openai.com/v1/",
            models={"kg_extraction": "user-kg"},
            api_key=database_key,
        )

        response = llm_api.client.get("/api/settings/llm")

        assert response.status_code == 200
        payload = response.json()
        assert payload["id"] == config_id
        assert payload["base_url"] == "https://api.openai.com/v1"
        assert payload["credential_source"] == "database"
        assert payload["api_key_masked"] == mask_key(database_key)
        assert payload["models"] == {**OPENAI_MODELS, "kg_extraction": "user-kg"}
        assert database_key not in response.text
        assert environment_key not in response.text
        assert encrypted not in response.text

    def test_get_uses_provider_environment_credential_when_database_key_is_absent(
        self,
        llm_api,
        monkeypatch,
    ):
        environment_key = "ollama-environment-secret"
        monkeypatch.setenv("OLLAMA_API_KEY", environment_key)
        seed_config(
            llm_api,
            provider="ollama",
            base_url=None,
            models=OLLAMA_MODELS,
        )

        response = llm_api.client.get("/api/settings/llm")

        assert response.status_code == 200
        assert response.json()["credential_source"] == "environment"
        assert response.json()["api_key_masked"] == mask_key(environment_key)
        assert environment_key not in response.text

    def test_save_encrypts_replacement_and_returns_no_plaintext(self, llm_api):
        plaintext = "sk-ant-replacement-secret"

        response = llm_api.client.put(
            "/api/settings/llm",
            json=settings_body(
                "anthropic",
                ANTHROPIC_MODELS,
                api_key=plaintext,
            ),
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["credential_source"] == "database"
        assert payload["api_key_masked"] == mask_key(plaintext)
        assert plaintext not in response.text
        rows = read_configs(llm_api)
        assert len(rows) == 1
        assert rows[0].api_key_enc != plaintext
        assert decrypt(rows[0].api_key_enc) == plaintext

    def test_blank_key_preserves_database_key_only_for_same_normalized_connection(
        self,
        llm_api,
    ):
        _, encrypted = seed_config(
            llm_api,
            provider="openai",
            base_url="https://api.openai.com/v1/",
            models=OPENAI_MODELS,
            api_key="sk-openai-preserved-secret",
        )

        response = llm_api.client.put(
            "/api/settings/llm",
            json=settings_body(
                "openai",
                {**OPENAI_MODELS, "html_injection": "cheap-html"},
                base_url=" HTTPS://API.OPENAI.COM/v1 ",
            ),
        )

        assert response.status_code == 200
        row = read_configs(llm_api)[0]
        assert row.api_key_enc == encrypted
        assert row.base_url == "https://api.openai.com/v1"
        assert row.models["html_injection"] == "cheap-html"

    def test_connection_change_does_not_transfer_database_credential(self, llm_api):
        seed_config(
            llm_api,
            provider="anthropic",
            base_url=None,
            models=ANTHROPIC_MODELS,
            api_key="sk-ant-do-not-transfer",
        )

        response = llm_api.client.put(
            "/api/settings/llm",
            json=settings_body(
                "custom",
                CUSTOM_MODELS,
                base_url="http://localhost:11434/v1",
            ),
        )

        assert response.status_code == 200
        assert response.json()["credential_source"] == "none"
        row = read_configs(llm_api)[0]
        assert row.provider == "custom"
        assert row.api_key_enc is None

    def test_required_connection_change_without_credential_rolls_back(self, llm_api):
        _, encrypted = seed_config(
            llm_api,
            provider="anthropic",
            base_url=None,
            models=ANTHROPIC_MODELS,
            api_key="sk-ant-original-secret",
        )

        response = llm_api.client.put(
            "/api/settings/llm",
            json=settings_body(
                "openai",
                OPENAI_MODELS,
                base_url="https://proxy.example.test/v1",
            ),
        )

        assert response.status_code == 422
        rows = read_configs(llm_api)
        assert len(rows) == 1
        assert rows[0].provider == "anthropic"
        assert rows[0].api_key_enc == encrypted
        assert rows[0].is_active is True

    def test_explicit_clear_removes_only_database_key_and_reveals_environment_source(
        self,
        llm_api,
        monkeypatch,
    ):
        environment_key = "sk-openai-environment-secret"
        monkeypatch.setenv("OPENAI_API_KEY", environment_key)
        seed_config(
            llm_api,
            provider="openai",
            base_url=None,
            models=OPENAI_MODELS,
            api_key="sk-openai-database-secret",
        )

        response = llm_api.client.put(
            "/api/settings/llm",
            json=settings_body(
                "openai",
                OPENAI_MODELS,
                clear_api_key=True,
            ),
        )

        assert response.status_code == 200
        assert response.json()["credential_source"] == "environment"
        assert response.json()["api_key_masked"] == mask_key(environment_key)
        assert read_configs(llm_api)[0].api_key_enc is None

    def test_explicit_clear_without_required_environment_credential_is_rejected(
        self,
        llm_api,
    ):
        _, encrypted = seed_config(
            llm_api,
            provider="anthropic",
            base_url=None,
            models=ANTHROPIC_MODELS,
            api_key="sk-ant-database-secret",
        )

        response = llm_api.client.put(
            "/api/settings/llm",
            json=settings_body(
                "anthropic",
                ANTHROPIC_MODELS,
                clear_api_key=True,
            ),
        )

        assert response.status_code == 422
        assert read_configs(llm_api)[0].api_key_enc == encrypted

    @pytest.mark.parametrize(
        "body",
        [
            settings_body("unknown", ANTHROPIC_MODELS, api_key="secret"),
            settings_body(
                "custom",
                CUSTOM_MODELS,
                base_url="not-a-url",
            ),
            settings_body(
                "custom",
                {**CUSTOM_MODELS, "html_injection": "   "},
                base_url="https://example.test/v1",
            ),
            settings_body(
                "anthropic",
                ANTHROPIC_MODELS,
                api_key="replacement",
                clear_api_key=True,
            ),
        ],
    )
    def test_save_rejects_invalid_provider_endpoint_models_and_key_intent(
        self,
        llm_api,
        body,
    ):
        response = llm_api.client.put("/api/settings/llm", json=body)

        assert response.status_code == 422
        assert read_configs(llm_api) == []

    def test_save_rolls_back_and_sanitizes_encryption_failure(
        self,
        llm_api,
        monkeypatch,
    ):
        _, encrypted = seed_config(
            llm_api,
            provider="anthropic",
            base_url=None,
            models=ANTHROPIC_MODELS,
            api_key="sk-ant-original-secret",
        )
        monkeypatch.setattr(
            settings_routes,
            "encrypt",
            lambda _value: (_ for _ in ()).throw(RuntimeError("secret leaked here")),
        )

        response = llm_api.client.put(
            "/api/settings/llm",
            json=settings_body(
                "anthropic",
                ANTHROPIC_MODELS,
                api_key="sk-ant-new-secret",
            ),
        )

        assert response.status_code == 500
        assert "secret leaked here" not in response.text
        row = read_configs(llm_api)[0]
        assert row.api_key_enc == encrypted
        assert row.is_active is True


class FakeModelsResponse:
    def __init__(self, status_code: int, payload: Any):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def fake_async_client(
    response: FakeModelsResponse,
    calls: list[dict[str, Any]],
) -> type:
    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            calls.append({"constructor": kwargs})

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def get(self, url, *, headers):
            calls.append({"url": url, "headers": headers})
            return response

    return FakeAsyncClient


class TestModelDiscovery:
    def test_posts_draft_secret_in_body_and_uses_provider_result(
        self,
        llm_api,
        monkeypatch,
    ):
        secret = "sk-openai-draft-secret"
        calls: list[dict[str, Any]] = []
        monkeypatch.setattr(
            settings_routes.httpx,
            "AsyncClient",
            fake_async_client(
                FakeModelsResponse(200, {"data": [{"id": "model-b"}, {"id": "model-a"}]}),
                calls,
            ),
        )

        response = llm_api.client.post(
            "/api/settings/llm/models",
            json={
                "provider": "openai",
                "base_url": "https://draft.example.test/v1/",
                "api_key": secret,
                "clear_api_key": False,
            },
        )

        assert response.status_code == 200
        assert response.request.url.query == b""
        assert response.json() == {
            "provider": "openai",
            "base_url": "https://draft.example.test/v1",
            "source": "provider",
            "models": [
                {"id": "model-a", "name": "model-a"},
                {"id": "model-b", "name": "model-b"},
            ],
            "warning": None,
        }
        request_call = calls[-1]
        assert request_call["url"] == "https://draft.example.test/v1/models"
        assert secret not in request_call["url"]
        assert request_call["headers"] == {"Authorization": f"Bearer {secret}"}

    def test_discovery_uses_saved_key_only_for_same_connection(
        self,
        llm_api,
        monkeypatch,
    ):
        secret = "sk-openai-saved-secret"
        seed_config(
            llm_api,
            provider="openai",
            base_url="https://api.openai.com/v1",
            models=OPENAI_MODELS,
            api_key=secret,
        )
        calls: list[dict[str, Any]] = []
        monkeypatch.setattr(
            settings_routes.httpx,
            "AsyncClient",
            fake_async_client(FakeModelsResponse(200, {"data": []}), calls),
        )

        same = llm_api.client.post(
            "/api/settings/llm/models",
            json={
                "provider": "openai",
                "base_url": "https://api.openai.com/v1/",
                "api_key": "",
                "clear_api_key": False,
            },
        )
        changed = llm_api.client.post(
            "/api/settings/llm/models",
            json={
                "provider": "openai",
                "base_url": "https://proxy.example.test/v1",
                "api_key": "",
                "clear_api_key": False,
            },
        )

        assert same.status_code == 200
        assert changed.status_code == 200
        request_calls = [call for call in calls if "url" in call]
        assert request_calls[0]["headers"] == {"Authorization": f"Bearer {secret}"}
        assert request_calls[1]["headers"] == {}

    def test_discovery_returns_recoverable_catalog_warning_on_upstream_failure(
        self,
        llm_api,
        monkeypatch,
    ):
        calls: list[dict[str, Any]] = []
        monkeypatch.setattr(
            settings_routes.httpx,
            "AsyncClient",
            fake_async_client(FakeModelsResponse(503, {"detail": "secret upstream error"}), calls),
        )

        response = llm_api.client.post(
            "/api/settings/llm/models",
            json={
                "provider": "ollama",
                "base_url": None,
                "api_key": "draft-key",
                "clear_api_key": False,
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["source"] == "catalog"
        assert payload["models"]
        assert payload["warning"]
        assert "secret upstream error" not in response.text

    def test_anthropic_discovery_uses_catalog_without_http(self, llm_api, monkeypatch):
        constructor = pytest.fail
        monkeypatch.setattr(settings_routes.httpx, "AsyncClient", constructor)

        response = llm_api.client.post(
            "/api/settings/llm/models",
            json={
                "provider": "anthropic",
                "base_url": None,
                "api_key": "sk-ant-draft",
                "clear_api_key": False,
            },
        )

        assert response.status_code == 200
        assert response.json()["source"] == "catalog"
        assert response.json()["warning"] is None
        assert {item["id"] for item in response.json()["models"]} >= set(ANTHROPIC_MODELS.values())


class FakeInvocation:
    def __init__(self, *, actual_model: str = "actual-model", error: Exception | None = None):
        self.model_name = actual_model
        self.error = error
        self.prompts: list[str] = []

    def invoke(self, prompt: str):
        self.prompts.append(prompt)
        if self.error:
            raise self.error
        return type("Response", (), {"content": "OK"})()


class TestDraftConnectionTest:
    def test_uses_exact_unsaved_workflow_model_once_without_database_mutation(
        self,
        llm_api,
        monkeypatch,
    ):
        seed_config(
            llm_api,
            provider="anthropic",
            base_url=None,
            models=ANTHROPIC_MODELS,
            api_key="sk-ant-saved-secret",
        )
        before = read_configs(llm_api)
        fake_llm = FakeInvocation(actual_model="server-selected-html")
        builder_calls: list[dict[str, Any]] = []

        def fake_builder(**kwargs):
            builder_calls.append(kwargs)
            return fake_llm

        monkeypatch.setattr(
            settings_routes,
            "build_llm_from_settings",
            fake_builder,
            raising=False,
        )

        response = llm_api.client.post(
            "/api/settings/llm/test",
            json={
                "provider": "openai",
                "base_url": "https://draft.example.test/v1",
                "api_key": "sk-openai-unsaved-secret",
                "clear_api_key": False,
                "workflow": "html_injection",
                "model": "cheap-unsaved-model",
            },
        )

        assert response.status_code == 200
        assert response.json() == {
            "success": True,
            "message": "Connection succeeded.",
            "workflow": "html_injection",
            "model_used": "server-selected-html",
        }
        assert builder_calls == [{
            "provider": "openai",
            "base_url": "https://draft.example.test/v1",
            "api_key": "sk-openai-unsaved-secret",
            "models": {"html_injection": "cheap-unsaved-model"},
            "workflow": "html_injection",
        }]
        assert len(fake_llm.prompts) == 1
        after = read_configs(llm_api)
        assert [(row.provider, row.api_key_enc, row.models) for row in after] == [
            (row.provider, row.api_key_enc, row.models) for row in before
        ]

    def test_sanitizes_failure_and_never_commits_draft_secret(
        self,
        llm_api,
        monkeypatch,
    ):
        secret = "sk-openai-never-return-me"
        fake_llm = FakeInvocation(error=RuntimeError(f"Authorization Bearer {secret}"))
        monkeypatch.setattr(
            settings_routes,
            "build_llm_from_settings",
            lambda **_kwargs: fake_llm,
            raising=False,
        )

        response = llm_api.client.post(
            "/api/settings/llm/test",
            json={
                "provider": "openai",
                "base_url": None,
                "api_key": secret,
                "clear_api_key": False,
                "workflow": "kg_extraction",
                "model": "draft-model",
            },
        )

        assert response.status_code == 200
        assert response.json()["success"] is False
        assert response.json()["model_used"] == "draft-model"
        assert secret not in response.text
        assert read_configs(llm_api) == []


class TestLlmFactory:
    @pytest.fixture
    def constructor_spies(self, monkeypatch):
        import langchain_anthropic
        import langchain_openai

        calls: list[tuple[str, dict[str, Any]]] = []

        def anthropic_constructor(**kwargs):
            calls.append(("anthropic", kwargs))
            return type("AnthropicModel", (), kwargs)()

        def openai_constructor(**kwargs):
            calls.append(("openai-compatible", kwargs))
            return type("OpenAIModel", (), kwargs)()

        monkeypatch.setattr(langchain_anthropic, "ChatAnthropic", anthropic_constructor)
        monkeypatch.setattr(langchain_openai, "ChatOpenAI", openai_constructor)
        return calls

    @pytest.mark.parametrize(
        ("provider", "models", "workflow", "expected_model", "expected_kind"),
        [
            ("anthropic", ANTHROPIC_MODELS, "kg_extraction", ANTHROPIC_MODELS["kg_extraction"], "anthropic"),
            ("openai", {}, "html_injection", OPENAI_MODELS["html_injection"], "openai-compatible"),
            ("ollama", {}, "tooltip_suggestion", OLLAMA_MODELS["tooltip_suggestion"], "openai-compatible"),
        ],
    )
    def test_uses_explicit_or_provider_specific_recommended_model(
        self,
        provider,
        models,
        workflow,
        expected_model,
        expected_kind,
        constructor_spies,
        monkeypatch,
    ):
        spec = PROVIDER_SPECS[provider]
        if spec.credential_env:
            monkeypatch.setenv(spec.credential_env, "environment-key")

        build_llm_from_settings(
            provider=provider,
            base_url=None,
            api_key=None,
            models=models,
            workflow=workflow,
        )

        kind, kwargs = constructor_spies[-1]
        assert kind == expected_kind
        assert kwargs["model"] == expected_model
        assert not kwargs["model"].startswith("claude-") or provider == "anthropic"

    def test_ignores_incompatible_legacy_default_for_openai(
        self,
        constructor_spies,
        monkeypatch,
    ):
        monkeypatch.setenv("OPENAI_API_KEY", "environment-key")

        build_llm_from_settings(
            provider="openai",
            base_url=None,
            api_key=None,
            models={"default": "claude-sonnet-legacy"},
            workflow="kg_extraction",
        )

        assert constructor_spies[-1][1]["model"] == OPENAI_MODELS["kg_extraction"]

    def test_accepts_compatible_legacy_default_for_selected_provider(
        self,
        constructor_spies,
        monkeypatch,
    ):
        monkeypatch.setenv("OPENAI_API_KEY", "environment-key")

        build_llm_from_settings(
            provider="openai",
            base_url=None,
            api_key=None,
            models={"default": "gpt-legacy-compatible"},
            workflow="tooltip_suggestion",
        )

        assert constructor_spies[-1][1]["model"] == "gpt-legacy-compatible"

    def test_custom_provider_without_explicit_or_legacy_model_fails_clearly(
        self,
        constructor_spies,
    ):
        with pytest.raises(ValueError, match="tooltip_suggestion"):
            build_llm_from_settings(
                provider="custom",
                base_url="http://localhost:11434/v1",
                api_key=None,
                models={},
                workflow="tooltip_suggestion",
            )

        assert constructor_spies == []

    def test_env_only_startup_remains_anthropic_and_honors_html_model_override(
        self,
        constructor_spies,
        monkeypatch,
    ):
        monkeypatch.setattr("backend.app.utils.llm_factory._get_active_config", lambda: None)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-environment")
        monkeypatch.setenv("HTML_INJECTION_MODEL", "claude-cheap-legacy-override")

        get_llm("html_injection", max_tokens=8000, temperature=0)

        kind, kwargs = constructor_spies[-1]
        assert kind == "anthropic"
        assert kwargs["model"] == "claude-cheap-legacy-override"
        assert kwargs["api_key"] == "sk-ant-environment"
        assert kwargs["max_tokens"] == 8000
        assert kwargs["temperature"] == 0

    def test_active_custom_config_uses_decrypted_key_and_exact_workflow_model(
        self,
        constructor_spies,
        monkeypatch,
    ):
        encrypted = encrypt("custom-database-key")
        monkeypatch.setattr(
            "backend.app.utils.llm_factory._get_active_config",
            lambda: {
                "provider": "custom",
                "base_url": "https://custom.example.test/v1",
                "api_key_enc": encrypted,
                "models": CUSTOM_MODELS,
            },
        )

        get_llm("tooltip_suggestion")

        kind, kwargs = constructor_spies[-1]
        assert kind == "openai-compatible"
        assert kwargs["model"] == CUSTOM_MODELS["tooltip_suggestion"]
        assert kwargs["api_key"] == "custom-database-key"
        assert kwargs["base_url"] == "https://custom.example.test/v1"