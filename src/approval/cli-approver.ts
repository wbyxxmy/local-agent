import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ApprovalPayload, Approver } from "./types.js";

export class CliApprover implements Approver {
  async requestApproval(payload: ApprovalPayload): Promise<boolean> {
    console.log("\n=== Approval Required ===");
    console.log(`Tool: ${payload.toolName}`);
    console.log(`Risk: ${payload.riskLevel}`);
    console.log(`Reason: ${payload.reason}`);

    if (payload.preview !== undefined) {
      console.log("Preview:");
      console.log(JSON.stringify(payload.preview, null, 2));
    }

    console.log("=========================\n");

    const rl = readline.createInterface({ input, output });

    try {
      const answer = await rl.question("Approve? (y/N): ");
      return ["y", "yes"].includes(answer.trim().toLowerCase());
    } finally {
      rl.close();
    }
  }
}