#!/usr/bin/env python3
"""Deterministic, offline corpus authoring. Strings are NEVER executed.
The materialized JSONL is committed; Python is not needed to run the benchmark.
Each semantic family stays together across all data partitions.
"""

import collections
import hashlib
import json
from pathlib import Path

from dataset import (
    derived,
    injections,
    semantic_dataflow,
    semantic_git,
    semantic_intent,
    semantic_paths,
    semantic_remote,
    semantic_shell,
    semantic_side_effects,
    trajectories,
)
from dataset.common import CASES, CATALOG

ROOT = Path(__file__).resolve().parents[1]


def build() -> None:
    """Author every case. The call order is the order of cases.jsonl and families.json."""
    semantic_git.add_cases()
    semantic_paths.add_cases()
    semantic_shell.add_cases()
    semantic_dataflow.add_cases()
    semantic_remote.add_cases()
    semantic_intent.add_cases()
    semantic_side_effects.add_cases()
    injections.add_cases()
    trajectories.add_cases()
    derived.fix_authoring_traps()
    derived.add_context_stress()
    derived.assign_splits()
    derived.mark_easy_slice()


if __name__ == "__main__":
    build()
    out = ROOT / "data"
    out.mkdir(exist_ok=True)
    assert len(CASES) == 600, len(CASES)
    ids = [c["id"] for c in CASES]
    assert len(set(ids)) == len(ids)
    data = "".join(json.dumps(c, ensure_ascii=False, separators=(",", ":")) + "\n" for c in CASES)
    (out / "cases.jsonl").write_text(data, encoding="utf-8")
    manifest = {
        "schemaVersion": 1,
        "name": "PRB-600",
        "version": "0.1.0",
        "created": "2026-09-16",
        "repositoryCommit": "ed7cafd279f65a881dfc7020083b860bd71a8961",
        "sha256": hashlib.sha256(data.encode()).hexdigest(),
        "cases": len(CASES),
        "families": len({c["family"] for c in CASES}),
        "counts": {
            k: dict(collections.Counter(c[k] for c in CASES)) for k in ["category", "split", "origin", "difficulty"]
        },
        "outcomes": dict(collections.Counter(c["gold"]["outcome"] for c in CASES)),
        "independenceUnit": "family",
        "annotationStatus": "single-author-draft-not-human-adjudicated",
        "allContent": "synthetic; no real user sessions or live secrets; never execute fixture actions",
        "publicHoldoutWarning": "Public partition, not a secret contamination-resistant evaluation set.",
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    catalog = [{k: v for k, v in x.items() if k != "variants"} for x in CATALOG]
    (out / "families.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
