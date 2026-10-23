/*
 * The src/ layer rules from docs/DEVELOPMENT.md ("Source layout"), checked on
 * every import. Layer direction and the module graph use every import,
 * type-only ones included (a regex over the source, which Biome's formatting
 * keeps to one `from "…"` per statement). The file-cycle check uses runtime
 * imports only (Bun.Transpiler drops type-only imports), because only those
 * affect module evaluation order.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SRC = join(ROOT, "src");

/** Lower layers may not import higher ones; equal layers may import each other
 *  as long as the module graph stays acyclic. */
const LAYER: Record<string, number> = {
  utils: 0,
  kernel: 1,
  analysis: 2,
  decision: 3,
  policy: 3,
  evidence: 3,
  config: 3,
  context: 3,
  reviewer: 4,
  audit: 4,
  status: 4,
  review: 5,
  // Delivery and host: may import anything; nothing below imports them.
  adapters: 6,
  ui: 6,
  cli: 6,
  "(root)": 6,
};
const OUTER = 6;

/** Folders of a module that other modules may not import. Delivery layers
 *  (adapters, ui, cli, the root entry files) may. */
const PRIVATE_DIRS = ["controllers", "repositories"];

/** Files outside src/ that src/ may import. */
const EXTERNAL_ALLOWED = new Set(["package.json"]);

/** Import edges that break a rule today, each removed by the task that fixes
 *  it. The test fails on a violation missing from this list and on an entry
 *  that no longer occurs, so the list only shrinks. */
const ALLOWED: readonly string[] = [];

/** Runtime import cycles inside analysis/ that predate the layout. A new
 *  cycle, or one of these growing, fails the test. */
const KNOWN_CYCLES: readonly string[][] = [
  [
    "modules/analysis/capability/heredoc/heredoc-bodies.ts",
    "modules/analysis/capability/heredoc/heredoc-body-collector.ts",
    "modules/analysis/capability/heredoc/heredoc-body-commands.ts",
    "modules/analysis/capability/heredoc/heredoc-body-early-ends.ts",
    "modules/analysis/capability/heredoc/heredoc-extractor.ts",
    "modules/analysis/capability/heredoc/heredoc-legacy.ts",
    "modules/analysis/capability/heredoc/heredoc-operator-scan.ts",
    "modules/analysis/capability/heredoc/heredoc-sanitized.ts",
    "modules/analysis/shell/shell-substitution.ts",
  ],
  [
    "modules/analysis/shell/shell-scanner.ts",
    "modules/analysis/shell/shell-substitution-lex.ts",
  ],
];

interface Edge {
  from: string;
  to: string;
}

function unit(file: string): string {
  if (file === "index.ts" || file === "tui.tsx") return "(root)";
  const [top, mod] = file.split("/");
  return top === "modules" ? (mod as string) : (top as string);
}

/** A module's controllers/ are a delivery layer: they may import anything. */
function layerOf(file: string): number {
  if (file.split("/").includes("controllers")) return OUTER;
  return LAYER[unit(file)] ?? OUTER;
}

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']+)["']/gm;
const transpiler = new Bun.Transpiler({ loader: "tsx" });

const files: string[] = Array.from(
  new Bun.Glob("**/*.{ts,tsx}").scanSync({ cwd: SRC }),
).sort();
const fileSet = new Set(files);
const edgesAll: Edge[] = [];
const runtimeEdges: Edge[] = [];
const externalEdges: Edge[] = [];
for (const file of files) {
  const text = readFileSync(join(SRC, file), "utf8");
  const resolveSpec = (spec: string): string | undefined => {
    const absolute = normalize(join(dirname(join(SRC, file)), spec));
    const target = relative(SRC, absolute);
    if (!target.startsWith("..")) return target;
    externalEdges.push({ from: file, to: relative(ROOT, absolute) });
    return undefined;
  };
  for (const match of text.matchAll(SPECIFIER)) {
    const to = resolveSpec(match[1] as string);
    if (to) edgesAll.push({ from: file, to });
  }
  for (const entry of transpiler.scan(text).imports) {
    if (!entry.path.startsWith(".")) continue;
    const to = resolveSpec(entry.path);
    if (to) runtimeEdges.push({ from: file, to });
  }
}

