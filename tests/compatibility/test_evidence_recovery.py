"""Literal intent recovery and compact evidence on fresh legacy and native hosts."""

import copy
import json
import os
import subprocess
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

import pytest

CASES = [
    (generation, version)
    for generation, version in [("v1", "1.18.29"), ("v1", "1.18.35"), ("v2", "2.0.3"), ("v2", "2.0.26")]
    if os.environ.get("HOST_GENERATION", generation) == generation
    and (generation != "v2" or not os.environ.get("V2_HOST_VERSION") or os.environ["V2_HOST_VERSION"] == version)
]

GOAL = "SYNTHETIC_USER_GOAL: fix the local bug and run the project check script."
RESTRICTION = "SYNTHETIC_USER_RESTRICTION: do not push or delete any files."


def host_configs(generation, package, model_server):
    """Return the project config and the global provider config for one host generation."""
    model = {"name": "Fixture", "limit": {"context": 64000, "output": 1000}}
    if generation == "v1":
        config = {"plugin": [package], "permission": {"bash": "ask"}}
        provider = {
            "provider": {
                "fixture": {
                    "npm": "@ai-sdk/openai-compatible",
                    "name": "Fixture",
                    "options": {"baseURL": model_server["url"], "apiKey": "synthetic-fixture"},
                    "models": {"reviewer": model},
                }
            }
        }
        return config, provider
    config = {"plugins": [package]}
    provider = {
        "providers": {
            "fixture": {
                "package": "@opencode/ai/providers/openai-compatible",
                "settings": {"baseURL": model_server["url"], "apiKey": "synthetic-fixture"},
                "models": {
                    "reviewer": {**model, "capabilities": {"tools": True, "input": ["text"], "output": ["text"]}}
                },
            }
        }
    }
    return config, provider


def request(host, generation, path, body=None) -> Any:
    query = "?" + urllib.parse.urlencode({"directory": str(host["project"])}) if generation == "v1" else ""
    req = urllib.request.Request(
        host["url"] + path + query,
        data=None if body is None else json.dumps(body).encode(),
        headers={**host["headers"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=45) as response:  # nosec B310 # local 127.0.0.1 host under test
        if response.status == 204:
            return None
        result = json.load(response)
        return result.get("data", result) if isinstance(result, dict) else result


def wait_prefix(version):
    return "/api/session" if version == "2.0.3" else "/api/experimental/session"


def seed_v1_history(host):
    """Post the goal, 225 synthetic steps and the restriction without replies; return the session id."""
    session = request(host, "v1", "/session", {"title": "Literal intent fixture"})
    session_id = session["id"]

    def message(text, synthetic=False):
        return request(
            host,
            "v1",
            f"/session/{session_id}/message",
            {
                "noReply": True,
                "model": {"providerID": "fixture", "modelID": "reviewer"},
                "parts": [{"type": "text", "text": text, **({"synthetic": True} if synthetic else {})}],
            },
        )

    message(GOAL)
    for index in range(225):
        message(f"SYNTHETIC_OPERATIONAL_STEP {index}", True)
    message(RESTRICTION)
    return session_id


def seed_v2_history(host, version):
    """Prompt the goal, then import an export padded with 225 steps and the restriction; return its id."""
    session = request(
        host,
        "v2",
        "/api/session",
        {
            "title": "Literal intent fixture",
            "location": {"directory": str(host["project"])},
            "model": {"providerID": "fixture", "id": "reviewer"},
        },
    )
    session_id = session["id"]
    request(host, "v2", f"/api/session/{session_id}/prompt", {"text": GOAL})
    request(host, "v2", f"{wait_prefix(version)}/{session_id}/wait", {})
    transfer = request(host, "v2", f"{wait_prefix(version)}/{session_id}/export")
    template = next(message for message in transfer["messages"] if message["type"] == "assistant")
    for index in range(225):
        message = copy.deepcopy(template)
        message["id"] = "msg_" + uuid.uuid4().hex
        message["content"] = [{"type": "text", "text": f"SYNTHETIC_OPERATIONAL_STEP {index}"}]
        transfer["messages"].append(message)
    user = copy.deepcopy(next(message for message in transfer["messages"] if message["type"] == "user"))
    user["id"] = "msg_" + uuid.uuid4().hex
    user["text"] = RESTRICTION
    user["time"]["created"] += 1
    transfer["messages"].append(user)
    transfer["info"]["id"] = "ses_" + uuid.uuid4().hex
    for message in transfer["messages"]:
        message["id"] = "msg_" + uuid.uuid4().hex
    imported = request(host, "v2", f"{wait_prefix(version)}/import", transfer)
    return imported["id"]


def compact_history(host, generation, version, session_id):
    if generation == "v1":
        request(host, "v1", f"/session/{session_id}/summarize", {"providerID": "fixture", "modelID": "reviewer"})
    else:
        request(host, "v2", f"/api/session/{session_id}/compact", {})
        request(host, "v2", f"{wait_prefix(version)}/{session_id}/wait", {})


def capture_evidence(source, generation, host, session_id):
    return subprocess.run(  # nosec B603 B607 # fixed argv, no shell; bun is resolved from PATH
        [
            "bun",
            "tests/compatibility/capture-evidence.ts",
            generation,
            host["url"],
            str(host["project"]),
            session_id,
            "bun run check",
        ],
        cwd=source,
        env={**os.environ, "OPENCODE_PASSWORD": "synthetic-local-host-password"} if generation == "v2" else os.environ,  # nosec B105 # synthetic test password
        capture_output=True,
        text=True,
        timeout=60,
    )


@pytest.mark.parametrize(("generation", "version"), CASES)
def test_literal_intent_survives_long_history_and_restart(
    launch_host, activate_host, model_server, generation, version
):
    source = str(Path(__file__).resolve().parents[2])
    package = os.environ.get("PLUGIN_PACKAGE_PATH", source)
    binary = os.environ[f"OPENCODE_{generation.upper()}_{version.replace('.', '_')}"]
    config, provider = host_configs(generation, package, model_server)
    reviewer = {"model": "fixture/reviewer", "timeoutMs": 10000, "reviewBudgetMs": 30000}
    host = launch_host(generation, binary, config, reviewer=reviewer, global_config=provider, profile="intent-fixture")
    activate_host(host, generation)
    (host["project"] / "package.json").write_text(
        json.dumps(
            {"scripts": {"check": "bun run lint && bun run verify", "lint": "printf lint", "verify": "printf verify"}}
        )
    )

    session_id = seed_v1_history(host) if generation == "v1" else seed_v2_history(host, version)
    compact_history(host, generation, version, session_id)

    host["stop"]()
    host = launch_host(generation, binary, config, reviewer=reviewer, global_config=provider, profile="intent-fixture")
    activate_host(host, generation)
    proc = capture_evidence(source, generation, host, session_id)
    assert proc.returncode == 0, proc.stderr
    result = json.loads(proc.stdout)
    assert result["text"].count(GOAL) == 1, result
    assert result["text"].count(RESTRICTION) == 1, result
    assert "SYNTHETIC_OPERATIONAL_STEP" not in json.dumps(result["intent"]), result
    assert "PACKAGE_SCRIPT_ANALYSIS" in result["text"], result
    assert "printf lint" in result["text"], result
    assert result["characters"] <= result["budget"], result
    assert result["actionEvidenceComplete"] is True
