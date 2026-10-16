import { describe, expect, test } from "bun:test";
import { legacySanitizedCommand } from "../src/capability/heredoc-legacy.ts";
import { emergencyBrakeReason } from "../src/emergency-brake.ts";
import { request } from "./helpers.ts";

const blocked =
  "Emergency brake: command contains unmistakable broad system destruction.";

// The previous release's sanitized command for representative inputs. The
// expected strings are that release's output, not this module's.
describe("previous release's heredoc reading", () => {
  test.each([
    [
      "cat <<EOF\r\nit's\r\nEOF\r\nls",
      "cat <<EOF <HEREDOC:sha256:4d3d22a63dad>\r\n",
    ],
    [
      "echo $(( (1)+(1<<2) ))\ncat <<EOF\nit's\nEOF",
      "echo $(( (1)+(1<<2) ))\ncat <<EOF <HEREDOC:sha256:a53006eb431e>\n",
    ],
    [
      "echo $'a\\'b' <<EOF\nrm -rf /\nEOF",
      "echo $'a\\'b' <<EOF\nrm -rf /\nEOF",
    ],
    [
      "cat <<A; x=$( cat <<B\nit's\nB\n)\nabody\nA",
      "cat <<A <HEREDOC:sha256:7bbc2270cc42>; x=$( cat <<B <HEREDOC:sha256:e3b0c44298fc>\n",
    ],
    [
      "x=`cat <<EOF\nit's\n`\nrm -rf /",
      "x=`cat <<EOF <HEREDOC:sha256:06e98c68a267>\n",
    ],
  ])("collapses %p as the previous release did", (command, sanitized) => {
    expect(legacySanitizedCommand(command)).toBe(sanitized);
  });
});

// Shapes the previous release blocks: the brake blocks each of them too.
describe("brake blocks what the previous release blocks", () => {
  test.each([
    `echo $((1)+(1<<2))\ncat <<EOF\nit's\nEOF\nrm -rf /`,
    `echo $((1)+(1<<2)) <<EOF\nit's\nEOF\nrm -rf /`,
    `cat <<A; x=$((cat)<<B\nb\n)\nit's\nA\nrm -rf /`,
    `x=$((cat)<<EOF\n)\nrm -rf /\nEOF`,
    `echo $((1)+(1<<2\n))\nrm -rf /\n2`,
    "x=`cat <<EOF\n`\nrm -rf /\nEOF",
    "` <<EOF;$((\nrm -rf /",
    "`<<EOF));((\nrm -rf /",
  ])("blocks %p", (command) => {
    expect(emergencyBrakeReason(request({ metadata: { command } }))).toBe(
      blocked,
    );
  });
});
