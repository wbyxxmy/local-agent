import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "../../types/tool.js";
import { FileSandbox } from "../../infra/fs/sandbox.js";
import type { PolicyConfig } from "../../config/policy.js";

const inputSchema = z.object({
  path: z.string(),
  content: z.string(),
  createDirectories: z.boolean().default(true)
});

export function createWriteFileTool(policy: PolicyConfig): ToolDefinition<
  z.infer<typeof inputSchema>,
  { path: string; bytesWritten: number }
> {
  return {
    name: "write_file",
    description: "Write a text file into the workspace",
    riskLevel: "high",
    requiresConfirmation: true,
    inputSchema,
    async run(input, ctx) {
      const sandbox = new FileSandbox(ctx.workspaceRoot, policy);
      const abs = sandbox.resolveUserPath(input.path);

      if (input.createDirectories) {
        await fs.mkdir(path.dirname(abs), { recursive: true });
      }

      await fs.writeFile(abs, input.content, "utf8");

      return {
        ok: true,
        data: {
          path: input.path,
          bytesWritten: Buffer.byteLength(input.content, "utf8")
        }
      };
    }
  };
}