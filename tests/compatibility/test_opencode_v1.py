"""OpenCode V1 process harness, independent of the product V2 protocol."""

import functools
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest

V1_VERSIONS = (
    [os.environ["V1_HOST_VERSION"]]
    if os.environ.get("V1_HOST_VERSION")
    else ["1.18.29", "1.18.30", "1.18.31", "1.18.32", "1.18.35"]
)

# A stdio MCP server that records each process start, so tests can count spawns.
V1_MCP_FIXTURE_SOURCE = """import json
import os
import sys
from pathlib import Path

with Path(sys.argv[1]).open("a") as output:
    output.write(str(os.getpid()) + "\\n")
for line in sys.stdin:
    request = json.loads(line)
    if "id" not in request:
        continue
    result = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}},
              "serverInfo": {"name": "fixture", "version": "1"}} if request["method"] == "initialize" else {"tools": []}
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)
"""


def v1_provider(model_server):
    return {
        "provider": {
            "fixture": {
                "npm": "@ai-sdk/openai-compatible",
                "name": "Fixture",
                "options": {"baseURL": model_server["url"], "apiKey": "synthetic-fixture"},
                "models": {
                    name: {"name": name, "limit": {"context": 32000, "output": 1000}} for name in ["reviewer", "driver"]
                },
            }
        }
    }


