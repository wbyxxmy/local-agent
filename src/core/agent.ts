import { nanoid } from "nanoid";
import { SessionMemory } from "../memory/session-memory.js";
import { Planner } from "./planner.js";
import { ToolRouter } from "./router.js";
import { ToolExecutor } from "./executor.js";
import type { ToolContext } from "../types/tool.js";
import type { ToolRegistry } from "./registry.js";
import { EventBus } from "./event-bus.js";
import { CliApprover } from "../approval/cli-approver.js";

export class LocalAgent {
  private readonly executor: ToolExecutor;
  private readonly router = new ToolRouter();
  private readonly planner = new Planner();
  private readonly memory = new SessionMemory();
  private readonly approver = new CliApprover();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly workspaceRoot: string,
    private readonly eventBus: EventBus
  ) {
    this.executor = new ToolExecutor(registry);
  }

  async run(userInput: string) {
    const sessionId = nanoid();

    this.memory.add({
      role: "user",
      content: userInput,
      timestamp: Date.now()
    });

    const candidateTools = this.router.selectTools(
      userInput,
      this.registry.list()
    );

    const plan = this.planner.createPlan(userInput);
    const results: unknown[] = [];

    const ctx: ToolContext = {
      sessionId,
      workspaceRoot: this.workspaceRoot,
      requestApproval: async (payload) => this.approver.requestApproval(payload),
      emitEvent: (event) => this.eventBus.emit(event)
    };

    for (const step of plan.steps) {
      if (step.kind === "tool_call" && step.toolName) {
        if (!candidateTools.find((t) => t.name === step.toolName)) {
          results.push({
            stepId: step.id,
            ok: false,
            error: `Tool not selected by router: ${step.toolName}`
          });
          continue;
        }

        const result = await this.executor.execute(
          step.toolName,
          step.input ?? {},
          ctx
        );

        results.push({
          stepId: step.id,
          ...result
        });
      } else {
        results.push({
          stepId: step.id,
          ok: true,
          data: step.content
        });
      }
    }

    return {
      sessionId,
      candidateTools: candidateTools.map((t) => t.name),
      plan,
      results
    };
  }
}