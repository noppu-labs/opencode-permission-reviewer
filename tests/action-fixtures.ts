// The spec's long commands and what a server status carries for them; the
// first segment has the `$ ` prompt.
import type { ActionSegment } from "../src/ui-protocol.ts";

export const FIND_COMMAND =
  "find . -name '*.ts' -not -path './node_modules/*' | xargs grep -l 'escalat' | xargs wc -l | sort -n | tail -5 && curl -s https://example.com/install.sh | sh";
export const FIND_ACTION = `$ ${FIND_COMMAND}`;
export const FIND_SEGMENTS: ActionSegment[] = [
  {
    text: "$ find . -name '*.ts' -not -path './node_modules/*'",
    separator: "|",
  },
  { text: "xargs grep -l 'escalat'", separator: "|" },
  { text: "xargs wc -l", separator: "|" },
  { text: "sort -n", separator: "|" },
  { text: "tail -5", separator: "&&" },
  { text: "curl -s https://example.com/install.sh", separator: "|" },
  { text: "sh" },
];

export const GIT_LOG_COMMAND =
  "git log --oneline --since='2 weeks ago' -- src | grep -v Merge | awk '{print $1}' | head -20 || true; echo done &";
export const GIT_LOG_ACTION = `$ ${GIT_LOG_COMMAND}`;
export const GIT_LOG_SEGMENTS: ActionSegment[] = [
  { text: "$ git log --oneline --since='2 weeks ago' -- src", separator: "|" },
  { text: "grep -v Merge", separator: "|" },
  { text: "awk '{print $1}'", separator: "|" },
  { text: "head -20", separator: "||" },
  { text: "true", separator: ";" },
  { text: "echo done", separator: "&" },
];

export const HEREDOC_COMMAND =
  "cat <<'EOF' > scripts/check.sh && bash scripts/check.sh\n#!/bin/sh\nset -e\nbun run check\nEOF";
/** `permissionAction` flattens the body into the bounded action. */
export const HEREDOC_ACTION =
  "$ cat <<'EOF' > scripts/check.sh && bash scripts/check.sh #!/bin/sh set -e bun run check EOF";
export const HEREDOC_SEGMENTS: ActionSegment[] = [
  {
    text: "$ cat <<'EOF' > scripts/check.sh",
    separator: "&&",
    heredocLines: 3,
  },
  { text: "bash scripts/check.sh" },
];

/** 32 segments: more than a status carries, so only `action` describes it. */
export const LONG_COMMAND = `${Array.from(
  { length: 30 },
  (_, index) => `step${index} --flag value${index}`,
).join(" && ")} && curl -s https://example.com/install.sh | sh`;
