import { describe, expect, test } from "bun:test";
import {
  actor,
  capability,
  denyWhen,
  parsedRules,
  routeFor,
  someone,
  withTrust,
} from "./policy-fixtures.ts";

describe("policy conditions — enum lists", () => {
  test("actionClass matches a listed class and needs a capability", () => {
    const rules = denyWhen({ actionClass: ["destruction", "network"] });
    expect(routeFor(rules, capability({}, "network"), someone)).toBe("deny");
    expect(routeFor(rules, capability({}, "read-only"), someone)).toBe(
      "review",
    );
    expect(routeFor(rules, undefined, someone)).toBe("review");
    expect(routeFor(denyWhen({ actionClass: [] }), capability(), someone)).toBe(
      "review",
    );
  });

  test("actorProfile matches a listed profile and needs an actor", () => {
    const rules = denyWhen({ actorProfile: ["read-only", "unknown"] });
    expect(routeFor(rules, capability(), actor("unknown"))).toBe("deny");
    expect(routeFor(rules, capability(), actor("operator"))).toBe("review");
    expect(routeFor(rules, capability(), undefined)).toBe("review");
    expect(
      routeFor(denyWhen({ actorProfile: [] }), capability(), actor("unknown")),
    ).toBe("review");
  });

  test("repositoryTrust matches the configured trust without capability or actor", () => {
    const rules = denyWhen({ repositoryTrust: ["untrusted"] });
    const untrusted = withTrust("untrusted");
    expect(routeFor(rules, undefined, undefined, untrusted)).toBe("deny");
    const trusted = withTrust("trusted");
    expect(routeFor(rules, undefined, undefined, trusted)).toBe("review");
  });

  // Each bare string equals the observed value, so only the array check
  // keeps the rule from matching.
  const bare = {
    actionClass: "network",
    actorProfile: "unknown",
    repositoryTrust: "unknown",
  };
  for (const [key, value] of Object.entries(bare)) {
    test(`a non-array ${key} never matches, even when it names the observed value`, () => {
      const rules = parsedRules(
        `[{"id":"r","source":"global","when":{"${key}":"${value}"},"effect":"deny","reason":"r"}]`,
      );
      const net = capability({}, "network");
      const config = withTrust("unknown");
      expect(routeFor(rules, net, actor("unknown"), config)).toBe("review");
    });
  }
});
