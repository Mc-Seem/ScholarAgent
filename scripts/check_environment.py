#!/usr/bin/env python3
"""Validate the local Apple Silicon source-development environment."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, Sequence


PROJECT_ROOT = Path(__file__).resolve().parent.parent
EXPECTED_NODE_VERSION = "24.18.0"
EXPECTED_PYTHON_VERSION = (3, 12)
COMMAND_TIMEOUT = 5

CommandRunner = Callable[..., subprocess.CompletedProcess[str]]
CommandFinder = Callable[[str], str | None]


@dataclass(frozen=True)
class Configuration:
    database_url: str
    use_docker: bool


def check_platform(system: str | None = None, machine: str | None = None) -> list[str]:
    system = system or platform.system()
    machine = machine or platform.machine()
    if system == "Darwin" and machine == "arm64":
        return []
    return [
        f"Unsupported platform {system}/{machine}. Run on an Apple Silicon Mac without Rosetta; "
        "`uname -m` must print arm64."
    ]


def check_python(version: Sequence[int] | None = None) -> list[str]:
    version = version or sys.version_info[:2]
    actual = tuple(version[:2])
    if actual == EXPECTED_PYTHON_VERSION:
        return []
    return [
        f"Python 3.12 is required; found {actual[0]}.{actual[1]}. "
        "Run `mise install` and retry with `mise run doctor`."
    ]


def _run_command(
    command: list[str],
    run: CommandRunner,
) -> subprocess.CompletedProcess[str] | None:
    try:
        return run(command, capture_output=True, text=True, timeout=COMMAND_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired):
        return None


def check_node(
    *,
    which: CommandFinder | None = None,
    run: CommandRunner | None = None,
) -> list[str]:
    which = which or shutil.which
    run = run or subprocess.run
    node = which("node")
    if node is None:
        return [f"Node.js {EXPECTED_NODE_VERSION} was not found. Run `mise install`."]

    result = _run_command([node, "--version"], run)
    if result is None or result.returncode != 0:
        return [f"Could not run Node.js {EXPECTED_NODE_VERSION}. Run `mise install`."]

    actual = result.stdout.strip().removeprefix("v")
    if actual != EXPECTED_NODE_VERSION:
        return [
            f"Node.js {EXPECTED_NODE_VERSION} is required; found {actual or 'unknown'}. "
            "Run `mise install` and retry with `mise run doctor`."
        ]
    return []


def _parse_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        values[key] = value
    return values


def load_configuration(
    project_root: Path,
    *,
    environ: Mapping[str, str] | None = None,
) -> tuple[Configuration | None, list[str]]:
    env_path = project_root / ".env"
    if not env_path.is_file():
        return None, [
            ".env was not found. Run `cp .env.example .env`, then set DATABASE_URL and "
            "LATEXML_USE_DOCKER=false."
        ]

    values = _parse_dotenv(env_path)
    environment = os.environ if environ is None else environ
    for key in ("DATABASE_URL", "LATEXML_USE_DOCKER"):
        if key in environment:
            values[key] = environment[key]

    errors: list[str] = []
    database_url = values.get("DATABASE_URL", "").strip()
    if not database_url:
        errors.append("Set DATABASE_URL in .env to the Homebrew PostgreSQL connection URL.")
    elif not database_url.startswith(("postgresql://", "postgres://")):
        errors.append("DATABASE_URL must start with `postgresql://` (or `postgres://`).")

    compiler_mode = values.get("LATEXML_USE_DOCKER", "").strip().lower()
    if not compiler_mode:
        errors.append("Set LATEXML_USE_DOCKER=false in .env for native Homebrew LaTeXML.")
    elif compiler_mode not in {"true", "false"}:
        errors.append("LATEXML_USE_DOCKER must be `true` or `false`.")

    if errors:
        return None, errors
    return Configuration(database_url=database_url, use_docker=compiler_mode == "true"), []


def check_compiler(
    use_docker: bool,
    *,
    which: CommandFinder | None = None,
    run: CommandRunner | None = None,
) -> list[str]:
    which = which or shutil.which
    run = run or subprocess.run
    if use_docker:
        docker = which("docker")
        if docker is None:
            return [
                "Docker mode is selected, but `docker` was not found. Install Docker Desktop, or set "
                "LATEXML_USE_DOCKER=false and run `brew install latexml`."
            ]
        result = _run_command([docker, "info", "--format", "{{.ServerVersion}}"], run)
        if result is None or result.returncode != 0:
            return [
                "Docker mode is selected, but the daemon is unavailable. Start Docker Desktop, or "
                "set LATEXML_USE_DOCKER=false and run `brew install latexml`."
            ]
        return []

    latexmlc = which("latexmlc")
    if latexmlc is None:
        return [
            "Native LaTeXML is selected, but `latexmlc` was not found. Run `brew install latexml` "
            "and ensure Homebrew is on PATH."
        ]
    result = _run_command([latexmlc, "--VERSION"], run)
    if result is None or result.returncode != 0:
        return [
            "Native LaTeXML is selected, but `latexmlc --VERSION` failed. Run `brew reinstall latexml`."
        ]
    return []


def check_database(
    database_url: str,
    *,
    which: CommandFinder | None = None,
    run: CommandRunner | None = None,
) -> list[str]:
    which = which or shutil.which
    run = run or subprocess.run
    psql = which("psql")
    if psql is None:
        return [
            "PostgreSQL client `psql` was not found. Run `brew install postgresql@17` and ensure "
            "Homebrew is on PATH."
        ]

    command = [
        psql,
        database_url,
        "--no-password",
        "--tuples-only",
        "--no-align",
        "--command",
        "SELECT 1",
    ]
    result = _run_command(command, run)
    if result is None or result.returncode != 0 or result.stdout.strip() != "1":
        return [
            "PostgreSQL is not reachable with DATABASE_URL. Run `brew services start postgresql@17` "
            "and verify DATABASE_URL, the role, and the database."
        ]
    return []


def main() -> int:
    errors = check_platform()
    errors.extend(check_python())
    errors.extend(check_node())

    configuration, configuration_errors = load_configuration(PROJECT_ROOT)
    errors.extend(configuration_errors)
    if configuration is not None:
        errors.extend(check_compiler(configuration.use_docker))
        errors.extend(check_database(configuration.database_url))

    if errors:
        for error in errors:
            print(f"[error] {error}")
        return 1

    print("[ok] Environment is ready for Scholar Agent source development.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())