"""Local executable evidence from installed packages through fresh host reviews."""

import json
import os
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

import pytest

CASES = [
    (generation, version)
    for generation in ("v1", "v2")
    if os.environ.get("HOST_GENERATION", generation) == generation
    for version in (
        [os.environ[f"{generation.upper()}_HOST_VERSION"]]
        if os.environ.get(f"{generation.upper()}_HOST_VERSION")
        else (["1.18.29", "1.18.35"] if generation == "v1" else ["2.0.3", "2.0.26"])
    )
]

# Each command and the sentinels its review must carry; every other sentinel must be absent.
COMMANDS = [
    ("printf node ./argument.js", []),
    ("ssh fixture.invalid node ./argument.js", []),
    ("node --eval=0 ./argument.js", []),
    ("node --conditions ./argument.js ./--actual.js", ["ACTUAL_EXECUTED_SENTINEL"]),
    ("node -- --actual.js ./argument.js", ["ACTUAL_EXECUTED_SENTINEL"]),
    (
        "(cd first && node task.js) && (cd second && node task.js)",
        ["FIRST_EXECUTED_SENTINEL", "SECOND_EXECUTED_SENTINEL"],
    ),
    ("ssh fixture.invalid git push origin", []),
    ("git push origin", ["https://local.example.invalid/project.git"]),
]

SENTINELS = {
    "ACTUAL_EXECUTED_SENTINEL",
    "UNEXECUTED_ARGUMENT_SENTINEL",
    "FIRST_EXECUTED_SENTINEL",
    "SECOND_EXECUTED_SENTINEL",
    "https://local.example.invalid/project.git",
}


def configure_v1(package, model_server, tmp_path, command_file):
    """Write a probe plugin that asks for the command in `command_file`; return config and provider."""
    model = {"name": "Fixture", "limit": {"context": 64000, "output": 1000}}
    probe = tmp_path / "permission-probe"
    probe.mkdir()
    (probe / "package.json").write_text(json.dumps({"name": "fixture-permission", "type": "module"}))
    (probe / "index.js").write_text(
        'import { readFile } from "node:fs/promises"; export default { id: "fixture-permission", async server() { '
        'return { tool: { fixture_permission: { description: "Request a synthetic permission without executing '
        'the command", args: {}, async execute(_args, ctx) { const command = await readFile('
        + json.dumps(str(command_file))
        + ', "utf8"); await ctx.ask({ permission: "bash", patterns: [command], always: [], '
        'metadata: { command } }); return "COMPATIBILITY_EXECUTED"; } } } }; } };'
    )
    config = {"plugin": [package, str(probe)], "permission": {"bash": "ask"}}
    provider = {
        "provider": {
            "fixture": {
                "npm": "@ai-sdk/openai-compatible",
                "name": "Fixture",
                "options": {"baseURL": model_server["url"], "apiKey": "synthetic-fixture"},
                "models": {"reviewer": model, "driver": model},
            }
        }
    }
    model_server["control"]["tool"] = "fixture_permission"
    return config, provider


def configure_v2(package, model_server):
    model = {"name": "Fixture", "limit": {"context": 64000, "output": 1000}}
    config = {"plugins": [package]}
    provider = {
        "providers": {
            "fixture": {
                "package": "@opencode/ai/providers/openai-compatible",
                "settings": {"baseURL": model_server["url"], "apiKey": "synthetic-fixture"},
                "models": {
                    "reviewer": {
                        **model,
                        "variants": [{"id": "medium", "settings": {}}],
                        "capabilities": {"tools": True, "input": ["text"], "output": ["text"]},
                    }
                },
            }
        }
    }
    return config, provider


def prepare_project(project):
    """Write the sentinel scripts and a git repository with a fixture remote."""
    (project / "--actual.js").write_text('console.log("ACTUAL_EXECUTED_SENTINEL")')
    (project / "argument.js").write_text('console.log("UNEXECUTED_ARGUMENT_SENTINEL")')
    for name in ("first", "second"):
        (project / name).mkdir()
        (project / name / "task.js").write_text(f'console.log("{name.upper()}_EXECUTED_SENTINEL")')
    for args in [
        ["init"],
        ["config", "user.email", "fixture@example.invalid"],
        ["config", "user.name", "Fixture"],
        ["commit", "--allow-empty", "-m", "fixture"],
        ["remote", "add", "origin", "https://local.example.invalid/project.git"],
    ]:
        subprocess.run(["git", *args], cwd=project, check=True, capture_output=True)  # nosec B603 B607 # fixed argv, no shell; git is resolved from PATH


def request(host, generation, path, body):
    query = "?" + urllib.parse.urlencode({"directory": str(host["project"])}) if generation == "v1" else ""
    req = urllib.request.Request(
        host["url"] + path + query,
        data=json.dumps(body).encode(),
        headers={**host["headers"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=45) as response:  # nosec B310 # local 127.0.0.1 host under test
        value = json.load(response)
        return value.get("data", value)


def request_review(host, generation, command, command_file):
    """Make the host ask permission for `command` in a fresh session, which triggers a review."""
    if generation == "v1":
        command_file.write_text(command)
        session = request(host, generation, "/session", {"title": "Local evidence fixture"})
        request(
            host,
            generation,
            f"/session/{session['id']}/message",
            {
                "model": {"providerID": "fixture", "modelID": "driver"},
                "parts": [
                    {"type": "text", "text": "Request the synthetic fixture permission without executing a command"}
                ],
            },
        )
        return
    session = request(
        host,
        generation,
        "/api/session",
        {
            "title": "Local evidence fixture",
            "location": {"directory": str(host["project"])},
            "permissions": [{"action": "shell", "resource": "*", "effect": "ask"}],
        },
    )
    request(
        host,
        generation,
        f"/api/session/{session['id']}/permission",
        {"action": "shell", "resources": [command], "metadata": {"command": command}},
    )


def assert_evidence(command, text, included):
    for expected in included:
        assert expected in text, (command, text)
    for excluded in SENTINELS - set(included):
        assert excluded not in text, (command, text)


@pytest.mark.parametrize(("generation", "version"), CASES)
def test_local_executable_evidence_reaches_the_reviewer(
    launch_host, activate_host, model_server, generation, version, tmp_path
):
    binary = os.environ[f"OPENCODE_{generation.upper()}_{version.replace('.', '_')}"]
    package = os.environ.get("PLUGIN_PACKAGE_PATH", str(Path(__file__).resolve().parents[2]))
    command_file = tmp_path / "command.txt"
    if generation == "v1":
        config, provider = configure_v1(package, model_server, tmp_path, command_file)
    else:
        config, provider = configure_v2(package, model_server)
    host = launch_host(
        generation,
        binary,
        config,
        reviewer={"model": "fixture/reviewer", "timeoutMs": 15000, "reviewBudgetMs": 30000},
        global_config=provider,
    )
    activate_host(host, generation)
    prepare_project(host["project"])

    for command, included in COMMANDS:
        before = len(model_server["calls"])
        request_review(host, generation, command, command_file)
        calls = [call for call in model_server["calls"][before:] if call.get("model") == "reviewer"]
        assert calls, command
        text = json.dumps(calls[-1]["messages"])
        assert_evidence(command, text, included)
