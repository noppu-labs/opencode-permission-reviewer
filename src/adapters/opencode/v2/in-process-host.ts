import type {
  McpListInput,
  ModelListInput,
  PluginListInput,
  SessionContextInput,
  SessionCreateInput,
  SessionGetInput,
  SessionInterruptInput,
  SessionPromptInput,
  SessionRemoveInput,
  SessionWaitInput,
} from "@opencode/client";
import type { Plugin } from "@opencode/plugin";
import type { V2HostApi } from "./host-api.ts";
import { isolatedContext } from "./isolated-contexts.ts";

type Context = Parameters<Plugin.Plugin["setup"]>[0];

/** A V2 host backed by this plugin's context. Model and plugin inventories
 *  come from the isolated location's own context, since the plugin context
 *  lists them only for its own location. */
export function createInProcessHost(ctx: Context): V2HostApi {
  return {
    session: {
      create: (input?: SessionCreateInput) => ctx.session.create(input),
      get: (input: SessionGetInput) => ctx.session.get(input),
      context: (input: SessionContextInput) => ctx.session.context(input),
      prompt: (input: SessionPromptInput) => ctx.session.prompt(input),
      wait: (input: SessionWaitInput) => ctx.session.wait(input),
      interrupt: (input: SessionInterruptInput) => ctx.session.interrupt(input),
      remove: (input: SessionRemoveInput) => ctx.session.remove(input),
    },
    mcp: {
      list: (input?: McpListInput) => ctx.mcp.list(input),
    },
    model: {
      list: async (input?: ModelListInput) => {
        if (!input?.location?.directory)
          throw new Error("Reviewer host call requires the isolated location");
        const isolated = isolatedContext(input.location.directory);
        if (!isolated)
          throw new Error("Reviewer isolated location is not active");
        return isolated.model.list();
      },
    },
    plugin: {
      list: async (input?: PluginListInput) => {
        if (!input?.location?.directory)
          throw new Error("Reviewer host call requires the isolated location");
        const isolated = isolatedContext(input.location.directory);
        if (!isolated)
          return { location: { directory: ctx.location.directory }, data: [] };
        return isolated.plugin.list();
      },
    },
  };
}
