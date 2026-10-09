"""Exercise the distributed reviewer through the real host and a synthetic model."""

import contextlib
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from hosts import V2_VERSIONS

V2_CASES = [
    (version, "json_schema", outcome) for version in V2_VERSIONS for outcome in ("allow", "deny", "service")
] + (
    [
        ("2.0.3", "text", "allow"),
        ("2.0.3", "json_schema", "ambiguous"),
        ("2.0.3", "json_schema", "low-confidence-deny"),
        ("2.0.3", "json_schema", "prior-deny"),
        ("2.0.3", "json_schema", "later-deny"),
        ("2.0.3", "json_schema", "interrupted"),
        ("2.0.3", "json_schema", "retained"),
        ("2.0.3", "json_schema", "brake"),
        ("2.0.3", "json_schema", "schema-retry"),
        ("2.0.15", "json_schema", "interrupted"),
        ("2.0.15", "json_schema", "brake"),
    ]
    if not os.environ.get("V2_HOST_VERSION")
    else []
)


# A stdio MCP server that records each process start and its working directory, so tests
# can count spawns and see which location started them.
MCP_FIXTURE_SOURCE = """import json
import os
import sys
from pathlib import Path

with Path(sys.argv[1]).open("a") as output:
    output.write(str(os.getpid()) + " " + os.getcwd() + "\\n")

for line in sys.stdin:
    request = json.loads(line)
    if "id" not in request:
        continue
    result = {"protocolVersion": "2025-11-25", "capabilities": {"tools": {}},
              "serverInfo": {"name": "fixture", "version": "1"}} if request["method"] == "initialize" else {"tools": []}
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)
"""


def reviewer_provider(model_server):
    return {
        "providers": {
            "fixture": {
                "package": "@opencode/ai/providers/openai-compatible",
                "settings": {"baseURL": model_server["url"], "apiKey": "synthetic-fixture"},
                "models": {
                    "reviewer": {
                        "name": "Fixture reviewer",
                        "variants": [{"id": "medium", "settings": {}}],
                        "capabilities": {"tools": True, "input": ["text"], "output": ["text"]},
                        "limit": {"context": 32000, "output": 1000},
                    }
                },
            }
        }
    }


