import fs from "node:fs/promises";
import { z } from "zod";
import type { ToolDefinition } from "../../types/tool.js";
import { FileSandbox } from "../../infra/fs/sandbox.js";
import type { PolicyConfig } from "../../config/policy.js";

const inputSchema = z.object({
  path: z.string(),
  encoding: z.enum(["utf8"]).default("utf8")
});

export function createReadFileTool(policy: PolicyConfig): ToolDefinition<
  z.infer<typeof inputSchema>,
  { path: string; content: string }
> {
  return {
    name: "read_file",
    description: "Read a text file from the workspace",
    riskLevel: "low",
    inputSchema,
    async run(input, ctx) {
      const sandbox = new FileSandbox(ctx.workspaceRoot, policy);
      const abs = sandbox.resolveUserPath(input.path);
      const content = await fs.readFile(abs, { encoding: input.encoding });

      return {
        ok: true,
        data: {
          path: input.path,
          content
        }
      };
    }
  };
}