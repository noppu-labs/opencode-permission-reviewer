// How zsh reads the `$'...'` escapes that bash keeps literally or decodes differently.

export interface DecodedEscape {
  text: string;
  end: number;
}

/** `\C` clears bits 5 and 6 (`?` becomes DEL); `\M` sets bit 7. */
const MODIFIERS: Readonly<Record<string, (code: number) => number>> = {
  C: (code: number): number => (code === 0x3f ? 0x7f : code & 0x9f),
  M: (code: number): number => code | 0x80,
};

/** An escape zsh reads without a backslash: `\x`, `\u` and `\U` without a
 *  hex digit are NUL, a run of `\C[-]` and `\M[-]` modifies the first
 *  character of the escape or character after it (innermost first, nothing
 *  at the end of the text), and anything else (`\cX` included) is the
 *  character itself. `decodeEscape` decodes the escape at an index. */
export function decodeZshOther(
  inner: string,
  index: number,
  escaped: string,
  decodeEscape: (inner: string, index: number) => DecodedEscape,
): DecodedEscape {
  if (/^[xuU]$/.test(escaped)) return { text: "\0", end: index + 2 };
  if (MODIFIERS[escaped] === undefined)
    return { text: escaped, end: index + 2 };
  const modifiers: Array<(code: number) => number> = [];
  let position = index;
  let modify = MODIFIERS[inner.charAt(position + 1)];
  while (inner.charAt(position) === "\\" && modify !== undefined) {
    modifiers.push(modify);
    position += inner.charAt(position + 2) === "-" ? 3 : 2;
    modify = MODIFIERS[inner.charAt(position + 1)];
  }
  const operand = operandAt(inner, position, decodeEscape);
  if (operand.text === "") return operand;
  let code = operand.text.charCodeAt(0);
  for (const apply of modifiers.reverse()) code = apply(code);
  return {
    text: String.fromCharCode(code) + operand.text.slice(1),
    end: operand.end,
  };
}

/** The escape or character a modifier run applies to. */
function operandAt(
  inner: string,
  position: number,
  decodeEscape: (inner: string, index: number) => DecodedEscape,
): DecodedEscape {
  if (position >= inner.length) return { text: "", end: position };
  if (inner.charAt(position) === "\\" && position + 1 < inner.length)
    return decodeEscape(inner, position);
  return { text: inner.charAt(position), end: position + 1 };
}
