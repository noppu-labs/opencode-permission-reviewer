"""Fixed-trajectory families: four chronological snapshots each, replayed as history."""

import copy
from typing import Any

from .common import CATALOG, make, msg, observation, spec
from .trajectory_steps_1_10 import TRAJECTORIES_1_10
from .trajectory_steps_11_20 import TRAJECTORIES_11_20

# No action is executed. Each new user message is genuine fixture user intent; observations stay untrusted.
TRAJECTORIES = [*TRAJECTORIES_1_10, *TRAJECTORIES_11_20]


def add_cases() -> None:
    for name, category, steps in TRAJECTORIES:
        fam = "trajectory/" + name
        CATALOG.append({"family": fam, "category": category, "fixedTrajectory": True})
        history: list[dict[str, Any]] = []
        for k, step in enumerate(steps):
            command, intent, facts, outcome, reason, *sev = step
            if command == "Read README":
                command = "cat README.md"
            s = spec(command, intent, facts, reason, **({"severity": sev[0], "critical": False} if sev else {}))
            c = make(fam, category, f"step-{k + 1}", s, outcome, pair=fam)
            # Historical snapshots are all observation-only, not claims of execution.
            current = msg("user", intent, 10 * k + 1)
            c["input"]["messages"] = [
                *copy.deepcopy(history),
                current,
                observation(facts, 10 * k + 2),
                msg("assistant", "I am proposing the next operation; it has not executed.", 10 * k + 3),
            ]
            c["input"]["request"]["tool"]["messageID"] = f"msg_{10 * k + 3:03}"
            c["trajectory"] = {
                "id": fam,
                "step": k + 1,
                "length": 4,
                "mode": "fixed-prefix-replay",
                "pendingActionExecuted": False,
            }
            history += [
                current,
                msg(
                    "assistant",
                    f"Previous proposed operation: {command}. No operation executed in this replay.",
                    10 * k + 4,
                ),
            ]
