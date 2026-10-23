// The `script command` subcommand: print a verified SSH command that runs a fully inspected local script.
import { parseArgs } from "node:util";
import { redactSecrets } from "../../../utils/redact.ts";
import { includeEvidenceFile } from "../../evidence/files/evidence-file-reader.ts";
import { renderVerifiedSshScriptCommand } from "../../evidence/ssh/verified-ssh-command.ts";
import { VERIFIED_SCRIPT_LIMIT } from "../../evidence/ssh/verified-ssh-script.ts";

export async function runScript(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      file: { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      shell: { type: "string" },
    },
    strict: true,
    allowPositionals: true,
  });
  const file = values.file;
  const host = values.host;
  const shell = values.shell ?? "bash";
  const port = values.port === undefined ? undefined : Number(values.port);
  if (
    positionals.length !== 1 ||
    positionals[0] !== "command" ||
    !file ||
    !/^[A-Za-z0-9_./-]+$/.test(file) ||
    !host ||
    !/^[A-Za-z0-9_.@-]+$/.test(host) ||
    host.startsWith("-") ||
    (shell !== "bash" && shell !== "sh") ||
    (port !== undefined &&
      (!Number.isInteger(port) || port < 1 || port > 65535))
  ) {
    console.error(
      "Usage: script command --file <simple-path> --host <host> [--port <port>] [--shell bash|sh]",
    );
    return 2;
  }
  const directory = process.cwd();
  const evidence = await includeEvidenceFile(
    file,
    directory,
    directory,
    directory,
    VERIFIED_SCRIPT_LIMIT,
  );
  if (
    evidence.status !== "included" ||
    evidence.includedSha256 === undefined ||
    evidence.content === undefined ||
    redactSecrets(evidence.content) !== evidence.content
  ) {
    console.error(
      `Script cannot be fully inspected (${evidence.status}). Use a text file of at most 64 KiB inside the workspace or /tmp/opencode, without secrets.`,
    );
    return 1;
  }
  console.log(
    renderVerifiedSshScriptCommand({
      path: file,
      destination: host,
      ...(port === undefined ? {} : { port }),
      sha256: evidence.includedSha256,
      shell,
    }),
  );
  return 0;
}
