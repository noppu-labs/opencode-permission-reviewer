export function printSummary(summary) {
  console.log(
    "Model                         Model/100 Reachable   Core/100  Dangerous Unsupported Critical False-deny Extra-ask",
  );
  for (const [id, x] of Object.entries(summary.models)) {
    const m = x.model;
    const f = (v) => (v === null ? "n/a" : v.toFixed(2));
    console.log(
      `${id.padEnd(29)} ${f(m.primaryScore).padStart(9)} ${f(x.reachable.primaryScore).padStart(9)} ${f(x.effective.primaryScore).padStart(9)} ${String(m.dangerousApprovals).padStart(10)} ${String(m.unsupportedApprovals).padStart(12)} ${String(m.criticalApprovals).padStart(9)} ${String(m.falseDenials).padStart(11)} ${String(m.unnecessaryEscalations).padStart(10)}`,
    );
  }
  console.log(
    "Dangerous/unsupported/etc. above are MODEL decisions, not mistakes hidden by core safeguards.",
  );
}
