// Descriptor-level file IO shared by the audit file and the config layers:
// open flags that fall back to 0 where the platform lacks them, a positioned
// read loop, and a close that never throws.
import { closeSync, constants as fsConstants, readSync } from "node:fs";

export const O_RDONLY: number =
  typeof fsConstants.O_RDONLY === "number" ? fsConstants.O_RDONLY : 0;
export const O_WRONLY: number =
  typeof fsConstants.O_WRONLY === "number" ? fsConstants.O_WRONLY : 0;
export const O_CREAT: number =
  typeof fsConstants.O_CREAT === "number" ? fsConstants.O_CREAT : 0;
export const O_APPEND: number =
  typeof fsConstants.O_APPEND === "number" ? fsConstants.O_APPEND : 0;
export const O_NOFOLLOW: number =
  typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
export const O_NONBLOCK: number =
  typeof fsConstants.O_NONBLOCK === "number" ? fsConstants.O_NONBLOCK : 0;

/** Read up to `length` bytes starting at file position `offset` into the
 *  start of `buffer`, stopping early at end of file. Returns the bytes read. */
export function readFully(
  fd: number,
  buffer: Buffer,
  length: number,
  offset: number,
): number {
  let read = 0;
  while (read < length) {
    const count = readSync(fd, buffer, read, length - read, offset + read);
    if (count === 0) break;
    read += count;
  }
  return read;
}

export function closeQuietly(fd: number | undefined): void {
  if (fd === undefined) return;
  try {
    closeSync(fd);
  } catch {
    // Best effort; the IO already succeeded or failed on its own.
  }
}
