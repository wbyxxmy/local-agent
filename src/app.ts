import { loadConfig } from "./config/env.js";
import { createDefaultPolicy } from "./config/policy.js";
import { ToolRegistry } from "./core/registry.js";
import { EventBus } from "./core/event-bus.js";
import { registerBuiltinTools } from "./tools/registry.js";
import { LocalAgent } from "./core/agent.js";
import { Planner } from "./core/planner.js";
import { CliApprover } from "./approval/cli-approver.js";
import type { Approver } from "./approval/types.js";

interface CreateAppOptions {
  approver?: Approver;
}

export function createApp(options: CreateAppOptions = {}) {
  const config = loadConfig();
  const policy = createDefaultPolicy(config.workspaceRoot);
  const registry = new ToolRegistry();
  const eventBus = new EventBus();

  registerBuiltinTools(registry, policy, {
    networkEnabled: config.networkEnabled
  });

  const planner = new Planner(
    config.planner,
    config.workspaceRoot,
    new Set(registry.list().map((tool) => tool.name)),
    (event) => eventBus.emit(event)
  );

  const approver = options.approver ?? new CliApprover();

  const agent = new LocalAgent(
    registry,
    config.workspaceRoot,
    eventBus,
    planner,
    approver
  );

  return {
    config,
    policy,
    registry,
    eventBus,
    agent
  };
}