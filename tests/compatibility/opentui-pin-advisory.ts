import { satisfies } from "semver";
import pkg from "../../package.json";

// Read registry metadata only. Dependabot ignores the @opentui/* + solid-js
// set, so nothing else reports when upstream moves @opentui/solid's solid-js
// peer range past our exact pin. Failing here turns the scheduled run red,
// which is the signal to move the three packages together so consumer installs
// keep a single Solid runtime (tests/package-smoke.test.ts).
const pinned: string = pkg.dependencies["solid-js"];
const lookup = Bun.spawn(
  [
    "npm",
    "view",
    "@opentui/solid@latest",
    "version",
    "peerDependencies",
    "--json",
  ],
  { stdout: "pipe", stderr: "pipe" },
);
const [code, stdout, stderr]: [number, string, string] = await Promise.all([
  lookup.exited,
  new Response(lookup.stdout).text(),
  new Response(lookup.stderr).text(),
]);
if (code !== 0)
  throw new Error(`Registry lookup failed for @opentui/solid: ${stderr}`);
const latest = JSON.parse(stdout) as {
  version?: unknown;
  peerDependencies?: Record<string, unknown>;
};
const version: unknown = latest.version;
const peer: unknown = latest.peerDependencies?.["solid-js"];
if (typeof version !== "string" || typeof peer !== "string")
  throw new Error("Invalid registry metadata for @opentui/solid");
if (!satisfies(pinned, peer)) {
  console.log(
    `::error::@opentui/solid ${version} peers solid-js ${peer}, which this package's solid-js pin ${pinned} does not satisfy. Move @opentui/core, @opentui/solid and solid-js together.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `@opentui/solid ${version}: solid-js peer ${peer} still admits pin ${pinned}`,
  );
}
