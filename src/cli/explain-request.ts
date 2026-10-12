// Normalising `explain`'s input JSON into a permission request: a V2 native action or a legacy permission request.
import { asObjectLike } from "../is-record.ts";
import { normalizeV2Permission } from "../opencode/v2/permission-codec.ts";
import type { PermissionRequest, PermissionToolSource } from "../types.ts";

export interface ExplainRequest {
  request: PermissionRequest;
  nativeAction?: string;
  actionEvidenceComplete?: boolean;
}

type NativeInput = Record<string, unknown> & {
  action: string;
  resources: string[];
};

export function normalizeRequest(value: unknown): ExplainRequest | undefined {
  if (typeof value !== "object" || value === null) return;
  const v = value as Record<string, unknown>;
  if (isNativeInput(v)) return normalizeNative(v);
  if (typeof v.permission !== "string") return;
  return { request: legacyRequest(v, v.permission) };
}

function isNativeInput(v: Record<string, unknown>): v is NativeInput {
  return (
    typeof v.action === "string" &&
    Array.isArray(v.resources) &&
    v.resources.every((resource) => typeof resource === "string")
  );
}

function normalizeNative(v: NativeInput): ExplainRequest {
  return normalizeV2Permission(
    {
      sessionID: sessionOf(v),
      action: v.action,
      resources: v.resources,
      effect: "ask",
      ...(typeof v.agent === "string" ? { agent: v.agent } : {}),
      metadata: metadataOf(v),
    },
    {
      reviewID: "explain-dry-run",
      generation: "explain",
      directory: "",
      hostVersion: "2.0.3",
    },
    v.input,
  );
}

function legacyRequest(
  v: Record<string, unknown>,
  permission: string,
): PermissionRequest {
  const req: PermissionRequest = {
    id: typeof v.id === "string" ? v.id : "explain-dry-run",
    sessionID: sessionOf(v),
    permission,
    patterns: Array.isArray(v.patterns) ? v.patterns : [],
    always: Array.isArray(v.always) ? v.always : [],
    metadata: metadataOf(v),
  };
  if (
    typeof v.tool === "object" &&
    v.tool !== null &&
    typeof (v.tool as Record<string, unknown>).messageID === "string"
  ) {
    req.tool = v.tool as PermissionToolSource;
  }
  return req;
}

function sessionOf(v: Record<string, unknown>): string {
  return typeof v.sessionID === "string" ? v.sessionID : "explain-session";
}

function metadataOf(v: Record<string, unknown>): Record<string, unknown> {
  return asObjectLike(v.metadata) ?? {};
}