def v1_request(host, path, body=None, directory=None, timeout=45) -> Any:
    query = urllib.parse.urlencode({"directory": str(directory or host["project"])})
    req = urllib.request.Request(
        host["url"] + path + "?" + query,
        data=None if body is None else json.dumps(body).encode(),
        headers={**host["headers"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:  # nosec B310 # local 127.0.0.1 host under test
        return json.load(response) if response.status != 204 else None


def prompt_marker(host, session_id, directory=None, timeout=45):
    """Ask the driver to run the marker through bash; return its reply and the session's messages."""
    result = v1_request(
        host,
        f"/session/{session_id}/message",
        {
            "model": {"providerID": "fixture", "modelID": "driver"},
            "parts": [{"type": "text", "text": "Run printf COMPATIBILITY_EXECUTED using bash exactly once"}],
        },
        directory,
        timeout,
    )
    messages = v1_request(host, f"/session/{session_id}/message", directory=directory, timeout=timeout)
    return result, messages


def marker_executed(messages):
    return any(
        part.get("type") == "tool"
        and part.get("state", {}).get("status") == "completed"
        and "COMPATIBILITY_EXECUTED" in part.get("state", {}).get("output", "")
        for message in messages
        for part in message.get("parts", [])
    )


def brake_probe(tmp_path):
    # A metadata-only tool makes this test safe even if review incorrectly allows it.
    probe = tmp_path / "brake-probe"
    probe.mkdir()
    (probe / "package.json").write_text(json.dumps({"name": "fixture-brake", "type": "module"}))
    (probe / "index.js").write_text(
        'export default { id: "fixture-brake", async server() { return { tool: { fixture_permission: { '
        'description: "Request a synthetic permission without executing a command", args: {}, '
        'async execute(_args, ctx) { await ctx.ask({ permission: "bash", patterns: ["rm -rf /"], always: [], '
        'metadata: { command: "rm -rf /" } }); return "COMPATIBILITY_EXECUTED"; } } } }; } };'
    )
    return str(probe)


def assert_native_contract(host, record, messages):
    """Record the native V1 permission contract and compare it with the committed fixture."""
    tool = next(part for message in messages for part in message.get("parts", []) if part.get("type") == "tool")
    contract = {
        "permission": record["permission"],
        "contextRoles": sorted({message["info"]["role"] for message in messages}),
        "tool": {
            "name": tool["tool"],
            "callID": tool["callID"],
            "input": tool["state"]["input"],
            "status": tool["state"]["status"],
        },
    }
    (host["root"] / "native-contracts.json").write_text(json.dumps(contract, indent=2))
    assert contract == json.loads((Path(__file__).parent / "fixtures" / "v1-native.json").read_text())


@pytest.mark.parametrize("version", V1_VERSIONS)
def test_v1_isolated_server(launch_host, activate_host, probe_package, version):
    key = "OPENCODE_V1_" + version.replace(".", "_")
    binary = os.environ.get(key)
    if not binary:
        pytest.fail(f"Set {key} to the pinned OpenCode binary")
    host = launch_host("v1", binary, {"plugin": [probe_package]})
    activate_host(host, "v1")
    assert (host["project"] / "host-probe.txt").read_text() == "server:v1\n"


@pytest.mark.parametrize("version", V1_VERSIONS)
@pytest.mark.parametrize("outcome", ["allow", "deny", "brake"])
def test_v1_reviewer_applies_decision(launch_host, version, model_server, outcome, tmp_path):
    model_server["decision"]["outcome"] = "allow" if outcome == "brake" else outcome
    binary = os.environ["OPENCODE_V1_" + version.replace(".", "_")]
    package = os.environ.get("PLUGIN_PACKAGE_PATH", str(Path(__file__).resolve().parents[2]))
    plugins = [package]
    if outcome == "brake":
        plugins.append(brake_probe(tmp_path))
        model_server["control"]["tool"] = "fixture_permission"
    host = launch_host(
        "v1",
        binary,
        {"plugin": plugins, "permission": {"bash": "ask"}},
        reviewer={"model": "fixture/reviewer", "timeoutMs": 10000},
        global_config=v1_provider(model_server),
    )

    session = v1_request(host, "/session", {"title": "Compatibility safe operation"}, timeout=40)
    result, messages = prompt_marker(host, session["id"], timeout=40)
    assert marker_executed(messages) == (outcome == "allow"), result
    records = [json.loads(line) for line in (host["root"] / "reviewer-audit.jsonl").read_text().splitlines()]
    assert records[-1]["outcome"] == ("deny" if outcome == "brake" else outcome)
    assert records[-1]["decisionSource"] == ("emergency-brake" if outcome == "brake" else "llm-reviewer")
    if outcome == "brake":
        assert not any(call.get("model") == "reviewer" for call in model_server["calls"])
    assert records[-1]["schemaVersion"] == 3
    assert records[-1]["hostVersion"] == version
    assert records[-1]["application"] == "reply-accepted"
    assert records[-1]["reviewID"] != records[-1]["hostRequestID"]
    if outcome == "allow":
        assert_native_contract(host, records[-1], messages)


def inventory(host, directory):
    return v1_request(host, "/mcp", directory=directory)


def start_count(starts):
    return len(starts.read_text().splitlines())


def review(host, index, directory=None):
    """Run one operational bash command that the reviewer allows; return its session id."""
    session = v1_request(host, "/session", {"title": f"Fixture operation {index}"}, directory)
    result, messages = prompt_marker(host, session["id"], directory)
    assert marker_executed(messages), result
    return session["id"]


def records_for(host, session_ids):
    audit_path = host["root"] / "reviewer-audit.jsonl"
    deadline = time.monotonic() + 10
    records = []
    while time.monotonic() < deadline:
        try:
            records = [json.loads(line) for line in audit_path.read_text().splitlines()]
            records = [record for record in records if record.get("sessionID") in session_ids]
            if len(records) == len(session_ids):
                return records
        except (OSError, json.JSONDecodeError):
            pass
        time.sleep(0.05)
    pytest.fail(f"Missing settled reviewer audit records: {records}")


@pytest.mark.parametrize("version", V1_VERSIONS)
def test_v1_reuses_mcp_free_reviewer_location(launch_host, activate_host, model_server, version, tmp_path):
    binary = os.environ["OPENCODE_V1_" + version.replace(".", "_")]
    package = os.environ.get("PLUGIN_PACKAGE_PATH", str(Path(__file__).resolve().parents[2]))
    starts = tmp_path / "mcp-starts.txt"
    mcp_script = tmp_path / "mcp.py"
    mcp_script.write_text(V1_MCP_FIXTURE_SOURCE, encoding="utf-8")
    provider = {
        **v1_provider(model_server),
        "mcp": {"fixture": {"type": "local", "command": [sys.executable, str(mcp_script), str(starts)]}},
    }
    project_config = {"plugin": [package], "permission": {"bash": "ask"}}
    host = launch_host(
        "v1",
        binary,
        project_config,
        reviewer={
            "model": "fixture/reviewer",
            "timeoutMs": 15000,
            "reviewBudgetMs": 30000,
            "retainReviewSessions": True,
        },
        global_config=provider,
    )
    activate_host(host, "v1")

    assert inventory(host, host["project"])["fixture"]["status"] == "connected"
    assert start_count(starts) == 1

    with ThreadPoolExecutor(max_workers=4) as pool:
        operational_sessions = list(pool.map(functools.partial(review, host), range(4)))
    operational_sessions.extend(review(host, index) for index in range(4, 6))

    records = records_for(host, operational_sessions)
    assert all(
        record["outcome"] == "allow"
        and record["decisionSource"] == "llm-reviewer"
        and record["application"] == "reply-accepted"
        and record["schemaVersion"] == 3
        and record["hostVersion"] == version
        for record in records
    ), records
    reviewer_ids = [record["reviewerSessionID"] for record in records]
    assert len(set(reviewer_ids)) == len(operational_sessions)
    locations = {v1_request(host, "/session/" + session_id)["directory"] for session_id in reviewer_ids}
    assert len(locations) == 1, locations
    reviewer_directory = next(iter(locations))
    assert reviewer_directory != str(host["project"])
    assert inventory(host, reviewer_directory) == {}
    assert start_count(starts) == 1
    assert inventory(host, host["project"])["fixture"]["status"] == "connected"

    # A second project creates another backend that reasserts the same files.
    other = host["root"] / "other-project"
    other.mkdir()
    (other / "opencode.json").write_text(json.dumps(project_config), encoding="utf-8")
    assert inventory(host, other)["fixture"]["status"] == "connected"
    assert start_count(starts) == 2
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(review, host, 6)
        second = pool.submit(review, host, 7, other)
        extra = [first.result(), second.result()]
    extra_records = records_for(host, extra)
    assert all(record["outcome"] == "allow" for record in extra_records)
    assert {
        v1_request(host, "/session/" + record["reviewerSessionID"])["directory"] for record in extra_records
    } == locations
    assert inventory(host, reviewer_directory) == {}
    assert start_count(starts) == 2
    assert inventory(host, host["project"])["fixture"]["status"] == "connected"
    assert inventory(host, other)["fixture"]["status"] == "connected"
