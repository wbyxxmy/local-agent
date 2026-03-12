import type { ToolContext, ToolResult } from "../types/tool.js";
import type { ToolRegistry } from "./registry.js";

export class ToolExecutor {
  constructor(private readonly registry: ToolRegistry) {}

  async execute(
    toolName: string,
    input: unknown,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const tool = this.registry.get(toolName);

    if (!tool) {
      return { ok: false, error: `Tool not found: ${toolName}` };
    }

    const parsed = tool.inputSchema.safeParse(input);

    if (!parsed.success) {
      return {
        ok: false,
        error: `Invalid tool input: ${parsed.error.message}`
      };
    }

    if (tool.requiresConfirmation || tool.riskLevel === "high") {
      const approved = await ctx.requestApproval({
        toolName: tool.name,
        reason: "Tool requires confirmation before execution",
        riskLevel: tool.riskLevel,
        preview: parsed.data
      });

      if (!approved) {
        return { ok: false, error: "User rejected tool execution" };
      }
    }

    ctx.emitEvent({
      type: "tool.execution.started",
      timestamp: Date.now(),
      toolName
    });

    try {
      const result = await tool.run(parsed.data, ctx);

      ctx.emitEvent({
        type: "tool.execution.finished",
        timestamp: Date.now(),
        toolName,
        payload: { ok: result.ok }
      });

      return result;
    } catch (error) {
      ctx.emitEvent({
        type: "tool.execution.failed",
        timestamp: Date.now(),
        toolName,
        payload: {
          error: error instanceof Error ? error.message : String(error)
        }
      });

      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}