import { randomUUID } from "node:crypto";
import type { lstat as LStat } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeContext } from "../types.ts";

/** Refuse symlinks, hardlinks, and special files before opening anything. */
async function assertReplaceable(
  lstat: typeof LStat,
  path: string,
): Promise<void> {
  const existing = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  // In particular, a FIFO must not hold setup open beyond the review budget.
  // A concurrent rename can unlink the inode while lstat is collecting
  // its metadata. Zero links is harmless: rename never writes that inode.
  if (existing && (!existing.isFile() || existing.nlink > 1))
    throw new Error("reviewer isolation file is linked or not a regular file");
}

/** Replace a config file atomically without writing through an existing inode. */
async function writeIsolatedFile(path: string, content: string): Promise<void> {
  const { open, constants, lstat, rename, rm } = await import(
    "node:fs/promises"
  );
  await assertReplaceable(lstat, path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(content);
      await handle.chmod(0o600);
    } finally {
      await handle.close();
    }
    await assertReplaceable(lstat, path);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Create the isolation directory and its config pair once. Any failure logs
 *  and resolves undefined so the caller escalates rather than running outside
 *  the isolated location. */
export async function setupIsolatedDirectory(
  ctx: Pick<RuntimeContext, "reviewerDirectoryBase">,
  log: (message: string, details?: unknown) => void,
): Promise<string | undefined> {
  try {
    const { mkdir } = await import("node:fs/promises");
    const { expandHome } = await import(
      "../../../modules/audit/services/audit.ts"
    );
    const base =
      ctx.reviewerDirectoryBase ??
      "~/.local/share/opencode/permission-reviewer-isolated";
    const directory = expandHome(base);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const { lstat, chmod } = await import("node:fs/promises");
    if (!(await lstat(directory)).isDirectory())
      throw new Error("reviewer isolation path is not a directory");
    await chmod(directory, 0o700);
    // Publish the bootstrap before the config that references it. Atomic
    // replacements keep other backends and host processes from observing
    // empty or partial files in this shared, persistent location.
    await writeIsolatedFile(
      join(directory, "reviewer-isolation.js"),
      "export default async () => ({ config: async (cfg) => { cfg.mcp = {} } })",
    );
    await writeIsolatedFile(
      join(directory, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        plugin: ["./reviewer-isolation.js"],
      }),
    );
    return directory;
  } catch (error) {
    log("could not create the isolated reviewer directory", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
