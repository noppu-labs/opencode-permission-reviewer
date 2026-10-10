"""Isolated real-host harnesses; never inherit provider credentials or user config."""

import base64
import functools
import json
import os
import re
import shutil
import socket
import subprocess
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import IO, Any

import pytest
from hosts import SYNTHETIC_PASSWORD, stop_process


@pytest.fixture
def probe_package(tmp_path):
    source = Path(__file__).parent / "probe"
    target = tmp_path / "probe"
    shutil.copytree(source, target)
    return str(target)


@pytest.fixture
def activate_host():
    return _activate


def _activate(host: dict[str, Any], generation: str) -> Any:
    route = "/path" if generation == "v1" else "/api/plugin"
    key = "directory" if generation == "v1" else "location[directory]"
    query = urllib.parse.urlencode({key: str(host["project"])})
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        request = urllib.request.Request(host["url"] + route + "?" + query, headers=host["headers"])
        with urllib.request.urlopen(request, timeout=30) as response:  # nosec B310 # local 127.0.0.1 host under test
            result = json.load(response)
        if generation == "v1" or _local_plugins_active(result):
            return result
        time.sleep(0.1)
    pytest.fail("Host plugin activation timed out")


def _local_plugins_active(result: Any) -> bool:
    """Fail as soon as a local plugin failed; true once every local plugin is active."""
    plugins = result.get("data", result)
    local = [plugin for plugin in plugins if plugin.get("source", {}).get("type") == "local"]
    failed = [plugin for plugin in local if plugin.get("state", {}).get("status") == "failed"]
    if failed:
        pytest.fail(f"Host plugin activation failed: {failed}")
    return bool(local) and all(plugin.get("state", {}).get("status") == "active" for plugin in local)


@pytest.fixture
def launch_host(tmp_path):
    processes: list[tuple[subprocess.Popen[bytes], IO[str]]] = []
    yield functools.partial(_launch, tmp_path, processes)
    for process, log in reversed(processes):
        stop_process(process)
        log.close()


@dataclass
class _Connection:
    url: str
    headers: dict[str, str]
    discovered: bool = False


def _launch(
    tmp_path: Path,
    processes: list[tuple[subprocess.Popen[bytes], IO[str]]],
    generation: str,
    binary: str,
    config: object,
    reviewer: dict[str, Any] | None = None,
    global_config: object = None,
    profile: str | None = None,
    service: bool = False,
) -> dict[str, Any]:
    """Start one host in a disposable profile and return once its health route answers.

    The process is registered for the fixture's teardown as soon as it starts, so a host that
    exits or never becomes ready is still stopped and its log closed.
    """
    executable = _require_binary(binary)
    root, project, home = _disposable_profile(tmp_path, generation, profile)
    env = _isolated_env(root, home)
    _write_configs(root, project, home, config=config, global_config=global_config, reviewer=reviewer)
    port = _free_port()
    if generation == "v2":
        _add_v2_env(env, port, service)
    log = (root / "server.log").open("w+", encoding="utf-8")
    process = _start_server(executable, port, service, cwd=project, env=env, log=log)
    processes.append((process, log))
    connection = _Connection(
        url=f"http://127.0.0.1:{port}",
        headers={} if generation == "v1" else _basic_auth(SYNTHETIC_PASSWORD),
    )
    _wait_until_ready(process, log, connection, generation=generation, service=service, env=env)
    return {
        "url": connection.url,
        "root": root,
        "project": project,
        "env": env,
        "headers": connection.headers,
        "stop": functools.partial(stop_process, process),
    }


def _require_binary(binary: str) -> str:
    executable = shutil.which(binary)
    if executable is None:
        pytest.fail(f"Host binary does not exist: {binary}")
    return executable


def _disposable_profile(tmp_path: Path, generation: str, profile: str | None) -> tuple[Path, Path, Path]:
    """Create the host's root, project and home; a named profile may be relaunched onto them."""
    if profile is not None and not re.fullmatch(r"[a-z0-9-]+", profile):
        pytest.fail("Invalid disposable profile name")
    relaunch = profile is not None
    root = tmp_path / (profile or generation)
    root.mkdir(exist_ok=relaunch)
    project = root / "project"
    project.mkdir(exist_ok=relaunch)
    home = root / "home"
    home.mkdir(exist_ok=relaunch)
    return root, project, home


