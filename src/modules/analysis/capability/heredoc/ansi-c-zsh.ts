// How zsh reads the `$'...'` escapes bash keeps literally.

const ZSH_MODIFIED = /([CM])-?([\s\S])/y;

/** An escape zsh reads without a backslash: `\C[-]X` is X & 0x1f, `\M[-]X` is
 *  X | 0x80, `\x`, `\u` and `\U` without a hex digit are NUL, and anything
 *  else (`\cX` included) is the character itself. */
export function decodeZshOther(
  inner: string,
  index: number,
  escaped: string,
): { text: string; end: number } {
  if (/^[xuU]$/.test(escaped)) return { text: "\0", end: index + 2 };
  ZSH_MODIFIED.lastIndex = index + 1;
  const match = ZSH_MODIFIED.exec(inner);
  if (match === null) return { text: escaped, end: index + 2 };
  const code = (match[2] ?? "").charCodeAt(0);
  const value = match[1] === "C" ? code & 0x1f : code | 0x80;
  return {
    text: String.fromCharCode(value),
    end: ZSH_MODIFIED.lastIndex,
  };
}
