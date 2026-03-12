import type { ToolDefinition } from "../types/tool.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<any, any>>();

  register(tool: ToolDefinition<any, any>) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string) {
    return this.tools.get(name);
  }

  list() {
    return [...this.tools.values()];
  }
}