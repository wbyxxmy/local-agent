import { simpleGit } from "simple-git";
import { z } from "zod";
import type { ToolDefinition } from "../../types/tool.js";

const inputSchema = z.object({});

export const gitStatusTool: ToolDefinition<
  z.infer<typeof inputSchema>,
  unknown
> = {
  name: "git_status",
  description: "Get git working tree status",
  riskLevel: "low",
  inputSchema,
  async run(_input, ctx) {
    const git = simpleGit({ baseDir: ctx.workspaceRoot });
    const status = await git.status();

    return {
      ok: true,
      data: status
    };
  }
};