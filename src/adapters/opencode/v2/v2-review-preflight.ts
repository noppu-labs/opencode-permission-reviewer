import type { ReviewAttempt } from "../../../modules/review/services/review-attempt.ts";
import type { ReviewerConfig } from "../../../types.ts";
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

function assertReviewerModel(
  model: CatalogModel | undefined,
  config: ReviewerConfig,
): void {
  if (!model) throw new Error("Reviewer model is unavailable");
  if (
    config.variant &&
    !model.variants?.some((variant) => variant.id === config.variant)
  ) {
    throw new Error("Reviewer variant is unavailable");
  }
  if (config.outputFormat === "json_schema" && !model.capabilities.tools) {
    throw new Error("Reviewer model does not support structured tool output");
  }
}

/** Fail before any session exists unless the location and its model can review. */
export async function assertReviewerLocation(
  client: V2HostApi,
  directory: string,
  attempt: ReviewAttempt,
  { providerID, modelID }: { providerID: string; modelID: string },
  config: ReviewerConfig,
): Promise<void> {
  await assertNoMcpServers(client, directory, attempt);
  const catalog = await attempt.wait(
    client.model.list({ location: { directory } }, { signal: attempt.signal }),
  );
  assertReviewerModel(
    catalog.data.find(
      (item) => item.providerID === providerID && item.id === modelID,
    ),
    config,
  );
}
