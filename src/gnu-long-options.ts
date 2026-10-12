/** How a long option takes its argument, as getopt_long's `has_arg`. */
type LongOptionArgument = "none" | "required" | "optional";

/** One getopt_long table entry. Entries sharing an `id` are aliases: a prefix
 *  matching only aliases with the same `argument` is not ambiguous, as glibc
 *  compares `val` and `has_arg`, not names. */
export interface LongOption {
  readonly name: string;
  readonly argument: LongOptionArgument;
  readonly id?: string;
}

type ResolvedLongOption = Pick<LongOption, "name" | "argument"> & {
  readonly inlineValue: boolean;
};

/** Resolves `--name[=value]` as glibc's getopt_long does; `undefined` means
 *  the real tool rejects the token and runs nothing. */
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
