"""Host versions and credentials shared by the compatibility modules."""

import os
import subprocess

V1_VERSIONS = (
    [os.environ["V1_HOST_VERSION"]]
    if os.environ.get("V1_HOST_VERSION")
    else ["1.18.29", "1.18.30", "1.18.31", "1.18.32", "1.18.35"]
)

V2_VERSIONS = (
    [os.environ["V2_HOST_VERSION"]]
    if os.environ.get("V2_HOST_VERSION")
    else ["2.0.3", "2.0.11", "2.0.15", "2.0.18", "2.0.26"]
)

SYNTHETIC_PASSWORD = "synthetic-local-host-password"  # nosec B105 # synthetic test password


def stop_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
