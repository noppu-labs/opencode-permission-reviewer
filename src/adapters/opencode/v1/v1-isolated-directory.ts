import type { RuntimeContext } from "../types.ts";
import { setupIsolatedDirectory } from "./v1-review-isolation.ts";

/** The reviewer's isolated scratch directory, set up once and then cached. */
export class IsolatedReviewerDirectory {
  private directory: string | undefined;
  private pending: Promise<string | undefined> | undefined;
  constructor(
    private readonly ctx: Pick<RuntimeContext, "reviewerDirectoryBase">,
    private readonly log: (message: string, details?: unknown) => void,
  ) {}

  /**
   * Resolve (and create once) the scratch directory reviewer sessions run in.
   * The directory has no AGENTS.md/CLAUDE.md or project-supplied config, so the
   * host only loads the user's trusted global instructions for the reviewer
   * session. A local config plus bootstrap plugin exclude the user's global
   * MCP servers from this location: without them the host boots a second
   * in-process Instance that spawns every enabled server under the parent PID
   * for the life of the session, even though the reviewer denies all tools.
   * Returns undefined when the directory cannot be created so the caller fails
   * into the configured reviewer-error disposition.
   */
  async resolve(): Promise<string | undefined> {
    if (this.directory !== undefined) return this.directory;
    // Share first setup across concurrent reviews. Failed setup is not cached,
    // so a later review can retry after its isolation files become usable.
    this.pending ??= setupIsolatedDirectory(this.ctx, this.log).then(
      (directory) => {
        if (directory === undefined) this.pending = undefined;
        else this.directory = directory;
        return directory;
      },
      (error) => {
        this.pending = undefined;
        throw error;
      },
    );
    return this.pending;
  }
}