def _isolated_env(root: Path, home: Path) -> dict[str, str]:
    """The host's whole environment: nothing from the caller's, so no user config or credentials."""
    return {
        "PATH": os.defpath,
        "HOME": str(home),
        "XDG_CONFIG_HOME": str(root / "config"),
        "XDG_DATA_HOME": str(root / "data"),
        "XDG_CACHE_HOME": str(root / "cache"),
        "XDG_STATE_HOME": str(root / "state"),
        "TERM": "xterm-256color",
    }


def _write_configs(
    root: Path, project: Path, home: Path, *, config: object, global_config: object, reviewer: dict[str, Any] | None
) -> None:
    if config is not None:
        (project / "opencode.json").write_text(json.dumps(config), encoding="utf-8")
    if global_config is not None:
        config_dir = root / "config" / "opencode"
        config_dir.mkdir(parents=True, exist_ok=True)
        (config_dir / "opencode.json").write_text(json.dumps(global_config), encoding="utf-8")
    if reviewer is not None:
        reviewer_dir = home / ".config" / "opencode"
        reviewer_dir.mkdir(parents=True, exist_ok=True)
        (reviewer_dir / "permission-reviewer.jsonc").write_text(
            json.dumps(
                {
                    **reviewer,
                    "auditPath": str(root / "reviewer-audit.jsonl"),
                }
            ),
            encoding="utf-8",
        )


def _free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def _add_v2_env(env: dict[str, str], port: int, service: bool) -> None:
    if not service:
        env["OPENCODE_PERMISSION_REVIEWER_HOST_URL"] = f"http://127.0.0.1:{port}"
    env["OPENCODE_PASSWORD"] = SYNTHETIC_PASSWORD


def _start_server(
    executable: str, port: int, service: bool, *, cwd: Path, env: dict[str, str], log: IO[str]
) -> subprocess.Popen[bytes]:
    return subprocess.Popen(  # nosec B603 # fixed argv, no shell
        [executable, "serve", "--hostname", "127.0.0.1", "--port", str(port), *(["--service"] if service else [])],
        cwd=cwd,
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
    )


def _wait_until_ready(
    process: subprocess.Popen[bytes],
    log: IO[str],
    connection: _Connection,
    *,
    generation: str,
    service: bool,
    env: dict[str, str],
) -> None:
    health = "/global/health" if generation == "v1" else "/api/location"
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if process.poll() is not None:
            pytest.fail(f"Host exited before becoming ready:\n{_redacted_log(log)}")
        if service and not connection.discovered:
            _discover_service(connection, env)
        if generation == "v2" and not connection.headers:
            _authorize_from_log(connection, log)
        if _answers_health(connection.url + health, connection.headers):
            return
    pytest.fail(f"Host readiness timed out:\n{_redacted_log(log)}")


def _discover_service(connection: _Connection, env: dict[str, str]) -> None:
    """Adopt the URL and password a `--service` host registers in its XDG state directory."""
    registration = Path(env["XDG_STATE_HOME"]) / "opencode" / "service.json"
    if not registration.exists():
        return
    try:
        record = json.loads(registration.read_text())
        url = record["url"]
        password = record.get("password")
        headers = {} if password is None else _basic_auth(password)
    except (KeyError, json.JSONDecodeError, OSError):
        return
    connection.url = url
    connection.headers = headers
    connection.discovered = True


def _authorize_from_log(connection: _Connection, log: IO[str]) -> None:
    """Use the password the host prints at startup when nothing else supplied one."""
    log.seek(0)
    match = re.search(r"server password (\S+)", log.read())
    if match:
        connection.headers.update(_basic_auth(match[1]))


def _answers_health(url: str, headers: dict[str, str]) -> bool:
    """One readiness probe; pauses briefly when the host is not reachable yet."""
    try:
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=1) as response:  # nosec B310 # local 127.0.0.1 host under test
            return response.status == 200
    except (OSError, ValueError):
        time.sleep(0.1)
        return False


