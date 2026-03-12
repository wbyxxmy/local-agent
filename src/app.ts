import { loadConfig } from "./config/env.js";
import { createDefaultPolicy } from "./config/policy.js";
import { ToolRegistry } from "./core/registry.js";
import { EventBus } from "./core/event-bus.js";
import { registerBuiltinTools } from "./tools/registry.js";
import { LocalAgent } from "./core/agent.js";
import { Planner } from "./core/planner.js";

export function createApp() {
  const config = loadConfig();
  const policy = createDefaultPolicy(config.workspaceRoot);
  const registry = new ToolRegistry();
  const eventBus = new EventBus();

  registerBuiltinTools(registry, policy);

  const planner = new Planner(
    config.planner,
    config.workspaceRoot,
    new Set(registry.list().map((tool) => tool.name)),
    (event) => eventBus.emit(event)
  );

  const agent = new LocalAgent(
    registry,
    config.workspaceRoot,
    eventBus,
    planner
  );

  return {
    config,
    policy,
    registry,
    eventBus,
    agent
  };
}