function violations(): string[] {
  const found = new Set<string>();
  for (const { from, to } of edgesAll) {
    const [a, b] = [unit(from), unit(to)];
    if (a === b) continue;
    const key = `${from} -> ${to}`;
    if (layerOf(to) > layerOf(from)) found.add(`layer: ${key}`);
    const parts = to.split("/");
    if (
      layerOf(from) < OUTER &&
      parts[0] === "modules" &&
      PRIVATE_DIRS.some((d) => parts.includes(d))
    )
      found.add(`private: ${key}`);
  }
  for (const cycle of moduleCycles())
    found.add(`module-cycle: ${cycle.join(" -> ")}`);
  return [...found].sort();
}

function stronglyConnected(
  nodes: string[],
  next: (n: string) => Iterable<string>,
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  let counter = 0;
  const lower = (v: string, to: number | undefined): void => {
    low.set(v, Math.min(low.get(v) as number, to as number));
  };
  const popComponent = (root: string): string[] => {
    const component: string[] = [];
    let w: string;
    do {
      w = stack.pop() as string;
      onStack.delete(w);
      component.push(w);
    } while (w !== root);
    return component.sort();
  };
  const visit = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter++);
    stack.push(v);
    onStack.add(v);
    for (const w of next(v)) {
      if (!index.has(w)) {
        visit(w);
        lower(v, low.get(w));
      } else if (onStack.has(w)) lower(v, index.get(w));
    }
    if (low.get(v) !== index.get(v)) return;
    const component = popComponent(v);
    if (component.length > 1) out.push(component);
  };
  for (const n of nodes) if (!index.has(n)) visit(n);
  return out.sort((x, y) => x.join().localeCompare(y.join()));
}

function moduleCycles(): string[][] {
  const graph = new Map<string, Set<string>>();
  for (const { from, to } of edgesAll) {
    if (layerOf(from) === OUTER || layerOf(to) === OUTER) continue;
    const [a, b] = [unit(from), unit(to)];
    if (a === b) continue;
    if (!graph.has(a)) graph.set(a, new Set());
    graph.get(a)?.add(b);
  }
  return stronglyConnected([...graph.keys()].sort(), (n) => graph.get(n) ?? []);
}

test("src/ follows the layer rules", () => {
  const found = violations();
  // ARCH_DUMP=1 bun test tests/architecture.test.ts prints the current list.
  if (process.env.ARCH_DUMP) console.log(JSON.stringify(found, null, 2));
  const unexpected = found.filter((v) => !ALLOWED.includes(v));
  const fixed = ALLOWED.filter((v) => !found.includes(v));
  expect({ unexpected, fixed }).toEqual({ unexpected: [], fixed: [] });
});

test("src/ has no runtime import cycles beyond the known ones", () => {
  const graph = new Map<string, Set<string>>();
  for (const { from, to } of runtimeEdges) {
    if (!graph.has(from)) graph.set(from, new Set());
    graph.get(from)?.add(to);
  }
  const cycles = stronglyConnected(files, (n) => graph.get(n) ?? []);
  expect(cycles).toEqual(KNOWN_CYCLES.map((c) => [...c].sort()));
});

test("the src/ root holds only the plugin entries", () => {
  const rootFiles = files.filter((f) => !f.includes("/"));
  expect(rootFiles).toEqual(["index.ts", "tui.tsx"]);
});

test("every file in src/ belongs to a unit with a layer", () => {
  const unknown = files
    .filter((f) => !(unit(f) in LAYER))
    .map((f) => `unknown-unit: ${f} (unit "${unit(f)}")`);
  expect(unknown).toEqual([]);
});

test("every import inside src/ resolves to a scanned file", () => {
  const unresolved = [...edgesAll, ...runtimeEdges]
    .filter(({ to }) => !fileSet.has(to))
    .map(({ from, to }) => `unresolved: ${from} -> ${to}`);
  expect([...new Set(unresolved)].sort()).toEqual([]);
});

test("imports that leave src/ target only allowed files", () => {
  const external = externalEdges
    .filter(({ to }) => !EXTERNAL_ALLOWED.has(to))
    .map(({ from, to }) => `external: ${from} -> ${to}`);
  expect([...new Set(external)].sort()).toEqual([]);
});
