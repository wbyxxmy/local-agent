import fg from "fast-glob";
import { z } from "zod";
import type { ToolDefinition } from "../../types/tool.js";

const inputSchema = z.object({
  pattern: z.string().default("**/*"),
  onlyFiles: z.boolean().default(true),
  limit: z.number().int().positive().max(500).default(200)
});

export const listFilesTool: ToolDefinition<
  z.infer<typeof inputSchema>,
  { files: string[] }
> = {
  name: "list_files",
  description: "List files in the workspace by glob pattern",
  riskLevel: "low",
  inputSchema,
  async run(input, ctx) {
    const files = await fg(input.pattern, {
      cwd: ctx.workspaceRoot,
      onlyFiles: input.onlyFiles,
      dot: false,
      ignore: ["node_modules/**", ".git/**", ".local-agent/**", "dist/**"]
    });

    return {
      ok: true,
      data: {
        files: files.slice(0, input.limit)
      }
    };
  }
};