import { decision } from "./helpers.mjs";

const row = (family, gold, model, extra = {}) => ({
  caseId: `${family}-${gold}`,
  caseHash: `hash-${family}-${gold}`,
  family,
  repeat: 0,
  modelId: "test",
  gold: { outcome: gold, acceptable: [gold], severity: 2, critical: false },
  decision: decision(model),
  effective: { kind: model },
  status: "valid",
  reachable: true,
  ...extra,
});
const families = ["f1", "f2", "f3"];
export const full = families.flatMap((f) =>
  ["allow", "deny", "escalate"].map((g) => row(f, g, g)),
);
export const noEscalate = families.flatMap((f) =>
  ["allow", "deny"].map((g) => row(f, g, g)),
);

const pairRow = (caseId, gold, model, effective, extra = {}) => ({
  caseId,
  caseHash: `hash-${caseId}`,
  family: `family-${caseId}`,
  repeat: 0,
  modelId: "test",
  gold: { outcome: gold, acceptable: [gold], severity: 3, critical: false },
  decision: model ? decision(model) : null,
  effective: { kind: effective },
  status: "valid",
  reachable: true,
  category: "test",
  difficulty: "hard",
  origin: "test",
  split: "dev",
  ...extra,
});
const attack = (controlId) => ({ attack: { controlId } });
const source = (sourceId) => ({ metamorphic: { sourceId } });
const trajectory = (id, length) => ({ trajectory: { id, length } });
export const pairRows = [
  pairRow("c1", "deny", "deny", "deny"),
  pairRow("a1", "deny", "allow", "deny", attack("c1")),
  pairRow("c2", "allow", "allow", "allow"),
  pairRow("a2", "allow", null, "escalate", attack("c2")),
  pairRow("c3", "escalate", null, "escalate"),
  pairRow("a3", "escalate", "deny", "deny", attack("c3")),
  pairRow("a4", "deny", "allow", "allow", attack("missing")),
  pairRow("s1", "allow", "allow", "allow"),
  pairRow("m1", "allow", "allow", "allow", source("s1")),
  pairRow("m2", "allow", "deny", "allow", source("s1")),
  pairRow("m3", "allow", "deny", "deny", source("missing")),
  pairRow("r1", "allow", "allow", "allow"),
  pairRow("r1", "allow", "deny", "allow", { repeat: 1 }),
  pairRow("t1a", "allow", "allow", "allow", trajectory("t1", 2)),
  pairRow("t1b", "deny", "deny", "allow", trajectory("t1", 2)),
  pairRow("t2a", "allow", "allow", "allow", trajectory("t2", 3)),
];
export const trajectoryWarning =
  "Fixed input prefixes, not adaptive closed-loop agent rollouts.";
