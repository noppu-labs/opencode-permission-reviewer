import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import type { Logger } from "../../../utils/logger.ts";
import type { ReviewAuditRecord } from "../models/audit-record.ts";
import { appendAuditLine, readTail } from "../repositories/audit-files.ts";
import { sanitizeAuditRecord } from "./audit-sanitize.ts";
import { type AuditSummary, summarizeAuditTail } from "./audit-summary.ts";

export const DEFAULT_AUDIT_PATH =
  "~/.local/share/opencode/permission-reviewer-audit.jsonl";

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

/** Resolve the audit path the way the writer does. */
export function resolveAuditPath(config: ReviewerConfig): string {
  return expandHome(config.auditPath ?? DEFAULT_AUDIT_PATH);
}

/** Read an append-only JSONL audit file and summarize it. Never throws: a
 *  missing/unreadable file returns an empty summary with `exists: false`, and
 *  malformed records (wrong shapes, null actors, bad JSON) are counted as
 *  invalid lines instead of aborting the report. */
export function readAuditSummary(path: string): AuditSummary {
  return summarizeAuditTail(path, readTail(path));
}

function logAppendFailure(
  logger: Logger | undefined,
  path: string,
  error: unknown,
): void {
  logger?.("failed to append audit record", {
    path,
    error: error instanceof Error ? error.message : String(error),
  });
}

export function createAuditWriter(
  config: ReviewerConfig,
  logger?: Logger,
): ((record: ReviewAuditRecord) => Promise<void>) | undefined {
  if (!config.audit) return;
  const path = expandHome(config.auditPath ?? DEFAULT_AUDIT_PATH);
  let ready: Promise<void> | undefined;
  return async (record: ReviewAuditRecord): Promise<void> => {
    try {
      ready ??= mkdir(dirname(path), { recursive: true }).then(() => {});
      await ready;
    } catch (error) {
      // The audit trail is best-effort: a directory that cannot be created
      // loses the record the same way an append failure does, logged and
      // never thrown. The cached promise is cleared so a later record retries
      // the mkdir instead of sticking to the rejection.
      logAppendFailure(logger, path, error);
      ready = undefined;
      return;
    }
    const sanitized = sanitizeAuditRecord(record);
    try {
      appendAuditLine(path, `${JSON.stringify(sanitized)}\n`);
    } catch (error) {
      // The audit trail is best-effort: a lost record is logged, never thrown.
      logAppendFailure(logger, path, error);
    }
  };
}
