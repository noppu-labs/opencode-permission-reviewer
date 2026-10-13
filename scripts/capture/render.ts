import { type JSX, testRender } from "@opentui/solid";
import { frameToAnsi, textRow } from "./ansi.ts";
import { CAPTION_COLOR, COLUMNS } from "./fixtures.ts";

/** A real component rendered in a test terminal of the given size. */
interface Section {
  /** An annotation drawn above the block; not part of the TUI. */
  caption?: string | undefined;
  height: number;
  columns?: number;
  view: () => JSX.Element;
}

/** Rows that are not a component render: the text a toast or the sidebar shows. */
interface TextBlock {
  caption: string;
  rows: readonly string[];
}

export type Block = Section | TextBlock;

async function renderSection(section: Section): Promise<string[]> {
  const setup = await testRender(section.view, {
    width: section.columns ?? COLUMNS,
    height: section.height,
  });
  try {
    await setup.flush();
    return frameToAnsi(setup.captureSpans());
  } finally {
    setup.renderer.destroy();
  }
}

/** Renders the blocks top to bottom, one blank row apart. */
export async function renderSections(
  blocks: readonly Block[],
): Promise<string[]> {
  const rows: string[] = [];
  for (const block of blocks) {
    // biome-ignore lint/performance/noAwaitInLoops: @opentui/solid attaches its engine to the latest test renderer, so each section must render and be destroyed before the next starts
    const body = "rows" in block ? [...block.rows] : await renderSection(block);
    if (rows.length > 0) rows.push("");
    if (block.caption !== undefined)
      rows.push(textRow([{ text: `# ${block.caption}`, fg: CAPTION_COLOR }]));
    rows.push(...body);
  }
  return rows;
}
