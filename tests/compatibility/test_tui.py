"""Render the actual CLI plugin in a disposable PTY attached to a fresh host."""

import fcntl
import json
import os
import pty
import re
import select
import struct
import subprocess
import termios
import time
import urllib.parse
import urllib.request
from contextlib import ExitStack, contextmanager
from pathlib import Path
from threading import Event, Thread

import pytest
from hosts import V1_VERSIONS, V2_VERSIONS, stop_process

# Capability queries the TUI sends at start-up and the replies a real terminal would give.
TERMINAL_QUERIES = [
    (b"\x1b[c", b"\x1b[?1;2c"),
    (b"\x1b[>c", b"\x1b[>0;276;0c"),
    (b"\x1b[6n", b"\x1b[1;1R"),
    (b"\x1b[?u", b"\x1b[?0u"),
]


def answer_queries(master, chunk):
    for query, response in TERMINAL_QUERIES:
        if query in chunk:
            os.write(master, response)


def read_terminal(master, output, stop):
    """Collect PTY output into `output` and answer terminal queries until `stop` is set or the PTY closes."""
    while not stop.is_set():
        if not select.select([master], [], [], 0.1)[0]:
            continue
        try:
            chunk = os.read(master, 65536)
            if not chunk:
                return
            output.extend(chunk)
            answer_queries(master, chunk)
        except OSError:
            return


@contextmanager
def terminal(arguments, env):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 140, 0, 0))
    proc = subprocess.Popen(arguments, env={**env, "COLORTERM": "truecolor"}, stdin=slave, stdout=slave, stderr=slave)  # nosec B603 # fixed argv, no shell
    os.close(slave)
    output = bytearray()
    stop = Event()
    reader = Thread(target=read_terminal, args=(master, output, stop), daemon=True)
    reader.start()
    try:
        yield output, proc
    finally:
        stop.set()
        stop_process(proc)
        reader.join(timeout=1)
        os.close(master)


def tui_provider(generation, model_server):
    if generation == "v1":
        return {
            "provider": {
                "fixture": {
                    "npm": "@ai-sdk/openai-compatible",
                    "name": "Fixture",
                    "options": {"baseURL": model_server["url"], "apiKey": "synthetic-fixture"},
                    "models": {
                        name: {"name": name, "limit": {"context": 32000, "output": 1000}}
                        for name in ["reviewer", "driver"]
                    },
                }
            }
        }
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


def request(host, generation, path, body=None):
    if generation == "v1":
        path += "?" + urllib.parse.urlencode({"directory": str(host["project"])})
    req = urllib.request.Request(
        host["url"] + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={**host["headers"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:  # nosec B310 # local 127.0.0.1 host under test
        return json.load(response)


def open_session(host, generation):
    session = request(
        host,
        generation,
        "/api/session" if generation == "v2" else "/session",
        {
            "title": "Reviewer UI fixture",
            "location": {"directory": str(host["project"])},
            "permissions": [{"action": "shell", "resource": "*", "effect": "ask"}],
        },
    )
    return session.get("data", session)["id"]


def attach_arguments(binary, host, generation, session_id):
    if generation == "v2":
        return [binary, "--server", host["url"], "--session", session_id, str(host["project"])]
    return [binary, "attach", host["url"], "--session", session_id, "--dir", str(host["project"])]


def wait_until_rendered(output, proc):
    """Wait up to 15 s for the session title to appear, then require the TUI to still be running."""
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline and b"Reviewer UI fixture" not in output and proc.poll() is None:
        time.sleep(0.1)
    assert proc.poll() is None, output.decode("utf-8", errors="replace")[-6000:]


def trigger_review(host, generation, session_id):
    if generation == "v2":
        outcome = request(
            host,
            generation,
            f"/api/session/{session_id}/permission",
            {"action": "shell", "resources": ["printf *"], "metadata": {"command": "printf harmless"}},
        )
        assert outcome["data"]["effect"] == "allow"
    else:
        request(
            host,
            generation,
            f"/session/{session_id}/message",
            {
                "model": {"providerID": "fixture", "modelID": "driver"},
                "parts": [{"type": "text", "text": "Print the fixture marker using bash once"}],
            },
        )


def assert_review_rendered(host, index, output):
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", output.decode("utf-8", errors="replace"))
    (host["root"] / f"terminal-{index}.txt").write_text(text)
    assert "Reviewing this permission" in text, text[-6000:]
    assert "Review approved" in text, text[-6000:]


@pytest.mark.parametrize(
    ("generation", "version"),
    [
        *(("v1", version) for version in V1_VERSIONS),
        *(("v2", version) for version in V2_VERSIONS),
    ],
)
def test_tui_renders_review_state(launch_host, activate_host, model_server, generation, version):
    binary = os.environ[f"OPENCODE_{generation.upper()}_{version.replace('.', '_')}"]
    package = os.environ.get("PLUGIN_PACKAGE_PATH", str(Path(__file__).resolve().parents[2]))
    config = {"plugins": [package]} if generation == "v2" else {"plugin": [package], "permission": {"bash": "ask"}}
    host = launch_host(
        generation,
        binary,
        config,
        reviewer={"model": "fixture/reviewer", "timeoutMs": 10000, "reviewBudgetMs": 20000},
        global_config=tui_provider(generation, model_server),
    )
    activate_host(host, generation)
    session_id = open_session(host, generation)
    cli_config = host["root"] / "config" / "opencode" / ("cli.json" if generation == "v2" else "tui.json")
    cli_config.write_text(json.dumps({"plugins" if generation == "v2" else "plugin": [package]}))
    arguments = attach_arguments(binary, host, generation, session_id)
    with ExitStack() as stack:
        terminals = [
            stack.enter_context(terminal(arguments, host["env"])) for _ in range(2 if generation == "v2" else 1)
        ]
        for output, proc in terminals:
            wait_until_rendered(output, proc)
        model_server["control"]["delay"] = 1
        trigger_review(host, generation, session_id)
        time.sleep(1)
        for index, (output, _proc) in enumerate(terminals):
            assert_review_rendered(host, index, output)
