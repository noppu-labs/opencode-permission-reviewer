import { describe, expect, test } from "bun:test";
import type { PolicyCondition } from "../src/types.ts";
import {
  actor,
  allTrue,
  capability,
  denyWhen,
  FLAGS,
  parsedRules,
  routeFor,
  someone,
  withTrust,
} from "./policy-fixtures.ts";

describe("policy conditions — capability flags", () => {
  for (const flag of FLAGS) {
    test(`${flag}: true matches only when its fact is true`, () => {
      const rules = denyWhen({ [flag]: true });
      expect(routeFor(rules, capability({ [flag]: true }), someone)).toBe(
        "deny",
      );
      expect(routeFor(rules, capability({ [flag]: false }), someone)).toBe(
        "review",
      );
      expect(routeFor(rules, capability({ [flag]: "unknown" }), someone)).toBe(
        "review",
      );
      expect(routeFor(rules, undefined, someone)).toBe("review");
    });

    test(`${flag}: reads its own fact, not a sibling's`, () => {
      const rules = denyWhen({ [flag]: true });
      expect(routeFor(rules, capability(allTrue(flag)), someone)).toBe(
        "review",
      );
    });

    test(`${flag}: false is not a negation and leaves the rule unconstrained`, () => {
      const rules = denyWhen({ [flag]: false });
      expect(routeFor(rules, capability({ [flag]: true }), someone)).toBe(
        "deny",
      );
      expect(routeFor(rules, undefined, someone)).toBe("deny");
    });
  }

  test("a non-boolean flag value leaves the rule unconstrained", () => {
    const rules = parsedRules(
      '[{"id":"r","source":"global","when":{"deletion":"true"},"effect":"deny","reason":"r"}]',
    );
    expect(routeFor(rules, undefined, someone)).toBe("deny");
  });
});

describe("policy conditions — universal rules and conjunction", () => {
  test("a missing condition and always:true match with no facts", () => {
    expect(routeFor(denyWhen(undefined), undefined, undefined)).toBe("deny");
    expect(routeFor(denyWhen({ always: true }), undefined, undefined)).toBe(
      "deny",
    );
  });

  test("always:true matches even beside a condition that would fail", () => {
    const rules = denyWhen({ always: true, actionClass: ["destruction"] });
    expect(routeFor(rules, undefined, undefined)).toBe("deny");
  });

  test("every kind must hold for the rule to match", () => {
    const when: PolicyCondition = {
      actionClass: ["network"],
      actorProfile: ["unknown"],
      networkObserved: true,
      repositoryTrust: ["unknown"],
    };
    const config = withTrust("unknown");
    const net = capability({ networkObserved: true }, "network");
    expect(routeFor(denyWhen(when), net, actor("unknown"), config)).toBe(
      "deny",
    );
    expect(routeFor(denyWhen(when), net, actor("operator"), config)).toBe(
      "review",
    );
    expect(
      routeFor(
        denyWhen(when),
        capability({}, "network"),
        actor("unknown"),
        config,
      ),
    ).toBe("review");
    expect(
      routeFor(denyWhen(when), net, actor("unknown"), withTrust("trusted")),
    ).toBe("review");
  });
});
