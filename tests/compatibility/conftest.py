"""Isolated real-host harnesses; never inherit provider credentials or user config."""

import base64
import json
import os
import re
import shutil
import socket
import subprocess
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import Any

import pytest


@pytest.fixture
def probe_package(tmp_path):
    source = Path(__file__).parent / "probe"
    target = tmp_path / "probe"
    shutil.copytree(source, target)
    return str(target)


@pytest.fixture
def activate_host():
    def activate(host, generation):
        route = "/path" if generation == "v1" else "/api/plugin"
        key = "directory" if generation == "v1" else "location[directory]"
        query = urllib.parse.urlencode({key: str(host["project"])})
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            request = urllib.request.Request(host["url"] + route + "?" + query, headers=host["headers"])
            with urllib.request.urlopen(request, timeout=30) as response:  # nosec B310 # local 127.0.0.1 host under test
                result = json.load(response)
            if generation == "v1":
                return result
            plugins = result.get("data", result)
            local = [plugin for plugin in plugins if plugin.get("source", {}).get("type") == "local"]
            failed = [plugin for plugin in local if plugin.get("state", {}).get("status") == "failed"]
            if failed:
                pytest.fail(f"Host plugin activation failed: {failed}")
            if local and all(plugin.get("state", {}).get("status") == "active" for plugin in local):
                return result
            time.sleep(0.1)
        pytest.fail("Host plugin activation timed out")

    return activate


@pytest.fixture
def launch_host(tmp_path):
    processes = []

    def launch(generation, binary, config, reviewer=None, global_config=None, profile=None, service=False):
        executable = shutil.which(binary)
        if executable is None:
            pytest.fail(f"Host binary does not exist: {binary}")
        if profile is not None and not re.fullmatch(r"[a-z0-9-]+", profile):
            pytest.fail("Invalid disposable profile name")
        root = tmp_path / (profile or generation)
        root.mkdir(exist_ok=profile is not None)
        project = root / "project"
        project.mkdir(exist_ok=profile is not None)
        home = root / "home"
        home.mkdir(exist_ok=profile is not None)
        env = {
            "PATH": os.defpath,
            "HOME": str(home),
            "XDG_CONFIG_HOME": str(root / "config"),
            "XDG_DATA_HOME": str(root / "data"),
            "XDG_CACHE_HOME": str(root / "cache"),
            "XDG_STATE_HOME": str(root / "state"),
            "TERM": "xterm-256color",
        }
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
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        if generation == "v2":
            if not service:
                env["OPENCODE_PERMISSION_REVIEWER_HOST_URL"] = f"http://127.0.0.1:{port}"
            env["OPENCODE_PASSWORD"] = "synthetic-local-host-password"  # nosec B105 # synthetic test password
        log = (root / "server.log").open("w+", encoding="utf-8")
        process = subprocess.Popen(  # nosec B603 # fixed argv, no shell
            [executable, "serve", "--hostname", "127.0.0.1", "--port", str(port), *(["--service"] if service else [])],
            cwd=project,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        processes.append((process, log))

        def stop():
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)

        url = f"http://127.0.0.1:{port}"
        health = "/global/health" if generation == "v1" else "/api/location"
        deadline = time.monotonic() + 45
        headers = (
            {}
            if generation == "v1"
            else {"Authorization": "Basic " + base64.b64encode(b"opencode:synthetic-local-host-password").decode()}
        )
        service_discovered = False

        def safe_log():
            log.seek(0)
            return re.sub(r"server password \S+", "server password [redacted]", log.read())

        while time.monotonic() < deadline:
            if process.poll() is not None:
                pytest.fail(f"Host exited before becoming ready:\n{safe_log()}")
            if service and not service_discovered:
                registration = Path(env["XDG_STATE_HOME"]) / "opencode" / "service.json"
                if registration.exists():
                    try:
                        connection = json.loads(registration.read_text())
                        url = connection["url"]
                        password = connection.get("password")
                        headers = (
                            {}
                            if password is None
                            else {
                                "Authorization": "Basic " + base64.b64encode(("opencode:" + password).encode()).decode()
                            }
                        )
                        service_discovered = True
                    except (KeyError, json.JSONDecodeError, OSError):
                        pass
            if generation == "v2" and not headers:
                log.seek(0)
                match = re.search(r"server password (\S+)", log.read())
                if match:
                    auth = base64.b64encode(("opencode:" + match[1]).encode()).decode()
                    headers["Authorization"] = "Basic " + auth
            try:
                request = urllib.request.Request(url + health, headers=headers)
                with urllib.request.urlopen(request, timeout=1) as response:  # nosec B310 # local 127.0.0.1 host under test
                    if response.status == 200:
                        return {
                            "url": url,
                            "root": root,
                            "project": project,
                            "env": env,
                            "headers": headers,
                            "stop": stop,
                        }
            except (OSError, ValueError):
                time.sleep(0.1)
        pytest.fail(f"Host readiness timed out:\n{safe_log()}")

    yield launch
    for process, log in reversed(processes):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        log.close()


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
        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 # overrides the stdlib signature
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append(body)
            time.sleep(control["delay"])
            tool_name = next(
                (
                    tool.get("function", {}).get("name")
                    for tool in body.get("tools", [])
                    if tool.get("function", {}).get("name") in {"permission_reviewer_result", "StructuredOutput"}
                ),
                None,
            )
            structured = tool_name is not None
            delta: dict[str, Any] = (
                {
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": "call_fixture",
                            "type": "function",
                            "function": {"name": tool_name, "arguments": json.dumps(decision)},
                        }
                    ],
                }
                if structured
                else {"role": "assistant", "content": json.dumps(decision)}
            )
            if structured and control.get("ambiguous"):
                delta["tool_calls"].append(
                    {
                        "index": 1,
                        "id": "call_invalid_fixture",
                        "type": "function",
                        "function": {"name": tool_name, "arguments": json.dumps({"outcome": "deny"})},
                    }
                )
            if (
                structured
                and control.get("invalid_first")
                and sum(call.get("model") == "reviewer" for call in calls) == 1
            ):
                delta["tool_calls"][0]["function"]["arguments"] = "{}"
            if body.get("model") == "driver":
                structured = not any(message.get("role") == "tool" for message in body.get("messages", []))
                native_tool = (
                    "shell"
                    if any(tool.get("function", {}).get("name") == "shell" for tool in body.get("tools", []))
                    else "bash"
                )
                native_tool = control.get("tool", native_tool)
                tool_arguments = (
                    {}
                    if control.get("tool")
                    else {"command": "printf COMPATIBILITY_EXECUTED", "description": "Print a synthetic fixture marker"}
                )
                delta = (
                    {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_operation",
                                "type": "function",
                                "function": {"name": native_tool, "arguments": json.dumps(tool_arguments)},
                            }
                        ],
                    }
                    if structured
                    else {"role": "assistant", "content": "Completed."}
                )
            common = {
                "id": "chatcmpl-fixture",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": body.get("model", "reviewer"),
            }
            chunks = [
                {**common, "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
                {
                    **common,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls" if structured else "stop"}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
                },
            ]
            encoded = ("".join("data: " + json.dumps(chunk) + "\n\n" for chunk in chunks) + "data: [DONE]\n\n").encode()
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
