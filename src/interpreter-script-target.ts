// Which file an interpreter invocation executes: the token planner that walks
// an argument list to the script operand.

import { elementAt } from "./element-at.ts";
import {
  OPTIONS_WITH_VALUE,
  stopsBeforeTarget,
} from "./interpreter-options.ts";
import {
  INTERPRETER_SPECS,
  type InterpreterSpec,
} from "./interpreter-specs.ts";

// One planner step: stop with the target found so far, or move on, skipping
// `skip` extra tokens consumed as an option value.
type ScanStep =
  | { done: true; target: string | undefined }
  | { done: false; skip: number };

const STOP: ScanStep = { done: true, target: undefined };
const NEXT: ScanStep = { done: false, skip: 0 };
const CONSUME_VALUE: ScanStep = { done: false, skip: 1 };

interface ScanState {
  fileTargetPending: boolean;
  optionsEnded: boolean;
}

// The step for a token seen before `--`, or undefined when it is an operand.
function optionStep(
  token: string,
  interpreter: string,
  spec: InterpreterSpec | undefined,
): ScanStep | undefined {
  if (stopsBeforeTarget(token, interpreter, spec)) return STOP;
  if (spec?.noConsumeOptions?.has(token)) return NEXT;
  if (OPTIONS_WITH_VALUE.has(token) || spec?.valueOptions?.has(token))
    return CONSUME_VALUE;
  if (token.startsWith("-")) return NEXT;
  return;
}

// A script operand that names a file. Bare operands may resolve to manifest
// scripts or package specifiers, so only separator- or extension-bearing
// operands are classified as files; anything else conservatively gathers no
// evidence. Scheme-bearing operands (https:, jsr:, npm:, node:, ...) are
// remote or package references, not local paths; this also rejects
// Windows-style drive paths, which never occur in the supported hosts.
function pathLikeFileTarget(token: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(token)) return false;
  return token.includes("/") || /\.(?:[mc]?[jt]sx?)$/i.test(token);
}

function operandTarget(
  token: string,
  spec: InterpreterSpec | undefined,
  fileTargetPending: boolean,
): string | undefined {
  if (/[$`*?{}<>]/.test(token)) return;
  // The first non-option operand after a file-target subcommand is
  // decisive: a path-like token is the executed file, anything else is a
  // manifest script or package reference.
  if (fileTargetPending) return pathLikeFileTarget(token) ? token : undefined;
  if (spec?.directRequiresPathLike && !pathLikeFileTarget(token)) return;
  if (spec?.nonFileSubcommands?.has(token)) return;
  return token;
}

function scanStep(
  token: string,
  interpreter: string,
  spec: InterpreterSpec | undefined,
  state: ScanState,
): ScanStep {
  if (!state.optionsEnded) {
    if (token === "--") {
      state.optionsEnded = true;
      return NEXT;
    }
    const step = optionStep(token, interpreter, spec);
    if (step !== undefined) return step;
  } else if (token === "-") return STOP;
  if (spec?.fileTargetSubcommands?.has(token) && !state.fileTargetPending) {
    state.fileTargetPending = true;
    return NEXT;
  }
  return {
    done: true,
    target: operandTarget(token, spec, state.fileTargetPending),
  };
}

export function scriptPath(
  tokens: string[],
  interpreterIndex: number,
  interpreter: string,
): string | undefined {
  const spec = INTERPRETER_SPECS[interpreter];
  const state: ScanState = { fileTargetPending: false, optionsEnded: false };
  for (let index = interpreterIndex + 1; index < tokens.length; index += 1) {
    const step = scanStep(
      elementAt(tokens, index, "tokens"),
      interpreter,
      spec,
      state,
    );
    if (step.done) return step.target;
    index += step.skip;
  }
  return;
}