def _basic_auth(password: str) -> dict[str, str]:
    return {"Authorization": "Basic " + base64.b64encode(("opencode:" + password).encode()).decode()}


def _redacted_log(log: IO[str]) -> str:
    log.seek(0)
    return re.sub(r"server password \S+", "server password [redacted]", log.read())


@pytest.fixture
def model_server():
    calls = []
    control = {"delay": 0}
    decision = {
        "version": 2,
        "outcome": "allow",
        "risk_level": "low",
        "user_authorization": "high",
        "scope_alignment": "aligned",
        "evidence_completeness": "sufficient",
        "rationale": "Synthetic harmless command review",
        "confidence": 0.99,
    }

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002, V107 # overrides the stdlib signature
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            assert isinstance(body, dict), "chat completion body is a JSON object"
            calls.append(body)
            time.sleep(control["delay"])
            encoded = _model_reply(body, calls, control, decision)
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)
            except (BrokenPipeError, ConnectionResetError):
                # Cancellation deliberately closes an in-flight model transport.
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield {"url": f"http://127.0.0.1:{server.server_port}/v1", "calls": calls, "decision": decision, "control": control}
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def _model_reply(
    body: dict[str, Any], calls: list[dict[str, Any]], control: dict[str, Any], decision: dict[str, Any]
) -> bytes:
    """The streamed chat completion for one request: the driver runs a tool, the reviewer decides."""
    if body.get("model") == "driver":
        delta, structured = _driver_delta(body, control)
    else:
        delta, structured = _reviewer_delta(body, calls, control, decision)
    return _event_stream(body.get("model", "reviewer"), delta, structured)


def _reviewer_delta(
    body: dict[str, Any], calls: list[dict[str, Any]], control: dict[str, Any], decision: dict[str, Any]
) -> tuple[dict[str, Any], bool]:
    tool_name = next(
        (
            tool.get("function", {}).get("name")
            for tool in body.get("tools", [])
            if tool.get("function", {}).get("name") in {"permission_reviewer_result", "StructuredOutput"}
        ),
        None,
    )
    if tool_name is None:
        return {"role": "assistant", "content": json.dumps(decision)}, False
    tool_calls = [
        {
            "index": 0,
            "id": "call_fixture",
            "type": "function",
            "function": {"name": tool_name, "arguments": json.dumps(decision)},
        }
    ]
    if control.get("ambiguous"):
        tool_calls.append(
            {
                "index": 1,
                "id": "call_invalid_fixture",
                "type": "function",
                "function": {"name": tool_name, "arguments": json.dumps({"outcome": "deny"})},
            }
        )
    if control.get("invalid_first") and sum(call.get("model") == "reviewer" for call in calls) == 1:
        tool_calls[0]["function"]["arguments"] = "{}"
    return {"role": "assistant", "tool_calls": tool_calls}, True


def _driver_delta(body: dict[str, Any], control: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Call the native shell tool once, then finish after the tool result comes back."""
    if any(message.get("role") == "tool" for message in body.get("messages", [])):
        return {"role": "assistant", "content": "Completed."}, False
    native_tool = (
        "shell" if any(tool.get("function", {}).get("name") == "shell" for tool in body.get("tools", [])) else "bash"
    )
    native_tool = control.get("tool", native_tool)
    tool_arguments = (
        {}
        if control.get("tool")
        else {"command": "printf COMPATIBILITY_EXECUTED", "description": "Print a synthetic fixture marker"}
    )
    tool_call = {
        "index": 0,
        "id": "call_operation",
        "type": "function",
        "function": {"name": native_tool, "arguments": json.dumps(tool_arguments)},
    }
    return {"role": "assistant", "tool_calls": [tool_call]}, True


def _event_stream(model: str, delta: dict[str, Any], structured: bool) -> bytes:
    common = {
        "id": "chatcmpl-fixture",
        "object": "chat.completion.chunk",
        "created": 1,
        "model": model,
    }
    chunks = [
        {**common, "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
        {
            **common,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls" if structured else "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
        },
    ]
    return ("".join("data: " + json.dumps(chunk) + "\n\n" for chunk in chunks) + "data: [DONE]\n\n").encode()
