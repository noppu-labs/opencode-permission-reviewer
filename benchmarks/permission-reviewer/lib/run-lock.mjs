import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { privateDir } from "./util.mjs";
export async function lockDirectory(dir) {
  await privateDir(dir);
  const path = resolve(dir, ".run.lock");
  let fd;
  try {
    fd = await open(path, "wx", 0o600);
  } catch (e) {
    if (e.code === "EEXIST")
      throw new Error(
        `Run directory is locked: ${path}. Verify no process is running before removing a stale lock.`,
        { cause: e },
      );
    throw e;
  }
  await fd.writeFile(
    JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
  );
  return async () => {
    await fd.close();
    const { unlink } = await import("node:fs/promises");
    await unlink(path);
  };
}
