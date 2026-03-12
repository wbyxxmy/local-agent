export interface PolicyConfig {
  allowedRoots: string[];
  deniedPathPrefixes: string[];
  shell: {
    allow: string[];
    deny: string[];
    requireConfirmation: string[];
  };
}

export function createDefaultPolicy(workspaceRoot: string): PolicyConfig {
  return {
    allowedRoots: [workspaceRoot],
    deniedPathPrefixes: [
      ".git",
      ".env",
      ".env.local",
      ".ssh",
      ".aws",
      ".npmrc"
    ],
    shell: {
      allow: [
        "ls",
        "cat",
        "find",
        "grep",
        "git",
        "node",
        "npm",
        "pnpm",
        "yarn",
        "tsc"
      ],
      deny: [
        "rm",
        "sudo",
        "curl",
        "wget",
        "mkfs",
        "dd",
        "chmod",
        "chown"
      ],
      requireConfirmation: [
        "git push",
        "npm publish",
        "pnpm publish",
        "yarn publish"
      ]
    }
  };
}