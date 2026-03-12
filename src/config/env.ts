import path from "node:path";
import process from "node:process";

export interface AppConfig {
  workspaceRoot: string;
  dataDir: string;
  defaultModel: string;
  shellEnabled: boolean;
  networkEnabled: boolean;
}

export function loadConfig(): AppConfig {
  const workspaceRoot = process.env.WORKSPACE_ROOT
    ? path.resolve(process.env.WORKSPACE_ROOT)
    : process.cwd();

  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(workspaceRoot, ".local-agent");

  return {
    workspaceRoot,
    dataDir,
    defaultModel: process.env.DEFAULT_MODEL || "local-main-model",
    shellEnabled: process.env.SHELL_ENABLED !== "false",
    networkEnabled: process.env.NETWORK_ENABLED === "true"
  };
}