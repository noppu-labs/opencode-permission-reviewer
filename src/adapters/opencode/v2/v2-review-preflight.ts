import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import { DEFAULT_CONFIG } from "../../../modules/config/services/config.ts";
import type { ReviewAttempt } from "../../../modules/review/services/review-attempt.ts";
import type { V2HostApi } from "./host-api.ts";

type CatalogModel = Awaited<
  ReturnType<V2HostApi["model"]["list"]>
>["data"][number];

/** Fail unless the host reports this location MCP-free. */
async function assertNoMcpServers(
  client: V2HostApi,
  directory: string,
  attempt: ReviewAttempt,
): Promise<void> {
  const inventory = await attempt.wait(
    client.mcp.list({ location: { directory } }, { signal: attempt.signal }),
  );
  if (inventory.location.directory !== directory)
    throw new Error("Reviewer MCP inventory belongs to another location");
  if (inventory.data.length > 0)
    throw new Error("Reviewer isolation location contains MCP servers");
}

/**
 * A missing `medium` falls back to the model's own default even when it was set
 * explicitly, because the resolved config cannot tell it apart from the built-in
 * default. Any other missing variant fails closed.
 */
export function selectVariant(
  configured: string,
  available: readonly string[],
): string | undefined {
  if (!configured || available.includes(configured))
    return configured || undefined;
  if (configured === DEFAULT_CONFIG.variant) return undefined;
  const offered = available.length
    ? `model offers: ${available.join(", ")}`
    : "model has no variants";
  throw new Error(
    `Reviewer variant "${configured}" is unavailable (${offered})`,
  );
}

function assertReviewerModel(
  model: CatalogModel | undefined,
  config: ReviewerConfig,
): { variant: string | undefined } {
  if (!model) throw new Error("Reviewer model is unavailable");
  const variant = selectVariant(
    config.variant,
    model.variants?.map((item) => item.id) ?? [],
  );
  if (config.outputFormat === "json_schema" && !model.capabilities.tools) {
    throw new Error("Reviewer model does not support structured tool output");
  }
  return { variant };
}

/** Fail before any session exists unless the location and its model can review. */
export async function assertReviewerLocation(
  client: V2HostApi,
  directory: string,
  attempt: ReviewAttempt,
  { providerID, modelID }: { providerID: string; modelID: string },
  config: ReviewerConfig,
): Promise<{ variant: string | undefined }> {
  await assertNoMcpServers(client, directory, attempt);
  const catalog = await attempt.wait(
    client.model.list({ location: { directory } }, { signal: attempt.signal }),
  );
  return assertReviewerModel(
    catalog.data.find(
      (item) => item.providerID === providerID && item.id === modelID,
    ),
    config,
  );
}
