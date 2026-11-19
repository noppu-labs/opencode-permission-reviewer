import { describe, expect, test } from "bun:test";
import {
  assertV1Host,
  v1HostVersionRefusal,
} from "../src/adapters/opencode/host-guard.ts";

describe("legacy adapter host guard", () => {
  test("accepts a v1 client with the raw transport", () => {
    expect(() =>
      assertV1Host({ _client: { post: () => Promise.resolve({}) } }),
    ).not.toThrow();
    expect(() => assertV1Host({})).not.toThrow();
  });

  test("refuses a v2-generation client clearly", () => {
    // A reply method alone does not satisfy the legacy transport contract.
    expect(() =>
      assertV1Host({ permission: { reply: () => Promise.resolve({}) } }),
    ).toThrow(/V1 adapter requires the authenticated legacy transport/);
  });
});

describe("V1 entrypoint host version", () => {
  test.each([undefined, "", "unknown", "1.18.29", "1.19.6", "0.9.0"])(
    "accepts %p",
    (version) => {
      expect(v1HostVersionRefusal(version)).toBeUndefined();
    },
  );

  test.each(["2.0.22", "2.3.2", "v2.3.0", "3.0.0-beta.1"])(
    "refuses %s and points at the V2 configuration",
    (version) => {
      const refusal = v1HostVersionRefusal(version);
      expect(refusal).toContain("loaded the V1 entrypoint");
      expect(refusal).toContain('"plugins" key');
    },
  );
});
