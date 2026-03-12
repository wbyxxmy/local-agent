import { nanoid } from "nanoid";
import type { ApprovalPayload, Approver } from "./types.js";

export interface PendingApproval {
  id: string;
  createdAt: number;
  toolName: string;
  reason: string;
  riskLevel: ApprovalPayload["riskLevel"];
  preview?: unknown;
  sessionId?: string;
}

interface PendingRecord {
  pending: PendingApproval;
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

export class WebApprover implements Approver {
  private readonly pending = new Map<string, PendingRecord>();

  constructor(private readonly timeoutMs = 3 * 60 * 1000) {}

  async requestApproval(payload: ApprovalPayload): Promise<boolean> {
    const id = nanoid();
    const createdAt = Date.now();
    const pending: PendingApproval = {
      id,
      createdAt,
      toolName: payload.toolName,
      reason: payload.reason,
      riskLevel: payload.riskLevel,
      preview: payload.preview,
      sessionId: payload.sessionId
    };

    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(false);
      }, this.timeoutMs);

      this.pending.set(id, {
        pending,
        resolve: (approved) => {
          clearTimeout(timer);
          resolve(approved);
        },
        timer
      });
    });
  }

  listPending(sessionId?: string) {
    const rows = [...this.pending.values()].map((item) => item.pending);
    if (!sessionId) return rows;
    return rows.filter((item) => item.sessionId === sessionId);
  }

  resolveApproval(id: string, approved: boolean) {
    const record = this.pending.get(id);
    if (!record) return false;

    this.pending.delete(id);
    clearTimeout(record.timer);
    record.resolve(approved);
    return true;
  }
}
