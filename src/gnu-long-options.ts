/** How a long option takes its argument, as getopt_long's `has_arg`. */
type LongOptionArgument = "none" | "required" | "optional";

/** One getopt_long table entry. Entries sharing an `id` are aliases: a prefix
 *  matching only them is not ambiguous, as glibc compares `val`, not names. */
export interface LongOption {
  readonly name: string;
  readonly argument: LongOptionArgument;
  readonly id?: string;
}

type ResolvedLongOption = Pick<LongOption, "name" | "argument"> & {
  readonly inlineValue: boolean;
};

/**
 * Resolves a `--name[=value]` token the way glibc's getopt_long does: an exact
 * name wins, otherwise a prefix shared by one option (or only by its aliases)
 * resolves to it. An empty, unknown, or ambiguous name, or `=value` on a
 * no-argument option, gives undefined: the real tool rejects those and runs
 * nothing.
 */
export function resolveGnuLongOption(
  token: string,
  table: readonly LongOption[],
): ResolvedLongOption | undefined {
  if (!token.startsWith("--")) return undefined;
  const equals = token.indexOf("=");
  const inlineValue = equals !== -1;
  const name = token.slice(2, inlineValue ? equals : undefined);
  if (name === "") return undefined;
  const match =
    table.find((option) => option.name === name) ?? uniquePrefix(name, table);
  if (match === undefined) return undefined;
  if (inlineValue && match.argument === "none") return undefined;
  return { name: match.name, argument: match.argument, inlineValue };
}

function uniquePrefix(
  name: string,
  table: readonly LongOption[],
): LongOption | undefined {
  const candidates = table.filter((option) => option.name.startsWith(name));
  const [first] = candidates;
  if (first === undefined) return undefined;
  const id = first.id ?? first.name;
  const ambiguous = candidates.some(
    (option) =>
      (option.id ?? option.name) !== id || option.argument !== first.argument,
  );
  return ambiguous ? undefined : first;
}
