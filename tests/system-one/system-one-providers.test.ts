import { describe, expect, test } from "bun:test";
import {
  BASETEN_DECISION_MODELS,
  SYSTEM_ONE_PROVIDERS,
} from "../../src/modules/config/models/system-one-providers.ts";
import { resolveConfig } from "../../src/modules/config/services/config.ts";
import { isSystemOneReviewerModel } from "../../src/modules/config/services/reviewer-model.ts";
import { parseSystemOneReview } from "../../src/modules/reviewer/services/review.ts";
import { createSystemOneInvoker } from "../../src/modules/reviewer/services/system-one-invoker.ts";
import {
  LIQUID_KEY,
  LIQUID_KEY_SHORT,
  OPENAI_KEY,
  OPENROUTER_KEY,
} from "../fixtures/synthetic-secrets.ts";
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
    {
      model: "openrouter/typesafe/jev-1.14",
      keyEnv: "OPENROUTER_API_KEY",
      key: OPENROUTER_KEY,
      url: "https://openrouter.ai/api/v1/systemone",
      returned: "typesafe/jev-1.14-20261014",
      foreignReturned: "typesafe/jev-1.13-20260917",
    },
    {
      model: "openrouter/~typesafe/jev-latest",
      keyEnv: "OPENROUTER_API_KEY",
      key: OPENROUTER_KEY,
      url: "https://openrouter.ai/api/v1/systemone",
      returned: "typesafe/jev-1.14-20261014",
      foreignReturned: "liquid/d1-20260930",
    },
    {
      model: "openrouter/liquid/d1-ultra",
      keyEnv: "OPENROUTER_API_KEY",
      key: OPENROUTER_KEY,
      url: "https://openrouter.ai/api/v1/systemone",
      returned: "liquid/d1-ultra-20261015",
      foreignReturned: "liquid/d1-ultra-2026101",
    },
    {
      model: "openrouter/perplexity/pplx-decider-v1.2",
      keyEnv: "OPENROUTER_API_KEY",
      key: OPENROUTER_KEY,
      url: "https://openrouter.ai/api/v1/systemone",
      returned: "perplexity/pplx-decider-v1.2-20261001",
      foreignReturned: "perplexity/pplx-decider-flash-v1.2-20261001",
    },
    {
      model: "openrouter/cloudflare/clef",
      keyEnv: "OPENROUTER_API_KEY",
      key: OPENROUTER_KEY,
      url: "https://openrouter.ai/api/v1/systemone",
      returned: "cloudflare/clef",
      foreignReturned: "cloudflare/clef-flash",
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

describe("OpenRouter System One provider", () => {
  const openrouter = SYSTEM_ONE_PROVIDERS.openrouter;

  test("non-decision OpenRouter models stay on the reasoning reviewer", () => {
    for (const model of [
      "openrouter/anthropic/claude-sonnet-5",
      "openrouter/liquid/lfm-2.5-24b-a2b",
      "openrouter/typesafe/jev-router",
      "openrouter/unknown/model",
    ])
      expect(isSystemOneReviewerModel(model)).toBe(false);
    expect(
      resolveConfig({
        model: "opencode/jev-1.13",
        escalationReviewer: { model: "openrouter/anthropic/claude-sonnet-5" },
      }).escalationReviewer?.model,
    ).toBe("openrouter/anthropic/claude-sonnet-5");
  });

  test("an OpenRouter decision model is not an escalation reviewer", () => {
    expect(
      resolveConfig({
        model: "opencode/jev-1.13",
        escalationReviewer: { model: "openrouter/typesafe/jev-1.14" },
      }).escalationReviewer,
    ).toBeUndefined();
  });

  test("an unlisted family release is System One", () => {
    expect(isSystemOneReviewerModel("openrouter/typesafe/jev-1.15")).toBe(true);
    expect(isSystemOneReviewerModel("openrouter/liquid/d1.2")).toBe(true);
    expect(isSystemOneReviewerModel("openrouter/liquid/d10")).toBe(false);
  });

  test("routing suffixes are stripped for the response check", () => {
    expect(
      openrouter?.acceptsResponse("liquid/d1:free", "liquid/d1-20260930"),
    ).toBe(true);
    expect(
      openrouter?.acceptsResponse(
        "cloudflare/clef:nitro",
        "cloudflare/clef-20261009",
      ),
    ).toBe(true);
    expect(
      openrouter?.acceptsResponse(
        "cloudflare/clef:nitro",
        "cloudflare/clef-flash-20261009",
      ),
    ).toBe(false);
  });

  test("the base is matched literally, not as a pattern", () => {
    expect(
      openrouter?.acceptsResponse("liquid/d1.1", "liquid/d1x1-20261001"),
    ).toBe(false);
    expect(
      openrouter?.acceptsResponse("~liquid/d1-latest", "liquid/d1-20261001"),
    ).toBe(true);
    expect(
      openrouter?.acceptsResponse("~liquid/d1-latest", "liquid/d10-20261001"),
    ).toBe(false);
  });

  test("incompatible models never reach the network", async () => {
    await withEnv({ OPENROUTER_API_KEY: OPENROUTER_KEY }, async () => {
      const calls: string[] = [];
      expect(isSystemOneReviewerModel("openrouter/scaledown/classify-1")).toBe(
        true,
      );
      expect(() =>
        createSystemOneInvoker(
          resolveConfig({ model: "openrouter/scaledown/classify-1" }),
          async (input) => {
            calls.push(String(input));
            return Response.json(withModel("scaledown/classify-1"));
          },
        ),
      ).toThrow(
        "openrouter/scaledown/classify-1 is known to reject the reviewer's request (accepts only plain-string instructions and criteria)",
      );
      expect(calls).toHaveLength(0);
    });
  });

  test("a non-OpenRouter key is never sent", async () => {
    await withEnv({ OPENROUTER_API_KEY: OPENAI_KEY }, async () => {
      const calls: string[] = [];
      const create = (): unknown =>
        createSystemOneInvoker(
          resolveConfig({ model: "openrouter/typesafe/jev-1.14" }),
          async (input) => {
            calls.push(String(input));
            return Response.json(withModel("typesafe/jev-1.14-20261014"));
          },
        );
      expect(create).toThrow(
        'OPENROUTER_API_KEY is not an OpenRouter key (expected the "sk-or-v1-" prefix)',
      );
      let message = "";
      try {
        create();
      } catch (error) {
        message = String(error);
      }
      expect(message).not.toContain(OPENAI_KEY);
      expect(calls).toHaveLength(0);
    });
  });
});
