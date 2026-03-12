import type { PolicyConfig } from "../../config/policy.js";

export interface ShellCheckResult {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason?: string;
}

export function checkCommandPolicy(
  command: string,
  policy: PolicyConfig
): ShellCheckResult {
  const normalized = command.trim();

  for (const denied of policy.shell.deny) {
    if (normalized === denied || normalized.startsWith(`${denied} `)) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `Command denied by policy: ${denied}`
      };
    }
  }

  const base = normalized.split(/\s+/)[0] ?? "";
  const allowedBase = policy.shell.allow.includes(base);

  if (!allowedBase) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: `Command not in allowlist: ${base}`
    };
  }

  const requiresConfirmation = policy.shell.requireConfirmation.some((item) =>
    normalized === item || normalized.startsWith(`${item} `)
  );

  return {
    allowed: true,
    requiresConfirmation,
    reason: requiresConfirmation ? "Command requires confirmation" : undefined
  };
}