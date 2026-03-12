import { z } from "zod";

export type ToolRiskLevel = "low" | "medium" | "high";

export interface ToolEvent {
  type: string;
  timestamp: number;
  toolName?: string;
  payload?: Record<string, unknown>;
}

export interface ToolContext {
  sessionId: string;
  workspaceRoot: string;
  abortSignal?: AbortSignal;
  requestApproval: (payload: {
    toolName: string;
    reason: string;
    riskLevel: ToolRiskLevel;
    preview?: unknown;
  }) => Promise<boolean>;
  emitEvent: (event: ToolEvent) => void;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  inputSchema: z.ZodType<TInput>;
  requiresConfirmation?: boolean;
  run: (input: TInput, ctx: ToolContext) => Promise<ToolResult<TOutput>>;
}