// The words GNU env makes of an `-S` string (`build_argv` in env.c), each quoted for the shell.

/** One word being built: shell text, and whether it holds anything yet. */
interface SplitState {
  words: string[];
  literal: string;
  separated: boolean;
  single: boolean;
  double: boolean;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "#": "#",
  $: "$",
  "'": "'",
  "\\": "\\",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

const SPACE = /[ \t\n\v\f\r]/;
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/y;

/** The words env splits `script` into, as shell text: a literal part
 *  single-quoted and a `${NAME}` as a double-quoted expansion. A `#` that
 *  starts a word and a `\c` end the string. `undefined` when env rejects
 *  the string (an unknown escape, an unclosed quote, a `$` without a name)
 *  and runs nothing. */
export function gnuSplitWords(script: string): string[] | undefined {
  const state: SplitState = {
    words: [],
    literal: "",
    separated: true,
    single: false,
    double: false,
  };
  let k = 0;
  while (k < script.length) {
    const step = splitStep(script, k, state);
    if (step === undefined) return undefined;
    if (step === "end") return finish(state);
    k = step;
  }
  return state.single || state.double ? undefined : finish(state);
}

type Step = number | "end" | undefined;

function splitStep(script: string, k: number, state: SplitState): Step {
  const char = script.charAt(k);
  if (char === "'" && !state.double) return toggleQuote(state, "single", k);
  if (char === '"' && !state.single) return toggleQuote(state, "double", k);
  if (SPACE.test(char) && !state.single && !state.double) {
    state.separated = true;
    return k + 1;
  }
  if (char === "#" && state.separated) return "end";
  if (char === "\\") return escapeStep(script, k, state);
  if (char === "$" && !state.single) return variableStep(script, k, state);
  append(state, char);
  return k + 1;
}

function toggleQuote(
  state: SplitState,
  quote: "single" | "double",
  k: number,
): number {
  state[quote] = !state[quote];
  startWord(state);
  return k + 1;
}

function escapeStep(script: string, k: number, state: SplitState): Step {
  const next = script.charAt(k + 1);
  if (state.single && next !== "\\" && next !== "'") {
    append(state, "\\");
    return k + 1;
  }
  if (next === "_" && !state.double) {
    state.separated = true;
    return k + 2;
  }
  if (next === "_") {
    append(state, " ");
    return k + 2;
  }
  if (next === "c") return state.double ? undefined : "end";
  const decoded = ESCAPES[next];
  if (decoded === undefined) return undefined;
  append(state, decoded);
  return k + 2;
}

function variableStep(script: string, k: number, state: SplitState): Step {
  VARIABLE.lastIndex = k;
  const match = VARIABLE.exec(script);
  if (match === null) return undefined;
  startWord(state);
  flushLiteral(state);
  state.words[state.words.length - 1] += `"\${${match[1]}}"`;
  return k + match[0].length;
}

function startWord(state: SplitState): void {
  if (!state.separated) return;
  flushLiteral(state);
  state.words.push("");
  state.separated = false;
}

function append(state: SplitState, char: string): void {
  startWord(state);
  state.literal += char;
}

function flushLiteral(state: SplitState): void {
  if (state.literal === "" || state.words.length === 0) return;
  state.words[state.words.length - 1] += shellQuote(state.literal);
  state.literal = "";
}

function finish(state: SplitState): string[] {
  flushLiteral(state);
  return state.words.map((word) => (word === "" ? "''" : word));
}

/** `text` single-quoted for the shell. */
export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}
