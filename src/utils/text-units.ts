/** One measured piece of text. */
export interface TextUnit {
  readonly text: string;
  readonly columns: number;
}

export type UnitSplitter = (text: string) => TextUnit[];

/** One unit per code point, one column each. */
export const codePointUnits: UnitSplitter = (text: string): TextUnit[] =>
  Array.from(
    text,
    (character: string): TextUnit => ({ text: character, columns: 1 }),
  );

export function unitsColumns(units: readonly TextUnit[]): number {
  return units.reduce((total, unit) => total + unit.columns, 0);
}
