import { describe, expect, test } from "bun:test";
import { BASETEN_DECISION_MODELS } from "../../src/modules/config/models/system-one-providers.ts";
import { resolveConfig } from "../../src/modules/config/services/config.ts";
import { isSystemOneReviewerModel } from "../../src/modules/config/services/reviewer-model.ts";
import { parseSystemOneReview } from "../../src/modules/reviewer/services/review.ts";
import { createSystemOneInvoker } from "../../src/modules/reviewer/services/system-one-invoker.ts";
import { LIQUID_KEY, LIQUID_KEY_SHORT } from "../fixtures/synthetic-secrets.ts";
import { response } from "./system-one-fixtures.ts";

async function withEnv<T>(
  values: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(values)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const withModel = (model: string): ReturnType<typeof response> => ({
  ...response(),
  model,
});

const STATE = {
  trustedPolicy: { reviewer: "policy", tenant: "tenant" },
  untrustedEvidence: "evidence",
};

describe("System One providers", () => {
  test.each([
    {
      model: "opencode/jev-1.13",
      keyEnv: "OPENCODE_API_KEY",
      key: "synthetic-opencode-key",
      url: "https://opencode.ai/zen/v1/systemone",
      returned: "jev-1.13",
      foreignReturned: "d1",
    },
    {
      model: "typesafe-ai/jev-1.13.0",
      keyEnv: "TYPESAFE_API_KEY",
      key: "synthetic-typesafe-key",
      url: "https://api.typesafe.ai/v1/systemone",
      returned: "jev-1.13.0",
      foreignReturned: "d1",
    },
    {
      model: "commandcode/typesafe/jev",
      keyEnv: "CMD_API_KEY",
      key: "synthetic-commandcode-key",
      url: "https://api.commandcode.ai/provider/v1/systemone",
      returned: "typesafe/jev",
      foreignReturned: "jev-1.13",
    },
    {
      model: "liquid-ai/d1",
      keyEnv: "LIQUID_API_KEY",
      key: LIQUID_KEY,
      url: "https://api.liquid.ai/decisions/v1/systemone",
      returned: "d1",
      foreignReturned: "jev-1.14",
    },
    {
      model: "liquid-ai/d1-ultra",
      keyEnv: "LIQUID_API_KEY",
      key: LIQUID_KEY,
      url: "https://api.liquid.ai/decisions/v1/systemone",
      returned: "d1-ultra",
      foreignReturned: "jev-1.14",
    },
    {
      model: "baseten/decision-models/baseten-elephant-9b-latest",
      keyEnv: "BASETEN_API_KEY",
      key: "synthetic-baseten-key",
      url: "https://inference.baseten.co/v1/systemone",
      returned: "decision-models/baseten-elephant-9b-latest",
      foreignReturned: "jev-1.14",
    },
    {
      model: "baseten/decision-models/baseten-mammoth-27b-latest",
      keyEnv: "BASETEN_API_KEY",
      key: "synthetic-baseten-key",
      url: "https://inference.baseten.co/v1/systemone",
      returned: "decision-models/baseten-mammoth-27b-latest",
      foreignReturned: "jev-1.14",
    },
  ])(
    "routes $model",
    async ({ model, keyEnv, key, url, returned, foreignReturned }) => {
      expect(isSystemOneReviewerModel(model)).toBe(true);
      await withEnv(
        { [keyEnv]: key, TYPESAFE_BASE_URL: undefined },
        async () => {
          const config = resolveConfig({ model });
          const calls: Array<{ url: string; init: RequestInit }> = [];
          const invoke = createSystemOneInvoker(config, async (input, init) => {
            calls.push({ url: String(input), init: init ?? {} });
            return Response.json(withModel(returned));
          });
          await invoke(STATE, new AbortController().signal);
          expect(calls).toHaveLength(1);
          expect(calls[0]?.url).toBe(url);
          expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(
            `Bearer ${key}`,
          );
          expect(
            parseSystemOneReview(withModel(returned), config),
          ).toBeDefined();
          expect(
            parseSystemOneReview(withModel(foreignReturned), config),
          ).toBeUndefined();
        },
      );
    },
  );

  test("accepts every listed Baseten decision model", () => {
    for (const modelID of BASETEN_DECISION_MODELS)
      expect(isSystemOneReviewerModel(`baseten/${modelID}`)).toBe(true);
  });

  test("rejects another model's answer from the same provider", () => {
    for (const [model, returned] of [
      ["liquid-ai/d1", "d1-ultra"],
      ["liquid-ai/d1-ultra", "d1"],
      [
        "baseten/decision-models/baseten-elephant-9b-latest",
        "decision-models/baseten-mammoth-27b-latest",
      ],
      [
        "baseten/decision-models/baseten-mammoth-27b-latest",
        "decision-models/baseten-elephant-9b-latest",
      ],
    ] as const)
      expect(
        parseSystemOneReview(withModel(returned), resolveConfig({ model })),
      ).toBeUndefined();
  });

  test("rejects unknown models on the new providers", () => {
    for (const model of [
      "liquid-ai/d2",
      "liquid-ai/lfm-2.5",
      "baseten/decision-models/other",
      "baseten/mammoth-1",
    ])
      expect(isSystemOneReviewerModel(model)).toBe(false);
  });

  test("never sends a Liquid key with the wrong shape", async () => {
    await withEnv({ LIQUID_API_KEY: LIQUID_KEY_SHORT }, async () => {
      const calls: string[] = [];
      const create = (): unknown =>
        createSystemOneInvoker(
          resolveConfig({ model: "liquid-ai/d1" }),
          async (input) => {
            calls.push(String(input));
            return Response.json(withModel("d1"));
          },
        );
      expect(create).toThrow(
        'LIQUID_API_KEY is not a Liquid AI key (expected the "liquid_" prefix)',
      );
      let message = "";
      try {
        create();
      } catch (error) {
        message = String(error);
      }
      expect(message).not.toContain(LIQUID_KEY_SHORT);
      expect(calls).toHaveLength(0);
    });
  });
});
