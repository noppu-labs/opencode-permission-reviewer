/** A getopt_long option word: `--name` or `--name=value`, where `name` may be
 *  any unambiguous prefix of the full option name. `minimum` is the length of
 *  the shortest such prefix, `--` included, so a shorter prefix that another
 *  option of the same tool shares never matches. */
export function longOption(
  value: string,
  name: string,
  minimum: number,
): { inline?: string } | undefined {
  if (!value.startsWith("--")) return undefined;
  const equals = value.indexOf("=");
  const word = equals === -1 ? value : value.slice(0, equals);
  if (word.length < minimum || !name.startsWith(word)) return undefined;
  return equals === -1 ? {} : { inline: value.slice(equals + 1) };
}
