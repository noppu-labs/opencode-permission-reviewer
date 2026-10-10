// Per-runtime interpreter specs: the subcommands that take a file operand or
// never do, and the options that consume a value, never do, or make the
// executed file undeterminable.

// Bun subcommands whose operand names a package or workspace, never a local
// script file. `run` is absent: it accepts a direct file target and is handled
// by the interpreter spec below.
const BUN_SUBCOMMANDS = new Set([
  "add",
  "build",
  "create",
  "install",
  "link",
  "pm",
  "publish",
  "remove",
  "test",
  "unlink",
  "update",
  "x",
]);

export interface InterpreterSpec {
  // Subcommands whose first non-option operand executes a local file.
  fileTargetSubcommands?: Set<string>;
  // Options that consume the next token as their value; the value is never
  // the script target.
  valueOptions?: Set<string>;
  // Tokens that OPTIONS_WITH_VALUE consumes for other interpreters but this
  // runtime treats as non-consuming flags (their value syntax is `=`, or they
  // are repeated permission shorts).
  noConsumeOptions?: Set<string>;
  // Options after which the executed file cannot be determined reliably;
  // gathering nothing beats attaching the wrong file.
  bailOptions?: Set<string>;
  // Subcommands whose operand is never a local file.
  nonFileSubcommands?: Set<string>;
  // A subcommand-less invocation still executes a file operand: require the
  // path-like shape so unrecognized subcommands gather nothing.
  directRequiresPathLike?: boolean;
}

// Deno permission shorts and require-equals flags never consume the next
// token even though other runtimes use the same spellings with a value.
const DENO_NO_CONSUME = new Set(["-r", "-W", "-I"]);

// Node flags that consume the next token when written without `=`; tsx
// forwards every flag it does not own, so tsx inherits the same table.
const NODE_VALUE_OPTIONS = new Set([
  "-C",
  "--conditions",
  "--env-file",
  "--env-file-if-exists",
  "--experimental-loader",
  "--test-reporter-destination",
  "--test-reporter",
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-concurrency",
  "--test-timeout",
  "--test-shard",
  "--input-type",
  "--inspect-port",
  "--inspect-publish-uid",
  "--diagnostic-dir",
  "--snapshot-blob",
  "--icu-data-dir",
  "--openssl-config",
  "--redirect-warnings",
  "--heapsnapshot-signal",
]);

export const INTERPRETER_SPECS: Record<string, InterpreterSpec> = {
  node: {
    valueOptions: NODE_VALUE_OPTIONS,
  },
  bun: {
    fileTargetSubcommands: new Set(["run"]),
    valueOptions: new Set([
      "-F",
      "--filter",
      "--elide-lines",
      "--shell",
      "--env-file",
      "--preload",
      "--tsconfig-override",
    ]),
    bailOptions: new Set(["--cwd", "--config"]),
    nonFileSubcommands: BUN_SUBCOMMANDS,
  },
  deno: {
    fileTargetSubcommands: new Set(["run", "serve", "watch"]),
    valueOptions: new Set([
      "-c",
      "--config",
      "--import-map",
      "--importmap",
      "--conditions",
      "--location",
      "--cert",
      "--ext",
      "--seed",
      "-L",
      "--log-level",
      "--preload",
      "--minimum-dependency-age",
      "--min-dep-age",
      "--inspect-publish-uid",
      "--cpu-prof-dir",
      "--cpu-prof-name",
      "--cpu-prof-interval",
      "--lock",
      "--port",
      "--host",
    ]),
    noConsumeOptions: DENO_NO_CONSUME,
    directRequiresPathLike: true,
  },
  tsx: {
    fileTargetSubcommands: new Set(["watch"]),
    valueOptions: new Set([
      "--tsconfig",
      "--include",
      "--exclude",
      "--ignore",
      "--env-file",
      "--env-file-if-exists",
      "-C",
      "--conditions",
      "--watch-path",
      "--experimental-loader",
      ...NODE_VALUE_OPTIONS,
    ]),
  },
};
