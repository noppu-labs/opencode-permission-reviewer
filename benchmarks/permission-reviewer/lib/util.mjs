import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
export const sha256 = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : stable(value))
    .digest("hex");
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
export async function privateDir(path) {
  let existing;
  try {
    existing = await lstat(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing) {
    assert(
      existing.isDirectory() && !existing.isSymbolicLink(),
      `Output path is not a regular directory: ${path}`,
    );
    assert(
      (existing.mode & 0o077) === 0,
      `Output directory is not private: ${path}`,
    );
    return;
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}
export async function atomicJSON(path, value) {
  await privateDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}
export async function readJSON(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
function parseLine(line) {
  try {
    return { value: JSON.parse(line) };
  } catch (error) {
    return { error };
  }
}
const truncatedTail = (rows, lines, i) => ({
  rows,
  truncatedBytes: Buffer.byteLength(lines[i]),
  validText: lines.slice(0, i).join("\n") + (i ? "\n" : ""),
});
export async function readJSONL(path, { recoverTail = false } = {}) {
  const text = await readFile(path, "utf8");
  const lines = text.split("\n");
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const { value, error } = parseLine(lines[i]);
    if (!error) rows.push(value);
    else if (recoverTail && i === lines.length - 1 && !text.endsWith("\n"))
      return truncatedTail(rows, lines, i);
    else
      throw new Error(`${path}:${i + 1}: invalid JSON (${error.message})`, {
        cause: error,
      });
  }
  return { rows, truncatedBytes: 0, validText: text };
}
/** One JSON row per line, newline-terminated: the format readJSONL reads back. */
export const toJsonl = (rows) =>
  `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
export function numberArg(value, fallback, min, max, name = "number") {
  if (value === undefined) return fallback;
  const n = Number(value);
  assert(
    Number.isInteger(n) && n >= min && n <= max,
    `${name} must be an integer in [${min},${max}]`,
  );
  return n;
}
export function safeError(error) {
  return String(error?.message ?? error).slice(0, 2000);
}
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
