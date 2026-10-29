import { expect, test } from "bun:test";

type Step = { name?: string; if?: string; uses?: string; run?: string };
type Job = {
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps: Step[];
};
type Workflow = {
  on: { push: { branches?: string[]; tags?: string[]; paths?: string[] } };
  jobs: Record<string, Job>;
};

const workflow = Bun.YAML.parse(
  await Bun.file(`${import.meta.dir}/../.github/workflows/release.yml`).text(),
) as Workflow;
const jobs: Record<string, Job> = workflow.jobs;
const installs = /\b(bun install|uv sync|pre-commit|npm install|npm ci)\b/;

test("release runs on v* tags and on every push to main", () => {
  expect(workflow.on.push).toEqual({
    branches: ["main"],
    tags: ["v*"],
  });
});

test("jobs that can write never install dependencies or run hooks", () => {
  for (const [name, job] of Object.entries(jobs)) {
    const writes = Object.values(job.permissions ?? {}).includes("write");
    if (!writes) continue;
    for (const step of job.steps)
      expect({ job: name, run: step.run ?? "" }).not.toMatchObject({
        run: expect.stringMatching(installs),
      });
  }
});

test("pending and tag jobs hold only the permissions they need and check nothing out", () => {
  expect(jobs.pending?.permissions).toEqual({ contents: "read" });
  expect(jobs.tag?.permissions).toEqual({
    contents: "write",
    actions: "write",
  });
  for (const job of [jobs.pending, jobs.tag])
    expect(job?.steps.filter((step) => step.uses)).toEqual([]);
});

test("the tag job waits for the pre-check build and dispatches at the tag", () => {
  expect(jobs.tag?.needs).toContain("build");
  const script = jobs.tag?.steps.map((step) => step.run ?? "").join("\n") ?? "";
  expect(script).toContain(
    'gh workflow run release.yml --repo "$GITHUB_REPOSITORY" --ref "$TAG" -f tag="$TAG"',
  );
});

test("publish never runs on the push to main", () => {
  expect(jobs.publish?.if).toContain(
    "!(github.event_name == 'push' && github.ref_type == 'branch')",
  );
});

test("quality and build gate the pre-check on a pending version and pick the right tag check", () => {
  expect(jobs.quality?.if).toContain(
    "needs.pending.result == 'skipped' || needs.pending.outputs.due == 'true'",
  );
  expect(jobs.build?.if).toContain("needs.quality.result == 'success'");
  for (const job of [jobs.quality, jobs.build]) {
    const step = (name: string): Step | undefined =>
      job?.steps.find((candidate) => candidate.name === name);
    expect(step("Verify tag (pre-install gate)")?.if).toBe(
      `\${{ !needs.pending.outputs.tag }}`,
    );
    expect(step("Verify untagged main commit (pre-install gate)")?.if).toBe(
      `\${{ needs.pending.outputs.tag }}`,
    );
  }
});
