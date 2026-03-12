import type { ToolRiskLevel } from "../types/tool.js";

export interface ApprovalPayload {
  toolName: string;
  reason: string;
  riskLevel: ToolRiskLevel;
  preview?: unknown;
  sessionId?: string;
}

export interface Approver {
  requestApproval(payload: ApprovalPayload): Promise<boolean>;
}
