import path from "node:path";
import type { PolicyConfig } from "../../config/policy.js";
import { resolveInRoot } from "./paths.js";

export class FileSandbox {
  constructor(
    private readonly workspaceRoot: string,
    private readonly policy: PolicyConfig
  ) {}

  resolveUserPath(targetPath: string): string {
    const abs = resolveInRoot(this.workspaceRoot, targetPath);
    const rel = path.relative(this.workspaceRoot, abs);

    for (const denied of this.policy.deniedPathPrefixes) {
      if (rel === denied || rel.startsWith(`${denied}${path.sep}`)) {
        throw new Error(`Access denied for path: ${targetPath}`);
      }
    }

    return abs;
  }
}