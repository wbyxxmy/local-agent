import { z } from "zod";
import type { ToolDefinition } from "../../types/tool.js";
import type { PolicyConfig } from "../../config/policy.js";
import { checkCommandPolicy } from "../../infra/shell/guard.js";
import { execCommand } from "../../infra/shell/exec.js";

const inputSchema = z.object({
  command: z.string().min(1)
});

export function createRunCommandTool(
  policy: PolicyConfig
): ToolDefinition<
  z.infer<typeof inputSchema>,
  { exitCode: number; stdout: string; stderr: string }
> {
  return {
    name: "run_command",
    description: "Run a shell command in the workspace",
    riskLevel: "high",
    requiresConfirmation: true,
    inputSchema,
    async run(input, ctx) {
      const check = checkCommandPolicy(input.command, policy);

      if (!check.allowed) {
        return {
          ok: false,
          error: check.reason
        };
      }

      const result = await execCommand(
        input.command,
        ctx.workspaceRoot,
        ctx.abortSignal
      );

      return {
        ok: true,
        data: result
      };
    }
  };
}