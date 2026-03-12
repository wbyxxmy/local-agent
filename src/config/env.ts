import path from "node:path";
import process from "node:process";

export interface AppConfig {
  workspaceRoot: string;
  dataDir: string;
  defaultModel: string;
  shellEnabled: boolean;
  networkEnabled: boolean;
  planner: {
    localModelEnabled: boolean;
    localModelBaseUrl: string;
    localModelName: string;
    localModelTimeoutMs: number;
    maxPlannerInputChars: number;
    maxSkillCandidates: number;
    maxPlanningTurns: number;
    maxObservationChars: number;
    maxTotalPlanningTokens: number;
    softBudgetRatio: number;
    skillCatalogDir: string;
    skillCatalogAutoReload: boolean;
    skillCatalogRefreshMs: number;
  };
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
    networkEnabled: process.env.NETWORK_ENABLED === "true",
    planner: {
      localModelEnabled: process.env.LOCAL_MODEL_ENABLED === "true",
      localModelBaseUrl:
        process.env.LOCAL_MODEL_BASE_URL || "http://127.0.0.1:11434",
      localModelName: process.env.LOCAL_MODEL_NAME || "qwen2.5:7b",
      localModelTimeoutMs: Number(process.env.LOCAL_MODEL_TIMEOUT_MS || 8000),
      maxPlannerInputChars: Number(
        process.env.MAX_PLANNER_INPUT_CHARS || 600
      ),
      maxSkillCandidates: Number(process.env.MAX_SKILL_CANDIDATES || 4),
      maxPlanningTurns: Number(process.env.MAX_PLANNING_TURNS || 4),
      maxObservationChars: Number(process.env.MAX_OBSERVATION_CHARS || 280),
      maxTotalPlanningTokens: Number(
        process.env.MAX_TOTAL_PLANNING_TOKENS || 0
      ),
      softBudgetRatio: Number(process.env.SOFT_BUDGET_RATIO || 0.7),
      skillCatalogDir:
        process.env.SKILL_CATALOG_DIR || ".local-agent/skills",
      skillCatalogAutoReload:
        process.env.SKILL_CATALOG_AUTO_RELOAD !== "false",
      skillCatalogRefreshMs: Number(
        process.env.SKILL_CATALOG_REFRESH_MS || 1500
      )
    }
  };
}