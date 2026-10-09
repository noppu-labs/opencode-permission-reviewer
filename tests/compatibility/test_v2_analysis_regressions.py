import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path

import pytest
from hosts import V2_VERSIONS

# Each command and what the analysis must do with it: "brake" denies without a review; the others
# reach the reviewer carrying the named evidence.
REGRESSIONS = [
    ("bash -ce 'rm -rf /'", "brake"),
    ("env --unset FIXTURE_VAR -S 'rm -rf /'", "brake"),
    ("cp --target-directory /etc ./fixture.txt", "external"),
    ("cp -at /etc ./fixture.txt", "external"),
    ("mv -Z /etc/fixture.txt ./fixture.txt", "external"),
    ("rename old new /etc/old ./old", "external"),
    ("cd elsewhere; cd sub && python fixture.py", "unresolved"),
    ("git push --repo=https://override.example.invalid/repo.git main", "override"),
]


def fixture_provider(model_server):
    return {
        "providers": {
            "fixture": {
                "package": "@opencode/ai/providers/openai-compatible",
                "settings": {"baseURL": model_server["url"], "apiKey": "synthetic-fixture"},
                "models": {
                    "reviewer": {
                        "name": "Fixture reviewer",
                        "variants": [{"id": "max", "settings": {}}, {"id": "medium", "settings": {}}],
                        "capabilities": {"tools": True, "input": ["text"], "output": ["text"]},
                        "limit": {"context": 32000, "output": 1000},
                    }
                },
            }
        }
    }


def init_repository(project):
    for args in [
        ["init"],
        ["config", "user.email", "fixture@example.invalid"],
        ["config", "user.name", "Fixture"],
        ["commit", "--allow-empty", "-m", "fixture"],
        ["remote", "add", "origin", "https://original.example.invalid/repo.git"],
    ]:
        subprocess.run(["git", *args], cwd=project, check=True, capture_output=True)  # nosec B603 B607 # fixed argv, no shell; git is resolved from PATH


def request(host, path, body):
    req = urllib.request.Request(
        host["url"] + path,
        data=json.dumps(body).encode(),
        headers={**host["headers"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:  # nosec B310 # local 127.0.0.1 host under test
        return json.load(response)["data"]


def request_permission(host, command):
    session = request(
        host,
        "/api/session",
        {
            "title": "Regression fixture",
            "location": {"directory": str(host["project"])},
            "permissions": [{"action": "shell", "resource": "*", "effect": "ask"}],
        },
    )
    return request(
        host,
        f"/api/session/{session['id']}/permission",
        {"action": "shell", "resources": [command], "metadata": {"command": command}},
    )


def last_review_text(model_server):
    """Join the text of every message in the reviewer's most recent request."""
    return "\n".join(
        message["content"]
        if isinstance(message.get("content"), str)
        else "\n".join(part.get("text", "") for part in message.get("content", []) if isinstance(part, dict))
        for message in model_server["calls"][-1]["messages"]
    )


def assert_review_evidence(expected, text):
    if expected == "external":
        assert '"externalWrite":true' in re.sub(r"\s+", "", text), text
    if expected == "unresolved":
        assert "working directory" in text, text
        assert "unresolved" in text, text
    if expected == "override":
        assert '"input": "https://override.example.invalid/repo.git"' in text, text


@pytest.mark.parametrize("host_version", V2_VERSIONS)
def test_current_bundle_regressions(launch_host, activate_host, model_server, host_version):
    package = os.environ.get("PLUGIN_PACKAGE_PATH", str(Path(__file__).resolve().parents[2]))
    binary = os.environ[f"OPENCODE_V2_{host_version.replace('.', '_')}"]
    host = launch_host(
        "v2",
        binary,
        {"plugins": [package]},
        reviewer={"model": "fixture/reviewer", "timeoutMs": 5000, "reviewBudgetMs": 15000},
        global_config=fixture_provider(model_server),
    )
    activate_host(host, "v2")
    init_repository(host["project"])

    for command, expected in REGRESSIONS:
        before = len(model_server["calls"])
        result = request_permission(host, command)
        if expected == "brake":
            assert result["effect"] == "deny"
            assert len(model_server["calls"]) == before
            continue
        assert len(model_server["calls"]) > before, result
        assert_review_evidence(expected, last_review_text(model_server))
