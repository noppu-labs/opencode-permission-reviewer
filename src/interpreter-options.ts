// Interpreter options the script-target planner classifies: those that end the
// search (version and help flags, inline code, `-m` modules, per-runtime bail
// options) and the shared spellings that consume the next token.

import type { InterpreterSpec } from "./interpreter-specs.ts";

const INLINE_CODE_OPTIONS = new Set([
  "-c",
  "-e",
  "--eval",
  "-p",
  "--print",
  "-s",
  "--stdin",
]);

export const OPTIONS_WITH_VALUE: ReadonlySet<string> = new Set([
  "-W",
  "-X",
  "-r",
  "--require",
  "--loader",
  "--import",
  "-I",
  "-M",
  "-m",
]);

function matchesOption(token: string, options: ReadonlySet<string>): boolean {
  if (options.has(token)) return true;
  return [...options].some((option) => token.startsWith(`${option}=`));
}

function isInformationFlag(token: string, interpreter: string): boolean {
  return (
    ["--help", "--version"].includes(token) ||
    (["node", "bun", "deno", "tsx"].includes(interpreter) && token === "-v") ||
    (["python", "python3"].includes(interpreter) && token === "-V")
  );
}

// A dash spell can mean inline code for one runtime and a valued option for
// another (deno -c is --config, node -c is --check): the interpreter spec wins.
function runsInlineCode(
  token: string,
  spec: InterpreterSpec | undefined,
): boolean {
  const inlineOption = [...INLINE_CODE_OPTIONS].find((option) =>
    option.startsWith("--")
      ? token === option || token.startsWith(`${option}=`)
      : token.startsWith(option),
  );
  return inlineOption !== undefined && !spec?.valueOptions?.has(inlineOption);
}

export function stopsBeforeTarget(
  token: string,
  interpreter: string,
  spec: InterpreterSpec | undefined,
): boolean {
  return (
    isInformationFlag(token, interpreter) ||
    token === "-" ||
    runsInlineCode(token, spec) ||
    token.startsWith("-m") ||
    (spec?.bailOptions !== undefined && matchesOption(token, spec.bailOptions))
  );
}
