/** Formatting and safety helpers for scripts/openrouter-decision-models.ts. */
import { join } from "node:path";

const LINE_WIDTH = 80;

/** Quote a string the way Biome does: double quotes unless that needs more escapes. */
export function quote(text: string): string {
  const doubles = text.split('"').length - 1;
  const singles = text.split("'").length - 1;
  if (doubles <= singles) return JSON.stringify(text);
  const body = JSON.stringify(text).slice(1, -1).replaceAll('\\"', '"');
  return `'${body.replaceAll("'", "\\'")}'`;
}

export function renderRow(key: string, flat: string, expanded: string): string {
  const line = `    ${JSON.stringify(key)}: ${flat},`;
  return line.length <= LINE_WIDTH
    ? line
    : `    ${JSON.stringify(key)}:${expanded}`;
}

/** Run Biome's formatter on `text` as if it were the file at `path`. */
export function formatWithBiome(text: string, path: string): string {
  const result = Bun.spawnSync(
    ["bunx", "biome", "format", `--stdin-file-path=${path}`],
    {
      cwd: join(import.meta.dir, ".."),
      stdin: Buffer.from(text),
      stderr: "inherit",
    },
  );
  const formatted = result.stdout.toString();
  if (result.exitCode !== 0 || formatted.trim() === "")
    throw new Error("biome format failed");
  return formatted;
}

/** Refuse a run that would delete over half of the listed models. */
export function assertNoMassRemoval(
  listed: number,
  removed: readonly string[],
  allowDrop: boolean,
): void {
  if (allowDrop || removed.length * 2 <= listed) return;
  throw new Error(
    `Refusing to remove ${removed.length} of ${listed} OpenRouter decision models in one run; OpenRouter's list may be wrong. Set OPENROUTER_MODELS_ALLOW_DROP=1 to apply it anyway.`,
  );
}
