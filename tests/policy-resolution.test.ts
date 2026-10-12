import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { evaluatePolicy } from "../src/policy/policy-engine.ts";
import type { PolicyRule } from "../src/types.ts";
import {
  capability,
  parsedRules,
  routeFor,
  someone,
} from "./policy-fixtures.ts";

describe("policy evaluation — matched rules and route resolution", () => {
  const rule = (id: string, effect: PolicyRule["effect"]): PolicyRule => ({
    id,
    source: "global",
    effect,
    reason: id,
  });

  test("every matching rule is reported, in rule order", () => {
    const rules = [
      rule("a", "review"),
      { ...rule("skip", "deny"), when: { deletion: true } },
      rule("b", "allow"),
      rule("c", "manual"),
    ];
    const trace = evaluatePolicy(capability(), someone, DEFAULT_CONFIG, rules);
    expect(trace.matchedRules).toEqual([
      { id: "a", source: "global", effect: "review", reason: "a" },
      { id: "b", source: "global", effect: "allow", reason: "b" },
      { id: "c", source: "global", effect: "manual", reason: "c" },
    ]);
    expect(trace.finalRoute).toBe("manual");
  });

  test("no match routes to review; a lone allow routes to allow", () => {
    expect(routeFor([], capability(), someone)).toBe("review");
    expect(routeFor([rule("a", "allow")], capability(), someone)).toBe("allow");
  });

  test("the most restrictive effect wins regardless of rule order", () => {
    expect(
      routeFor([rule("a", "deny"), rule("b", "manual")], capability(), someone),
    ).toBe("deny");
    expect(
      routeFor(
        [rule("a", "allow"), rule("b", "review")],
        capability(),
        someone,
      ),
    ).toBe("review");
    expect(
      routeFor(
        [rule("a", "review"), rule("b", "allow")],
        capability(),
        someone,
      ),
    ).toBe("review");
    expect(
      routeFor([rule("a", "manual"), rule("b", "deny")], capability(), someone),
    ).toBe("deny");
  });

  test("an effect outside the severity table ranks as review", () => {
    const rules = (...effects: string[]): PolicyRule[] =>
      parsedRules(
        JSON.stringify(
          effects.map((effect, i) => ({
            id: `r${i}`,
            source: "global",
            effect,
            reason: "r",
          })),
        ),
      );
    expect(routeFor(rules("escalate", "review"), capability(), someone)).toBe(
      "escalate",
    );
    expect(routeFor(rules("review", "escalate"), capability(), someone)).toBe(
      "review",
    );
    expect(routeFor(rules("allow", "escalate"), capability(), someone)).toBe(
      "escalate",
    );
    expect(routeFor(rules("escalate", "manual"), capability(), someone)).toBe(
      "manual",
    );
  });
});
