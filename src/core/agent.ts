import { nanoid } from "nanoid";
import { SessionMemory } from "../memory/session-memory.js";
import { Planner } from "./planner.js";
import { ToolRouter } from "./router.js";
import { ToolExecutor } from "./executor.js";
import type { ToolContext } from "../types/tool.js";
import type { ToolRegistry } from "./registry.js";
import type { PlanStep, PlannerObservation } from "./planner.js";
import { EventBus } from "./event-bus.js";
import { CliApprover } from "../approval/cli-approver.js";

export class LocalAgent {
  private readonly executor: ToolExecutor;
  private readonly router = new ToolRouter();
  private readonly memory = new SessionMemory();
  private readonly approver = new CliApprover();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly workspaceRoot: string,
    private readonly eventBus: EventBus,
    private readonly planner: Planner
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

    const maxTurns = this.planner.supportsMultiTurn()
      ? this.planner.getMaxPlanningTurns()
      : 1;
    const maxTotalPlanningTokens = this.planner.getMaxTotalPlanningTokens();
    const softBudgetRatio = this.planner.getSoftBudgetRatio();

    const observations: PlannerObservation[] = [];
    const allPlanSteps: PlanStep[] = [];
    const planningTrace: Array<{
      turn: number;
      mode: "model" | "rules";
      budgetMode: "normal" | "soft";
      promptChars: number;
      observationChars: number;
      promptTokens: number;
      observationTokens: number;
      candidateSkillCount: number;
    }> = [];
    const results: unknown[] = [];

    const ctx: ToolContext = {
      sessionId,
      workspaceRoot: this.workspaceRoot,
      requestApproval: async (payload) => this.approver.requestApproval(payload),
      emitEvent: (event) => this.eventBus.emit(event)
    };

    for (let turn = 1; turn <= maxTurns; turn++) {
      const budgetBeforeTurn = this.summarizePlanningBudget(planningTrace);
      const budgetMode: "normal" | "soft" =
        maxTotalPlanningTokens > 0 &&
        budgetBeforeTurn.totalPlanningTokens >=
          Math.floor(maxTotalPlanningTokens * softBudgetRatio)
          ? "soft"
          : "normal";

      if (
        maxTotalPlanningTokens > 0 &&
        budgetBeforeTurn.totalPlanningTokens >= maxTotalPlanningTokens
      ) {
        const stepId = `turn_${turn}_step_budget_stop`;
        allPlanSteps.push({
          id: stepId,
          kind: "answer",
          content: "Token budget reached. Stopping to avoid extra planning cost."
        });
        results.push({
          stepId,
          ok: true,
          data: "Token budget reached. Stopping to avoid extra planning cost."
        });

        return {
          sessionId,
          candidateTools: candidateTools.map((t) => t.name),
          plan: { steps: allPlanSteps },
          turns: turn - 1,
          planningBudget: this.summarizePlanningBudget(planningTrace),
          planningTrace,
          results
        };
      }

      const plan = await this.planner.createPlan({
        originalInput: userInput,
        observations,
        turn,
        budgetMode
      });

      if (plan.meta) {
        planningTrace.push({
          turn,
          mode: plan.meta.mode,
          budgetMode,
          promptChars: plan.meta.promptChars,
          observationChars: plan.meta.observationChars,
          promptTokens: plan.meta.promptTokens,
          observationTokens: plan.meta.observationTokens,
          candidateSkillCount: plan.meta.candidateSkillCount
        });
      }

      const budgetAfterPlanning = this.summarizePlanningBudget(planningTrace);
      if (
        maxTotalPlanningTokens > 0 &&
        budgetAfterPlanning.totalPlanningTokens >= maxTotalPlanningTokens
      ) {
        const stepId = `turn_${turn}_step_budget_stop`;
        allPlanSteps.push({
          id: stepId,
          kind: "answer",
          content: "Token budget reached. Stopping to avoid extra planning cost."
        });
        results.push({
          stepId,
          ok: true,
          data: "Token budget reached. Stopping to avoid extra planning cost."
        });

        return {
          sessionId,
          candidateTools: candidateTools.map((t) => t.name),
          plan: { steps: allPlanSteps },
          turns: turn,
          planningBudget: budgetAfterPlanning,
          planningTrace,
          results
        };
      }

      for (const step of plan.steps) {
        const stepId = `turn_${turn}_${step.id}`;
        allPlanSteps.push({ ...step, id: stepId });

        if (step.kind === "tool_call" && step.toolName) {
          if (!candidateTools.find((t) => t.name === step.toolName)) {
            results.push({
              stepId,
              ok: false,
              error: `Tool not selected by router: ${step.toolName}`
            });
            observations.push({
              toolName: step.toolName,
              ok: false,
              summary: `router_rejected:${step.toolName}`
            });
            continue;
          }

          const result = await this.executor.execute(
            step.toolName,
            step.input ?? {},
            ctx
          );

          results.push({
            stepId,
            ...result
          });

          observations.push({
            toolName: step.toolName,
            ok: result.ok,
            summary: this.compactResult(result)
          });
          continue;
        }

        results.push({
          stepId,
          ok: true,
          data: step.content
        });

        return {
          sessionId,
          candidateTools: candidateTools.map((t) => t.name),
          plan: { steps: allPlanSteps },
          turns: turn,
          planningBudget: this.summarizePlanningBudget(planningTrace),
          planningTrace,
          results
        };
      }
    }

    return {
      sessionId,
      candidateTools: candidateTools.map((t) => t.name),
      plan: { steps: allPlanSteps },
      turns: maxTurns,
      planningBudget: this.summarizePlanningBudget(planningTrace),
      planningTrace,
      results
    };
  }

  private compactResult(result: {
    ok: boolean;
    data?: unknown;
    error?: string;
  }): string {
    const maxChars = this.planner.getMaxObservationChars();

    if (!result.ok) {
      return (result.error || "tool_failed").slice(0, maxChars);
    }

    const text = JSON.stringify(result.data ?? {});
    return text.slice(0, maxChars);
  }

  private summarizePlanningBudget(
    trace: Array<{
      turn: number;
      mode: "model" | "rules";
      budgetMode: "normal" | "soft";
      promptChars: number;
      observationChars: number;
      promptTokens: number;
      observationTokens: number;
      candidateSkillCount: number;
    }>
  ) {
    const totalPromptTokens = trace.reduce(
      (sum, item) => sum + item.promptTokens,
      0
    );
    const totalObservationTokens = trace.reduce(
      (sum, item) => sum + item.observationTokens,
      0
    );

    return {
      totalPromptTokens,
      totalObservationTokens,
      totalPlanningTokens: totalPromptTokens + totalObservationTokens,
      totalTurns: trace.length
    };
  }
}