// Git status porcelain: parses `git status --porcelain=v1 --branch` into the branch and per-column path lists.

export interface ParsedStatus {
  branch: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  unmerged: string[];
}

const UNMERGED_STATUSES = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"];

export function parseStatus(stdout: string): ParsedStatus {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("## "));
  const branch =
    branchLine?.slice(3).split("...")[0]?.trim() || "<detached-or-unknown>";
  const status: ParsedStatus = {
    branch,
    staged: [],
    unstaged: [],
    untracked: [],
    unmerged: [],
  };
  for (const line of lines) {
    if (!line.startsWith("## ")) recordStatusLine(status, line);
  }
  return status;
}

function recordStatusLine(status: ParsedStatus, line: string): void {
  const x = line[0] ?? " ";
  const y = line[1] ?? " ";
  const path = line.slice(3);
  if (x === "?" && y === "?") {
    status.untracked.push(path);
    return;
  }
  if (UNMERGED_STATUSES.includes(x + y)) {
    status.unmerged.push(path);
    return;
  }
  if (x !== " ") status.staged.push(path);
  if (y !== " ") status.unstaged.push(path);
}
