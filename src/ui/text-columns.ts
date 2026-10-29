import type { TextUnit, UnitSplitter } from "../utils/text-units.ts";
import { isEastAsianWide } from "./east-asian-wide.ts";

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]+$/u;
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const EMOJI_VARIATION = /\p{Extended_Pictographic}\uFE0F/u;
const KEYCAP = /^[#*0-9]\uFE0F?\u20E3$/u;
/** Text whose every code point is its own one-column grapheme: printable
 *  ASCII and the fit's own ⋯ and ⏎ markers. */
const ONE_COLUMN_EACH = /^[\x20-\x7e\u22ef\u23ce]*$/;

function clusterColumns(cluster: string): number {
  if (ZERO_WIDTH.test(cluster)) return 0;
  const first = cluster.codePointAt(0) ?? 0;
  if (
    isEastAsianWide(first) ||
    EMOJI_PRESENTATION.test(cluster) ||
    EMOJI_VARIATION.test(cluster) ||
    KEYCAP.test(cluster)
  ) {
    return 2;
  }
  return 1;
}

/** One unit per grapheme cluster, measured in the terminal columns OpenTUI renders. */
export const columnUnits: UnitSplitter = (text: string): TextUnit[] => {
  if (ONE_COLUMN_EACH.test(text))
    return Array.from(
      text,
      (char: string): TextUnit => ({
        text: char,
        columns: 1,
      }),
    );
  const units: TextUnit[] = [];
  for (const { segment } of SEGMENTER.segment(text)) {
    units.push({ text: segment, columns: clusterColumns(segment) });
  }
  return units;
};
