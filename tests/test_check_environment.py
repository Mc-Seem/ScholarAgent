"""Tests for the source-install environment doctor."""

import subprocess

from scripts import check_environment


def completed(command, stdout="", returncode=0, stderr=""):
    return subprocess.CompletedProcess(command, returncode, stdout=stdout, stderr=stderr)


def test_platform_requires_native_apple_silicon():
    assert check_environment.check_platform("Darwin", "arm64") == []

    errors = check_environment.check_platform("Darwin", "x86_64")

    assert "without Rosetta" in errors[0]
    assert "arm64" in errors[0]


def test_python_requires_3_12():
    assert check_environment.check_python((3, 12)) == []

    errors = check_environment.check_python((3, 13))

    assert "Python 3.12 is required" in errors[0]
    assert "mise install" in errors[0]


def test_node_requires_pinned_version():
    errors = check_environment.check_node(which=lambda command: None)
    assert "Node.js 24.18.0" in errors[0]
    assert "mise install" in errors[0]

    errors = check_environment.check_node(
        which=lambda command: "/opt/mise/bin/node",
        run=lambda command, **kwargs: completed(command, stdout="v22.0.0\n"),
    )
    assert "found 22.0.0" in errors[0]


def test_load_configuration_requires_env_file(tmp_path):
    config, errors = check_environment.load_configuration(tmp_path, environ={})

    assert config is None
    assert "cp .env.example .env" in errors[0]


def test_load_configuration_requires_database_url(tmp_path):
    (tmp_path / ".env").write_text("LATEXML_USE_DOCKER=false\n")

    config, errors = check_environment.load_configuration(tmp_path, environ={})

    assert config is None
    assert "Set DATABASE_URL" in errors[0]


def test_load_configuration_requires_explicit_compiler_mode(tmp_path):
    (tmp_path / ".env").write_text(
        "DATABASE_URL=postgresql://scholaragent:secret@localhost/scholaragent\n"
    )

    config, errors = check_environment.load_configuration(tmp_path, environ={})

    assert config is None
    assert "Set LATEXML_USE_DOCKER=false" in errors[0]


def test_load_configuration_rejects_invalid_compiler_mode(tmp_path):
    (tmp_path / ".env").write_text(
        "DATABASE_URL=postgresql://scholaragent:secret@localhost/scholaragent\n"
        "LATEXML_USE_DOCKER=sometimes\n"
    )

    config, errors = check_environment.load_configuration(tmp_path, environ={})

    assert config is None
    assert "must be `true` or `false`" in errors[0]


def test_environment_overrides_dotenv_values(tmp_path):
    (tmp_path / ".env").write_text(
        "DATABASE_URL=postgresql://wrong@localhost/wrong\n"
        "LATEXML_USE_DOCKER=true\n"
    )

    config, errors = check_environment.load_configuration(
        tmp_path,
        environ={
            "DATABASE_URL": "postgresql://scholaragent@localhost/scholaragent",
            "LATEXML_USE_DOCKER": "false",
        },
    )

    assert errors == []
    assert config == check_environment.Configuration(
        database_url="postgresql://scholaragent@localhost/scholaragent",
        use_docker=False,
    )


def test_native_compiler_requires_working_latexmlc():
    errors = check_environment.check_compiler(False, which=lambda command: None)
    assert "brew install latexml" in errors[0]

    assert check_environment.check_compiler(
        False,
        which=lambda command: "/opt/homebrew/bin/latexmlc",
        run=lambda command, **kwargs: completed(command, stdout="latexmlc 0.8.8\n"),
    ) == []


def test_docker_compiler_requires_running_docker():
    errors = check_environment.check_compiler(True, which=lambda command: None)
    assert "Docker mode is selected" in errors[0]
    assert "LATEXML_USE_DOCKER=false" in errors[0]

    errors = check_environment.check_compiler(
        True,
        which=lambda command: "/usr/local/bin/docker",
        run=lambda command, **kwargs: completed(command, returncode=1, stderr="daemon unavailable"),
    )
    assert "Start Docker Desktop" in errors[0]


def test_database_requires_psql_client():
    errors = check_environment.check_database(
        "postgresql://scholaragent@localhost/scholaragent",
        which=lambda command: None,
    )

    assert "PostgreSQL client `psql`" in errors[0]
    assert "brew install postgresql" in errors[0]


def test_database_checks_connection_and_credentials():
    calls = []

    def run(command, **kwargs):
        calls.append((command, kwargs))
        return completed(command, stdout="1\n")

    errors = check_environment.check_database(
        "postgresql://scholaragent:secret@localhost:5432/scholaragent",
        which=lambda command: "/opt/homebrew/bin/psql",
        run=run,
    )

    assert errors == []
    assert calls[0][0] == [
        "/opt/homebrew/bin/psql",
        "postgresql://scholaragent:secret@localhost:5432/scholaragent",
        "--no-password",
        "--tuples-only",
        "--no-align",
        "--command",
        "SELECT 1",
    ]
    assert calls[0][1]["timeout"] == 5


def test_database_failure_is_actionable_and_does_not_expose_password():
    database_url = "postgresql://scholaragent:top-secret@localhost/scholaragent"
    errors = check_environment.check_database(
        database_url,
        which=lambda command: "/opt/homebrew/bin/psql",
        run=lambda command, **kwargs: completed(command, returncode=2, stderr=database_url),
    )

    assert "brew services start postgresql" in errors[0]
    assert "verify DATABASE_URL" in errors[0]
    assert "top-secret" not in errors[0]


def test_doctor_success_without_real_mac_or_services(tmp_path, monkeypatch, capsys):
    (tmp_path / ".env").write_text(
        "DATABASE_URL=postgresql://scholaragent@localhost/scholaragent\n"
        "LATEXML_USE_DOCKER=false\n"
    )
    monkeypatch.setattr(check_environment, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(check_environment, "check_platform", lambda: [])
    monkeypatch.setattr(check_environment, "check_python", lambda: [])
    monkeypatch.setattr(check_environment, "check_node", lambda: [])
    monkeypatch.setattr(check_environment, "check_compiler", lambda use_docker: [])
    monkeypatch.setattr(check_environment, "check_database", lambda database_url: [])

    exit_code = check_environment.main()

    assert exit_code == 0
    assert "Environment is ready" in capsys.readouterr().out