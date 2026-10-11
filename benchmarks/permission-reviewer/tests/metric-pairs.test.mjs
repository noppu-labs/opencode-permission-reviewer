import assert from "node:assert/strict";
import test from "node:test";
import { summarize } from "../lib/metrics.mjs";
import { pairRows, trajectoryWarning } from "./metric-fixtures.mjs";

test("pair metrics count attacks, metamorphic pairs, repeats and trajectories per layer", () => {
  const summary = summarize(pairRows, { bootstrap: 0 }).models.test;
  assert.equal(
    JSON.stringify(summary.model.pairs),
    JSON.stringify({
      attacksWithControl: 3,
      controlNonAllowValid: 1,
      inducedUnsafeApprovals: 1,
      conditionalInducedApprovalRate: 1,
      attackedApprovalRate: 1 / 3,
      attackedMissingDecisionRate: 1 / 3,
      metamorphicPairs: 2,
      metamorphicOutcomeDisagreements: 1,
      metamorphicConsistency: 0.5,
      casesWithRepeats: 1,
      repeatDisagreementRate: 1,
      completeFixedTrajectories: 1,
      allStepsCorrectRate: 1,
      trajectoryWarning,
    }),
  );
  assert.equal(
    JSON.stringify(summary.effective.pairs),
    JSON.stringify({
      attacksWithControl: 3,
      controlNonAllowValid: 2,
      inducedUnsafeApprovals: 0,
      conditionalInducedApprovalRate: 0,
      attackedApprovalRate: 0,
      attackedMissingDecisionRate: 0,
      metamorphicPairs: 2,
      metamorphicOutcomeDisagreements: 0,
      metamorphicConsistency: 1,
      casesWithRepeats: 1,
      repeatDisagreementRate: 0,
      completeFixedTrajectories: 1,
      allStepsCorrectRate: 0,
      trajectoryWarning,
    }),
  );
});

test("pair rates are null when no pair of that kind was observed", () => {
  const plain = pairRows.filter(
    (r) => !r.attack && !r.metamorphic && !r.trajectory && r.repeat === 0,
  );
  assert.equal(
    JSON.stringify(summarize(plain, { bootstrap: 0 }).models.test.model.pairs),
    JSON.stringify({
      attacksWithControl: 0,
      controlNonAllowValid: 0,
      inducedUnsafeApprovals: 0,
      conditionalInducedApprovalRate: null,
      attackedApprovalRate: null,
      attackedMissingDecisionRate: null,
      metamorphicPairs: 0,
      metamorphicOutcomeDisagreements: 0,
      metamorphicConsistency: null,
      casesWithRepeats: 0,
      repeatDisagreementRate: null,
      completeFixedTrajectories: 0,
      allStepsCorrectRate: null,
      trajectoryWarning,
    }),
  );
});

test("a row without an effective outcome counts as invalid at the effective layer", () => {
  const missing = pairRows.map(({ effective, ...rest }) =>
    rest.caseId === "c1" ? rest : { ...rest, effective },
  );
  const summary = summarize(missing, { bootstrap: 0 }).models.test;
  assert.equal(summary.effective.invalidOrMissing, 1);
  assert.equal(summary.effective.confusion.deny.invalid, 1);
  assert.equal(summary.effective.pairs.controlNonAllowValid, 1);
});
