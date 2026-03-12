import type { ToolRegistry } from "../core/registry.js";
import type { PolicyConfig } from "../config/policy.js";
import { createReadFileTool } from "./file/read-file.js";
import { createWriteFileTool } from "./file/write-file.js";
import { listFilesTool } from "./file/list-files.js";
import { grepTool } from "./code/grep.js";
import { createRunCommandTool } from "./shell/run-command.js";
import { gitStatusTool } from "./git/git-status.js";

export function registerBuiltinTools(
  registry: ToolRegistry,
  policy: PolicyConfig
) {
  registry.register(createReadFileTool(policy));
  registry.register(createWriteFileTool(policy));
  registry.register(listFilesTool);
  registry.register(grepTool);
  registry.register(createRunCommandTool(policy));
  registry.register(gitStatusTool);
}