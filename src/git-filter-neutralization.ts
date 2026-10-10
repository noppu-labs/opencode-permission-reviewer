// Git filter neutralisation: scans configured conversion filters and textconv drivers and builds no-op overrides.

import { execFileAsync, gitInspectionEnv } from "./git-run.ts";

/** Git inspection must never execute repository-configured extensions before
 *  the permission decision. Conversion filters (`clean`/`smudge`/`process`)
 *  and diff `textconv` drivers are shell commands from git config; disabling
 *  hooks, fsmonitor, and external diff is not enough because `git status` and
 *  `git diff` can invoke them on content comparison. Enumerate the configured
 *  keys (pure config reading, executes nothing) and override every one with a
 *  no-op so the evidence snapshot cannot run repo code.
 *
 *  The scan uses NUL-delimited output (`git config -z --get-regexp`), where
 *  each record is `key\nvalue\0`: splitting lines on whitespace would
 *  mis-parse legal subsections containing spaces (`[filter "a b"]`) and
 *  silently leave them active. Names containing `=` cannot be expressed
 *  through `-c KEY=VALUE` overrides (the override splits on the first `=`),
 *  so such a name fails the scan instead of being partially neutralized.
 *
 *  Only the in-flight subprocess is shared per directory: concurrent snapshots
 *  reuse one scan so burst evidence collection does not multiply git
 *  processes, but the result is never reused across time — a repository whose
 *  config changed since the last verified scan must be re-verified, not
 *  inspected on stale assurance. A failed or over-limit scan fails closed: if
 *  the whole relevant config cannot be proven neutralized, the snapshot is
 *  withheld rather than risk running repo code. */
const MAX_NEUTRALIZED_FILTERS = 50;
const MAX_NEUTRALIZED_DIFF_DRIVERS = 50;
const inFlightFilterScans = new Map<string, Promise<string[]>>();

/** Filter/driver names may themselves contain dots (`filter.a.b.clean`), so
 *  keys are matched structurally (strip the section and the trailing property)
 *  instead of with a dot-free capture group. Names may also contain spaces
 *  (`[filter "a b"]` is legal and overridable via `-c`), so keys are parsed
 *  from NUL-delimited scan output, never by splitting on whitespace. */
export function collectConversionKeys(stdout: string): {
  filterNames: Set<string>;
  diffDrivers: Set<string>;
} {
  const filterNames = new Set<string>();
  const diffDrivers = new Set<string>();
  // `git config -z --get-regexp` emits one `key\nvalue\0` record per match;
  // the key is everything before the first newline, whatever it contains.
  for (const record of stdout.split("\0")) {
    const newline = record.indexOf("\n");
    const key = newline < 0 ? record : record.slice(0, newline);
    if (key.startsWith("filter.")) addNonEmpty(filterNames, filterName(key));
    else if (key.startsWith("diff.") && key.endsWith(".textconv"))
      addNonEmpty(
        diffDrivers,
        key.slice("diff.".length, key.length - ".textconv".length),
      );
  }
  return { filterNames, diffDrivers };
}

const FILTER_PROPS = [".clean", ".smudge", ".process", ".required"];

/** The filter name in a `filter.<name>.<prop>` key, when `<prop>` is one
 *  that can run or require a filter. */
function filterName(key: string): string | undefined {
  const prop = FILTER_PROPS.find((suffix) => key.endsWith(suffix));
  if (prop === undefined) return undefined;
  return key.slice("filter.".length, key.length - prop.length);
}

function addNonEmpty(names: Set<string>, name: string | undefined): void {
  if (name !== undefined && name.length > 0) names.add(name);
}

/** Build the `-c` overrides that neutralize every collected filter and diff
 *  driver. A name containing `=` cannot be expressed as a `-c KEY=VALUE`
 *  override (the override splits on the first `=` and would arm the wrong
 *  key), so it throws and the caller withholds the snapshot instead. */
export function conversionNeutralizationArgs(
  filterNames: Set<string>,
  diffDrivers: Set<string>,
): string[] {
  for (const name of filterNames) {
    if (name.includes("=")) {
      throw new Error(
        `repository configures conversion filter "${name}" which cannot be neutralized with a config override; refusing to inspect`,
      );
    }
  }
  for (const driver of diffDrivers) {
    if (driver.includes("=")) {
      throw new Error(
        `repository configures diff textconv driver "${driver}" which cannot be neutralized with a config override; refusing to inspect`,
      );
    }
  }
  const args: string[] = [];
  for (const name of filterNames) {
    args.push(
      "-c",
      `filter.${name}.clean=cat`,
      "-c",
      `filter.${name}.smudge=cat`,
      "-c",
      `filter.${name}.process=`,
      "-c",
      `filter.${name}.required=false`,
    );
  }
  for (const driver of diffDrivers) {
    args.push("-c", `diff.${driver}.textconv=`);
  }
  return args;
}

export function filterNeutralizationArgs(directory: string): Promise<string[]> {
  const existing = inFlightFilterScans.get(directory);
  if (existing !== undefined) return existing;
  const scan = (async () => {
    try {
      const result = await execFileAsync(
        "git",
        ["config", "-z", "--get-regexp", "^(filter|diff)\\."],
        {
          cwd: directory,
          timeout: 5_000,
          maxBuffer: 64 * 1024,
          encoding: "utf8",
          env: gitInspectionEnv(),
        },
      );
      return boundedNeutralizationArgs(result.stdout);
    } catch (error) {
      return noMatchArgsOrRethrow(error);
    } finally {
      inFlightFilterScans.delete(directory);
    }
  })();
  inFlightFilterScans.set(directory, scan);
  return scan;
}

function boundedNeutralizationArgs(stdout: string): string[] {
  const { filterNames, diffDrivers } = collectConversionKeys(stdout);
  if (filterNames.size > MAX_NEUTRALIZED_FILTERS) {
    // A resource limit must never degrade into "inspect while leaving the
    // remainder active": refuse the inspection instead.
    throw new Error(
      `repository configures ${filterNames.size} conversion filters (limit ${MAX_NEUTRALIZED_FILTERS}); refusing to inspect`,
    );
  }
  if (diffDrivers.size > MAX_NEUTRALIZED_DIFF_DRIVERS) {
    throw new Error(
      `repository configures ${diffDrivers.size} diff textconv drivers (limit ${MAX_NEUTRALIZED_DIFF_DRIVERS}); refusing to inspect`,
    );
  }
  return conversionNeutralizationArgs(filterNames, diffDrivers);
}

/** The args for a scan that failed with `error`: none when nothing matched,
 *  otherwise the failure is rethrown. */
function noMatchArgsOrRethrow(error: unknown): string[] {
  const record = error as { code?: unknown };
  // git config exits 1 when nothing matches: the common, benign case.
  if (record.code === 1) return [];
  // Surface scan failures so the caller fails closed instead of
  // inspecting unverified.
  throw error instanceof Error ? error : new Error(String(error));
}
