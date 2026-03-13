import { nanoid } from "nanoid";
import { SessionMemory } from "../memory/session-memory.js";
import { Planner } from "./planner.js";
import { ToolRouter } from "./router.js";
import { ToolExecutor } from "./executor.js";
import type { ToolContext } from "../types/tool.js";
import type { ToolRegistry } from "./registry.js";
import type { PlanStep, PlannerObservation } from "./planner.js";
import { EventBus } from "./event-bus.js";
import type { Approver } from "../approval/types.js";

export class LocalAgent {
  private readonly executor: ToolExecutor;
  private readonly router = new ToolRouter();
  private readonly memories = new Map<string, SessionMemory>();
  private readonly memoryTimestamps = new Map<string, number>();
  private static readonly SESSION_TTL_MS = 30 * 60 * 1000;

  private getMemory(sessionId: string) {
    this.evictExpiredSessions();
    let memory = this.memories.get(sessionId);
    if (!memory) {
      memory = new SessionMemory();
      this.memories.set(sessionId, memory);
    }
    this.memoryTimestamps.set(sessionId, Date.now());
    return memory;
  }

  constructor(
    private readonly registry: ToolRegistry,
    private readonly workspaceRoot: string,
    private readonly eventBus: EventBus,
    private readonly planner: Planner,
    private readonly approver: Approver
  ) {
    this.executor = new ToolExecutor(registry);
  }

  async run(userInput: string, options: { sessionId?: string } = {}) {
    const sessionId = options.sessionId?.trim() || nanoid();
    const memory = this.getMemory(sessionId);

    memory.add({
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
      requestApproval: async (payload) =>
        this.approver.requestApproval({ ...payload, sessionId }),
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

        memory.add({
          role: "assistant",
          content: "Token budget reached. Stopping to avoid extra planning cost.",
          timestamp: Date.now()
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
        recentMessages: memory.getRecent(12),
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

        memory.add({
          role: "assistant",
          content: "Token budget reached. Stopping to avoid extra planning cost.",
          timestamp: Date.now()
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
            memory.add({
              role: "tool",
              content: `router_rejected:${step.toolName}`,
              timestamp: Date.now()
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

          const summary = this.compactResult(result);

          observations.push({
            toolName: step.toolName,
            ok: result.ok,
            summary
          });
          memory.add({
            role: "tool",
            content: `${step.toolName}: ${summary}`,
            timestamp: Date.now()
          });
          continue;
        }

        results.push({
          stepId,
          ok: true,
          data: step.content
        });

        memory.add({
          role: "assistant",
          content: step.content,
          timestamp: Date.now()
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

  private summarizeToolStep(
    toolName: string,
    result: { ok: boolean; data?: unknown; error?: string }
  ) {
    if (!result.ok) {
      return `工具 ${toolName} 执行失败：${result.error || "unknown"}`;
    }

    const data = result.data;
    if (!data || typeof data !== "object") {
      return `工具 ${toolName} 执行成功。`;
    }

    const row = data as Record<string, unknown>;
    if (Array.isArray(row.files)) {
      return `工具 ${toolName} 执行成功，共返回 ${row.files.length} 个文件。`;
    }
    if (Array.isArray(row.matches)) {
      return `工具 ${toolName} 执行成功，共命中 ${row.matches.length} 条结果。`;
    }
    if (typeof row.path === "string" && typeof row.content === "string") {
      return `工具 ${toolName} 执行成功，已读取 ${row.path}。`;
    }
    if (typeof row.path === "string" && typeof row.bytesWritten === "number") {
      return `工具 ${toolName} 执行成功，已写入 ${row.path}。`;
    }
    if (typeof row.exitCode === "number") {
      return `工具 ${toolName} 执行完成，退出码 ${row.exitCode}。`;
    }

    return `工具 ${toolName} 执行成功。`;
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
  private evictExpiredSessions() {
    const now = Date.now();
    for (const [id, ts] of this.memoryTimestamps) {
      if (now - ts > LocalAgent.SESSION_TTL_MS) {
        this.memories.delete(id);
        this.memoryTimestamps.delete(id);
      }
    }
  }
}