def request(host, path, body=None):
    req = urllib.request.Request(
        host["url"] + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={**host["headers"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:  # nosec B310 # local 127.0.0.1 host under test
        return json.load(response) if response.status != 204 else None


def delete_session(host, session_id):
    req = urllib.request.Request(host["url"] + "/api/session/" + session_id, headers=host["headers"], method="DELETE")
    with urllib.request.urlopen(req, timeout=5):  # nosec B310 # local 127.0.0.1 host under test
        pass


def mcp_servers(host, directory):
    query = urllib.parse.urlencode({"location[directory]": str(directory)})
    response = request(host, "/api/mcp?" + query)
    return response.get("data", response)


def audit_records(host):
    try:
        return [json.loads(line) for line in (host["root"] / "reviewer-audit.jsonl").read_text().splitlines()]
    except (OSError, json.JSONDecodeError):
        return []


def audit_record(host, session_id):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        record = next((record for record in audit_records(host) if record.get("sessionID") == session_id), None)
        if record:
            return record
        time.sleep(0.05)
    return None


def arm_model(model_server, decision_outcome):
    """Set up the synthetic model for one case and return the effect the host must apply."""
    if decision_outcome == "ambiguous":
        model_server["control"]["ambiguous"] = True
        return "ask"
    if decision_outcome == "low-confidence-deny":
        model_server["decision"].update(outcome="deny", confidence=0.1)
        return "deny"
    if decision_outcome in {"prior-deny", "later-deny", "interrupted", "brake"}:
        return "deny"
    if decision_outcome in {"retained", "service"}:
        return "allow"
    if decision_outcome == "schema-retry":
        model_server["control"]["invalid_first"] = True
        return "allow"
    model_server["decision"]["outcome"] = decision_outcome
    return decision_outcome


def driver_provider(model_server):
    """The reviewer provider with a "max" variant listed first, plus a driver model for real operations."""
    provider = reviewer_provider(model_server)
    models = provider["providers"]["fixture"]["models"]
    models["reviewer"]["variants"] = [{"id": "max", "settings": {}}, {"id": "medium", "settings": {}}]
    models["driver"] = {
        "name": "Driver",
        "capabilities": {"tools": True, "input": ["text"], "output": ["text"]},
        "limit": {"context": 32000, "output": 1000},
    }
    return provider


def composition_plugins(package, decision_outcome, tmp_path):
    """Load a plugin that denies every evaluation, before or after the reviewer, for the composition cases."""
    if decision_outcome not in {"prior-deny", "later-deny"}:
        return [package]
    other = tmp_path / "composition-plugin"
    other.mkdir()
    (other / "index.js").write_text(
        'export default { id: "fixture-composition", async setup(ctx) { await ctx.permission.hook("evaluate", '
        'input => { input.effect = "deny"; input.message = "Fixture plugin denial"; }); } };'
    )
    (other / "package.json").write_text(json.dumps({"name": "fixture-composition", "type": "module"}))
    return [str(other), package] if decision_outcome == "prior-deny" else [package, str(other)]


def open_session(host, decision_outcome):
    session = request(
        host,
        "/api/session",
        {
            "title": "Fixture operation",
            "location": {"directory": str(host["project"])},
            **({"model": {"providerID": "fixture", "id": "driver"}} if decision_outcome == "interrupted" else {}),
            "permissions": [{"action": "shell", "resource": "*", "effect": "ask"}],
        },
    )
    return session.get("data", session)["id"]


def assistant_parts(context):
    return (part for message in context["data"] if message["type"] == "assistant" for part in message["content"])


def reviewer_called(model_server):
    return any(call.get("model") == "reviewer" for call in model_server["calls"])


def interrupt_review(host, model_server, session_id, wait_prefix):
    """Interrupt the operation while its review is in flight; no tool may complete."""
    model_server["control"]["delay"] = 1
    request(host, f"/api/session/{session_id}/prompt", {"text": "Print the fixture marker using shell once"})
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and not reviewer_called(model_server):
        time.sleep(0.02)
    assert reviewer_called(model_server)
    request(host, f"/api/session/{session_id}/interrupt", {})
    request(host, f"{wait_prefix}/{session_id}/wait", {})
    context = request(host, f"/api/session/{session_id}/context")
    assert not any(
        part.get("type") == "tool" and part.get("state", {}).get("status") == "completed"
        for part in assistant_parts(context)
    ), context


def request_permission(host, session_id, decision_outcome):
    return request(
        host,
        f"/api/session/{session_id}/permission",
        {
            # Evaluation metadata only: the critical string is never executed.
            "action": "shell",
            "resources": ["printf *"],
            "metadata": {"command": "rm -rf /" if decision_outcome == "brake" else "printf harmless"},
        },
    )


def settled_audit_records(host):
    deadline = time.monotonic() + 5
    records = []
    while time.monotonic() < deadline:
        records = audit_records(host)
        if records:
            break
        time.sleep(0.02)
    assert records, "The completed evaluation must produce an audit record"
    return records


def assert_reviewer_offered_only_its_result_tool(model_server):
    assert model_server["calls"]
    for call in model_server["calls"]:
        assert {tool["function"]["name"] for tool in call.get("tools", [])} <= {"permission_reviewer_result"}


def retained_location(host, reviewer_id):
    """Check the retained reviewer session ran in its own temporary location, and return that location."""
    retained = request(host, "/api/session/" + reviewer_id)["data"]
    isolated = Path(retained["location"]["directory"])
    assert isolated.parent == Path(tempfile.gettempdir())
    assert isolated.name.startswith("opencode-reviewer-")
    assert isolated != host["project"]
    assert (isolated / "index.js").exists()
    assert "permission_reviewer_result" in json.dumps(request(host, f"/api/session/{reviewer_id}/context"))
    return isolated


def assert_allowed_shell_runs(host, wait_prefix):
    operation = request(
        host,
        "/api/session",
        {
            "title": "Real shell fixture",
            "location": {"directory": str(host["project"])},
            "model": {"providerID": "fixture", "id": "driver"},
            "permissions": [{"action": "shell", "resource": "*", "effect": "ask"}],
        },
    )
    operation_id = operation.get("data", operation)["id"]
    request(host, f"/api/session/{operation_id}/prompt", {"text": "Print the fixture marker with shell exactly once"})
    request(host, f"{wait_prefix}/{operation_id}/wait", {})
    context = request(host, f"/api/session/{operation_id}/context")
    assert "COMPATIBILITY_EXECUTED" in json.dumps(context), context
    assert any(
        part.get("type") == "tool"
        and part.get("name") == "shell"
        and part.get("state", {}).get("status") == "completed"
        for part in assistant_parts(context)
    ), context


@pytest.mark.parametrize(("host_version", "output_format", "decision_outcome"), V2_CASES)
def test_v2_reviewer_applies_and_cleans_up(
    launch_host, activate_host, model_server, host_version, output_format, decision_outcome, tmp_path
):
    expected_effect = arm_model(model_server, decision_outcome)
    binary = os.environ[f"OPENCODE_V2_{host_version.replace('.', '_')}"]
    package = os.environ.get("PLUGIN_PACKAGE_PATH", str(Path(__file__).resolve().parents[2]))
    host = launch_host(
        "v2",
        binary,
        {"plugins": composition_plugins(package, decision_outcome, tmp_path)},
        reviewer={
            "model": "fixture/reviewer",
            "timeoutMs": 5000,
            "reviewBudgetMs": 15000,
            "outputFormat": output_format,
            "retainReviewSessions": decision_outcome == "retained",
        },
        global_config=driver_provider(model_server),
        service=decision_outcome == "service",
    )
    plugins = activate_host(host, "v2")
    assert "opencode-permission-reviewer" in json.dumps(plugins), plugins

    session_id = open_session(host, decision_outcome)
    wait_prefix = "/api/session" if host_version == "2.0.3" else "/api/experimental/session"
    if decision_outcome == "interrupted":
        interrupt_review(host, model_server, session_id, wait_prefix)
        records = settled_audit_records(host)
        assert records[-1]["outcome"] == "deny", records
        assert records[-1]["application"] == "cancelled", records
        return
    outcome = request_permission(host, session_id, decision_outcome)
    if decision_outcome == "prior-deny":
        assert outcome["data"]["effect"] == "deny"
        assert model_server["calls"] == []
        assert not (host["root"] / "reviewer-audit.jsonl").exists()
        return
    records = settled_audit_records(host)
    assert outcome["data"]["effect"] == expected_effect, records
    assert records[-1]["schemaVersion"] == 3
    assert records[-1]["application"] == ("human-pending" if expected_effect == "ask" else "evaluation-returned")
    if decision_outcome == "brake":
        assert records[-1]["decisionSource"] == "emergency-brake"
        assert model_server["calls"] == []
        return
    assert_reviewer_offered_only_its_result_tool(model_server)
    if decision_outcome == "retained":
        reviewer_id = records[-1]["reviewerSessionID"]
        isolated = retained_location(host, reviewer_id)
        delete_session(host, reviewer_id)
        host["stop"]()
        shutil.rmtree(isolated, ignore_errors=True)
        return
    with pytest.raises(urllib.error.HTTPError) as failure:
        request(host, "/api/session/" + records[-1]["reviewerSessionID"])
    assert failure.value.code == 404
    if output_format == "json_schema" and decision_outcome == "allow":
        assert_allowed_shell_runs(host, wait_prefix)


@pytest.mark.parametrize("host_version", V2_VERSIONS)
def test_v2_reuses_mcp_free_reviewer_location(launch_host, activate_host, model_server, host_version, tmp_path):
    binary = os.environ[f"OPENCODE_V2_{host_version.replace('.', '_')}"]
    package = os.environ.get("PLUGIN_PACKAGE_PATH", str(Path(__file__).resolve().parents[2]))
    starts = tmp_path / "mcp-starts.txt"
    mcp = tmp_path / "mcp.py"
    mcp.write_text(MCP_FIXTURE_SOURCE, encoding="utf-8")
    provider = {
        **reviewer_provider(model_server),
        "mcp": {"servers": {"fixture": {"type": "local", "command": [sys.executable, str(mcp), str(starts)]}}},
    }
    # Reviews must settle within the reviewer budget even on loaded runners;
    # the property under test is reviewer location reuse, not review latency.
    host = launch_host(
        "v2",
        binary,
        {"plugins": [package]},
        reviewer={
            "model": "fixture/reviewer",
            "timeoutMs": 15000,
            "reviewBudgetMs": 30000,
            "retainReviewSessions": True,
        },
        global_config=provider,
    )
    activate_host(host, "v2")

    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and not starts.exists():
        mcp_servers(host, host["project"])
        time.sleep(0.05)
    assert starts.exists(), "Operational MCP did not start"
    assert len(starts.read_text().splitlines()) == 1

    def review(index):
        session = request(
            host,
            "/api/session",
            {
                "title": f"Fixture operation {index}",
                "location": {"directory": str(host["project"])},
                "permissions": [{"action": "shell", "resource": "*", "effect": "ask"}],
            },
        )
        session_id = session.get("data", session)["id"]
        outcome = request(
            host,
            f"/api/session/{session_id}/permission",
            {
                "action": "shell",
                "resources": ["printf *"],
                "metadata": {"command": f"printf fixture-{index}"},
            },
        )
        assert outcome["data"]["effect"] == "allow", outcome
        return session_id

    operational_sessions = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        operational_sessions.extend(pool.map(review, range(4)))
    operational_sessions.extend(review(index) for index in range(4, 7))

    deadline = time.monotonic() + 10
    records = []
    while time.monotonic() < deadline:
        records = audit_records(host)
        records = [record for record in records if record.get("sessionID") in operational_sessions]
        if len(records) == len(operational_sessions):
            break
        time.sleep(0.05)
    assert len(records) == len(operational_sessions), records
    reviewer_ids = [record["reviewerSessionID"] for record in records]
    assert len(set(reviewer_ids)) == len(reviewer_ids)
    locations = {
        request(host, "/api/session/" + session_id)["data"]["location"]["directory"] for session_id in reviewer_ids
    }
    assert len(locations) == 1, locations
    reviewer_directory = next(iter(locations))
    assert reviewer_directory != str(host["project"])
    assert mcp_servers(host, reviewer_directory) == []
    assert len(starts.read_text().splitlines()) == 1, starts.read_text()
    assert mcp_servers(host, host["project"])[0]["status"]["status"] == "connected"
    for session_id in reviewer_ids:
        delete_session(host, session_id)
    new_directory = None
    if tuple(map(int, host_version.split("."))) >= (2, 0, 18):
        reload_request = urllib.request.Request(
            host["url"] + "/api/location/reload", data=b"", headers=host["headers"], method="POST"
        )
        with urllib.request.urlopen(reload_request, timeout=30) as response:  # nosec B310 # local 127.0.0.1 host under test
            assert response.status == 204
        # The host rebuilds locations after a reload without awaiting plugin
        # activation; a permission evaluated in that window has no hooks and
        # would stay pending. Wait for the plugin to be active again.
        activate_host(host, "v2")
        assert mcp_servers(host, reviewer_directory) == []
        reloaded_session = review(7)
        reloaded_record = audit_record(host, reloaded_session)
        assert reloaded_record
        new_reviewer_id = reloaded_record["reviewerSessionID"]
        new_directory = request(host, "/api/session/" + new_reviewer_id)["data"]["location"]["directory"]
        assert new_directory != reviewer_directory
        assert mcp_servers(host, new_directory) == []
        delete_session(host, new_reviewer_id)
    host["stop"]()
    shutil.rmtree(reviewer_directory, ignore_errors=True)
    if new_directory:
        shutil.rmtree(new_directory, ignore_errors=True)


@pytest.mark.parametrize("host_version", V2_VERSIONS)
def test_v2_strips_plugin_added_mcp_from_reviewer_location(
    launch_host, activate_host, model_server, host_version, tmp_path
):
    binary = os.environ[f"OPENCODE_V2_{host_version.replace('.', '_')}"]
    package = os.environ.get("PLUGIN_PACKAGE_PATH", str(Path(__file__).resolve().parents[2]))
    starts = tmp_path / "plugin-mcp-starts.txt"
    mcp = tmp_path / "mcp.py"
    mcp.write_text(MCP_FIXTURE_SOURCE, encoding="utf-8")
    # Adds its server from setup(), as @upstash/context7-opencode does.
    adder = tmp_path / "mcp-adder"
    adder.mkdir()
    (adder / "package.json").write_text(
        json.dumps({"name": "fixture-mcp-adder", "private": True, "type": "module", "exports": "./index.js"}),
        encoding="utf-8",
    )
    command = json.dumps([sys.executable, str(mcp), str(starts)])
    (adder / "index.js").write_text(
        'export default { id: "fixture-mcp-adder", async setup(ctx) {\n'
        "  await ctx.mcp.transform((editor) => {\n"
        '    if (!editor.get("plugin-fixture")) '
        f'editor.set("plugin-fixture", {{ type: "local", command: {command} }});\n'
        "  });\n"
        "  return async () => {};\n"
        "} };\n",
        encoding="utf-8",
    )
    # Global plugins load in every location, the reviewer's temporary one included.
    provider = {**reviewer_provider(model_server), "plugins": [str(adder)]}
    host = launch_host(
        "v2",
        binary,
        {"plugins": [package]},
        reviewer={
            "model": "fixture/reviewer",
            "timeoutMs": 15000,
            "reviewBudgetMs": 30000,
            "retainReviewSessions": True,
        },
        global_config=provider,
    )
    activate_host(host, "v2")

    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and not starts.exists():
        mcp_servers(host, host["project"])
        time.sleep(0.05)
    assert starts.exists(), "Plugin-added operational MCP did not start"
    assert len(starts.read_text().splitlines()) == 1

    reviewer_ids = []
    reviewer_directories = []

    def review(index):
        session = request(
            host,
            "/api/session",
            {
                "title": f"Fixture operation {index}",
                "location": {"directory": str(host["project"])},
                "permissions": [{"action": "shell", "resource": "*", "effect": "ask"}],
            },
        )
        session_id = session.get("data", session)["id"]
        outcome = request(
            host,
            f"/api/session/{session_id}/permission",
            {
                "action": "shell",
                "resources": ["printf *"],
                "metadata": {"command": f"printf fixture-{index}"},
            },
        )
        record = audit_record(host, session_id)
        assert record, "The evaluation must produce an audit record"
        if record.get("reviewerSessionID"):
            reviewer_ids.append(record["reviewerSessionID"])
        assert record["decisionSource"] == "llm-reviewer", record
        assert outcome["data"]["effect"] == "allow", outcome
        directory = request(host, "/api/session/" + record["reviewerSessionID"])["data"]["location"]["directory"]
        reviewer_directories.append(directory)
        assert directory != str(host["project"])
        return directory

    def assert_mcp_free(directory):
        # A server can appear after setup when a plugin registers its transform late, so the
        # empty inventory must hold on a later query too.
        assert mcp_servers(host, directory) == []
        time.sleep(1)
        assert mcp_servers(host, directory) == []

    try:
        reviewer_directory = review(0)
        assert_mcp_free(reviewer_directory)
        assert len(starts.read_text().splitlines()) == 1, starts.read_text()
        operational = mcp_servers(host, host["project"])
        assert [server["name"] for server in operational] == ["plugin-fixture"], operational
        assert operational[0]["status"]["status"] == "connected", operational
        if tuple(map(int, host_version.split("."))) >= (2, 0, 18):
            reload_request = urllib.request.Request(
                host["url"] + "/api/location/reload", data=b"", headers=host["headers"], method="POST"
            )
            with urllib.request.urlopen(reload_request, timeout=30) as response:  # nosec B310 # local 127.0.0.1 host under test
                assert response.status == 204
            activate_host(host, "v2")
            # The reload rebuilds the old reviewer location after its backend released it, so
            # its bootstrap now runs without an activation.
            assert_mcp_free(reviewer_directory)
            new_directory = review(1)
            assert new_directory != reviewer_directory
            assert mcp_servers(host, new_directory) == []
            # The reload restarts the operational server and changes the start count, so check
            # that every start ran in the operational project.
            started_in = {Path(line.split(" ", 1)[1]).resolve() for line in starts.read_text().splitlines()}
            assert started_in == {Path(host["project"]).resolve()}, starts.read_text()
    finally:
        for reviewer_id in reviewer_ids:
            with contextlib.suppress(urllib.error.URLError):
                delete_session(host, reviewer_id)
        host["stop"]()
        for directory in reviewer_directories:
            shutil.rmtree(directory, ignore_errors=True)
