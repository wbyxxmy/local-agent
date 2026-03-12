import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "../../types/tool.js";

const inputSchema = z.object({
  query: z.string().min(1),
  pattern: z.string().default("**/*.{ts,tsx,js,jsx,json,md}"),
  limit: z.number().int().positive().max(200).default(50)
});

export const grepTool: ToolDefinition<
  z.infer<typeof inputSchema>,
  { matches: Array<{ path: string; line: number; text: string }> }
> = {
  name: "grep_code",
  description: "Search text in workspace files",
  riskLevel: "low",
  inputSchema,
  async run(input, ctx) {
    const files = await fg(input.pattern, {
      cwd: ctx.workspaceRoot,
      onlyFiles: true,
      dot: false,
      ignore: ["node_modules/**", ".git/**", ".local-agent/**", "dist/**"]
    });

    const matches: Array<{ path: string; line: number; text: string }> = [];

    for (const file of files) {
      if (matches.length >= input.limit) break;

      const abs = path.join(ctx.workspaceRoot, file);
      const content = await fs.readFile(abs, "utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(input.query)) {
          matches.push({
            path: file,
            line: i + 1,
            text: lines[i]
          });

          if (matches.length >= input.limit) break;
        }
      }
    }

    return {
      ok: true,
      data: { matches }
    };
  }
};