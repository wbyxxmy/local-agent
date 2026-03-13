import type { SessionMessage } from "../memory/session-memory.js";
import { LocalModelClient } from "../llm/local-model.js";
import { estimateTokenCount } from "../llm/token-estimator.js";
import type { ToolEvent } from "../types/tool.js";
import { buildSkillInput } from "./skill-input.js";
import { loadSkillCatalog, shortlistSkills, type SkillDefinition } from "./skills.js";

export interface PlanStep {
  id: string;
  kind: "tool_call" | "answer";
  content: string;
  toolName?: string;
  input?: Record<string, unknown>;
}

export interface Plan {
  steps: PlanStep[];
  meta?: {
    mode: "model" | "rules";
    promptChars: number;
    observationChars: number;
    promptTokens: number;
    observationTokens: number;
    candidateSkillCount: number;
  };
}

export interface PlannerConfig {
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
}

export interface PlannerObservation {
  toolName: string;
  ok: boolean;
  summary: string;
}

export interface PlannerRequest {
  originalInput: string;
  observations: PlannerObservation[];
  recentMessages?: SessionMessage[];
  turn: number;
  budgetMode?: "normal" | "soft";
}

export class Planner {
  private readonly modelClient?: LocalModelClient;
  private skills: SkillDefinition[];
  private lastSkillRefreshAt = 0;

  constructor(
    private readonly config: PlannerConfig,
    workspaceRoot: string,
    private readonly allowedToolNames?: Set<string>,
    private readonly emitEvent?: (event: ToolEvent) => void
  ) {
    if (this.config.localModelEnabled) {
      this.modelClient = new LocalModelClient({
        baseUrl: this.config.localModelBaseUrl,
        model: this.config.localModelName,
        timeoutMs: this.config.localModelTimeoutMs
      });
    }

    this.skills = loadSkillCatalog(
      workspaceRoot,
      this.config.skillCatalogDir,
      this.allowedToolNames
    );
    this.lastSkillRefreshAt = Date.now();
    this.workspaceRoot = workspaceRoot;
  }

  private readonly workspaceRoot: string;

  supportsMultiTurn() {
    return Boolean(this.modelClient);
  }

  getMaxPlanningTurns() {
    return this.config.maxPlanningTurns;
  }

  getMaxObservationChars() {
    return this.config.maxObservationChars;
  }

  getMaxTotalPlanningTokens() {
    return this.config.maxTotalPlanningTokens;
  }

  getSoftBudgetRatio() {
    return this.config.softBudgetRatio;
  }

  async createPlan(request: PlannerRequest): Promise<Plan> {
    this.refreshSkillsIfNeeded();

    // 第一轮优先走规则，命中直接返回，避免不必要的 LLM 调用
    if (request.turn === 1 || !this.modelClient) {
      const fromRules = this.createPlanByRules(
        request.originalInput,
        request.recentMessages ?? []
      );
      if (fromRules.steps[0]?.kind === "tool_call") {
        return {
          ...fromRules,
          meta: {
            mode: "rules",
            promptChars: 0,
            observationChars: this.sumObservationChars(request.observations),
            promptTokens: 0,
            observationTokens: this.sumObservationTokens(request.observations),
            candidateSkillCount: 0
          }
        };
      }
    }

    const fromModel = await this.createPlanFromModel(request);
    if (fromModel) return fromModel;

    if (request.observations.length > 0) {
      return {
        steps: [
          {
            id: "step_1",
            kind: "answer",
            content: "Done with available rule planner path."
          }
        ],
        meta: {
          mode: "rules",
          promptChars: 0,
          observationChars: this.sumObservationChars(request.observations),
          promptTokens: 0,
          observationTokens: this.sumObservationTokens(request.observations),
          candidateSkillCount: 0
        }
      };
    }

    const plan = this.createPlanByRules(
      request.originalInput,
      request.recentMessages ?? []
    );
    return {
      ...plan,
      meta: {
        mode: "rules",
        promptChars: 0,
        observationChars: this.sumObservationChars(request.observations),
        promptTokens: 0,
        observationTokens: this.sumObservationTokens(request.observations),
        candidateSkillCount: 0
      }
    };
  }

  private refreshSkillsIfNeeded() {
    if (!this.config.skillCatalogAutoReload) return;

    const now = Date.now();
    if (now - this.lastSkillRefreshAt < this.config.skillCatalogRefreshMs) {
      return;
    }

    const prevSkills = this.skills;

    try {
      this.skills = loadSkillCatalog(
        this.workspaceRoot,
        this.config.skillCatalogDir,
        this.allowedToolNames
      );
      this.emitSkillCatalogReloadEvent(prevSkills, this.skills);
    } catch {
      // Keep existing in-memory catalog on reload errors.
    } finally {
      this.lastSkillRefreshAt = now;
    }
  }

  private emitSkillCatalogReloadEvent(
    previousSkills: SkillDefinition[],
    nextSkills: SkillDefinition[]
  ) {
    if (!this.emitEvent) return;

    const prevNames = new Set(previousSkills.map((item) => item.name));
    const nextNames = new Set(nextSkills.map((item) => item.name));

    const added = [...nextNames].filter((name) => !prevNames.has(name));
    const removed = [...prevNames].filter((name) => !nextNames.has(name));
    const changed = [...nextNames]
      .filter((name) => prevNames.has(name))
      .filter((name) => {
        const prev = previousSkills.find((item) => item.name === name);
        const next = nextSkills.find((item) => item.name === name);
        if (!prev || !next) return false;
        return this.skillSignature(prev) !== this.skillSignature(next);
      });

    this.emitEvent({
      type: "skills.catalog.reloaded",
      timestamp: Date.now(),
      payload: {
        previousCount: previousSkills.length,
        nextCount: nextSkills.length,
        added,
        removed,
        changed
      }
    });
  }

  private skillSignature(skill: SkillDefinition) {
    return JSON.stringify({
      toolName: skill.toolName,
      keywords: [...skill.keywords].sort(),
      priority: skill.priority ?? 0,
      enabled: skill.enabled ?? true,
      inputTemplate: skill.inputTemplate ?? null
    });
  }

  private async createPlanFromModel(request: PlannerRequest): Promise<Plan | null> {
    if (!this.modelClient) return null;

    try {
      const budgetMode = request.budgetMode ?? "normal";
      const observationCharsLimit =
        budgetMode === "soft"
          ? Math.max(60, Math.floor(this.config.maxObservationChars / 2))
          : this.config.maxObservationChars;
      const observationWindow = budgetMode === "soft" ? 1 : 2;
      const skillLimit =
        budgetMode === "soft"
          ? Math.max(1, Math.floor(this.config.maxSkillCandidates / 2))
          : this.config.maxSkillCandidates;

      const clipped = request.originalInput.slice(
        0,
        this.config.maxPlannerInputChars
      );
      const recentMessagesText = JSON.stringify(
        (request.recentMessages ?? [])
          .slice(-6)
          .map((item) => ({
            role: item.role,
            content: item.content.slice(0, 100)
          }))
      );
      const observationText = JSON.stringify(
        request.observations
          .slice(-observationWindow)
          .map((item) => ({
            tool: item.toolName,
            ok: item.ok,
            summary: item.summary.slice(0, observationCharsLimit)
          }))
      );
      const candidateSkills = shortlistSkills(
        clipped,
        skillLimit,
        this.skills
      );

      const prompt = [
        "You are a planner that outputs strict JSON.",
        "For each turn, decide either tool_call or answer.",
        "If enough information is gathered, choose answer with concise content.",
        "If a tool is needed, choose exactly one skill from candidate_skills.",
        "When kind=tool_call, include minimal input object if inferable from user text.",
        "Return only JSON: {\"kind\":\"tool_call\"|\"answer\",\"skill\":string,\"content\":string,\"input\":object}",
        `budget_mode=${budgetMode}`,
        `turn=${request.turn}`,
        `max_turns=${this.config.maxPlanningTurns}`,
        `candidate_skills=${JSON.stringify(
          candidateSkills.map((s) => ({ name: s.name, toolName: s.toolName }))
        )}`,
        `user_input=${JSON.stringify(clipped)}`,
        `recent_observations=${observationText}`
      ].join("\n");
      const promptTokens = estimateTokenCount(prompt);
      const observationTokens = estimateTokenCount(observationText);

      const raw = await this.modelClient.generateJson(prompt);
      const parsed = this.parseModelDecision(raw.text);

      if (!parsed) {
        return null;
      }

      if (parsed.kind === "answer") {
        return {
          steps: [
            {
              id: "step_1",
              kind: "answer",
              content: parsed.content || "Done."
            }
          ],
          meta: {
            mode: "model",
            promptChars: prompt.length,
            observationChars: observationText.length,
            promptTokens,
            observationTokens,
            candidateSkillCount: candidateSkills.length
          }
        };
      }

      if (parsed.skill === "none") return null;

      const selected = this.skills.find((s) => s.name === parsed.skill);
      if (!selected) return null;

      return {
        steps: [
          {
            id: "step_1",
            kind: "tool_call",
            content: `Execute skill: ${selected.name}`,
            toolName: selected.toolName,
            input: {
              ...buildSkillInput(selected, request.originalInput),
              ...(parsed.input ?? {})
            }
          }
        ],
        meta: {
          mode: "model",
          promptChars: prompt.length,
          observationChars: observationText.length,
          promptTokens,
          observationTokens,
          candidateSkillCount: candidateSkills.length
        }
      };
    } catch {
      return null;
    }
  }

  private parseModelDecision(
    text: string
  ):
    | {
        kind: "tool_call" | "answer";
        skill: string;
        input?: Record<string, unknown>;
        content?: string;
      }
    | null {
    try {
      const json = JSON.parse(text) as {
        kind?: unknown;
        skill?: unknown;
        input?: unknown;
        content?: unknown;
      };

      if (json.kind !== "tool_call" && json.kind !== "answer") return null;
      if (typeof json.skill !== "string") return null;
      if (json.input !== undefined && typeof json.input !== "object") {
        return null;
      }
      if (json.content !== undefined && typeof json.content !== "string") {
        return null;
      }

      return {
        kind: json.kind,
        skill: json.skill,
        input: (json.input as Record<string, unknown>) ?? {},
        content: json.content
      };
    } catch {
      return null;
    }
  }

  private createPlanByRules(
    userInput: string,
    recentMessages: SessionMessage[] = [],
    allowHistoryFallback = true
  ): Plan {
    const text = userInput.trim();

    const shouldOpenApp = this.isLikelyOpenAppIntent(text);
    if (shouldOpenApp) {
      const selected = this.skills.find((item) => item.name === "open_app");
      return {
        steps: [
          {
            id: "step_1",
            kind: "tool_call",
            content: "Open local app",
            toolName: "open_app",
            input: buildSkillInput(
              selected ?? {
                name: "open_app",
                description: "Open local app",
                toolName: "open_app",
                keywords: []
              },
              text
            )
          }
        ]
      };
    }

    const writeMatch = text.match(/^write\s+(.+?)\s+<<<\s*([\s\S]+)$/i);
    if (writeMatch || /(?:写入|保存).*(?:内容|为)|把\s+.+\s+写入\s+.+|(?:打开|新建).*(?:记事本|笔记).*(?:写入|记录)/.test(text)) {
      const selected = this.skills.find((item) => item.name === "write_file");
      return {
        steps: [
          {
            id: "step_1",
            kind: "tool_call",
            content: "Write file content",
            toolName: "write_file",
            input: buildSkillInput(
              selected ?? {
                name: "write_file",
                description: "Write file",
                toolName: "write_file",
                keywords: []
              },
              text
            )
          }
        ]
      };
    }

    if (
      /^list files$/i.test(text) ||
      text.includes("列出文件") ||
      /^(?:列出|查看).*(?:文件|目录)/.test(text)
    ) {
      const selected =
        this.skills.find((item) => item.name === "list_files") ?? this.skills[0];
      return {
        steps: [
          {
            id: "step_1",
            kind: "tool_call",
            content: "List files in workspace",
            toolName: "list_files",
            input: buildSkillInput(selected, text)
          }
        ]
      };
    }

    const readMatch = text.match(/^read\s+(.+)$/i);
    const shouldReadByChineseVerb =
      /^(?:读取|打开|查看)\s+/.test(text) && this.isLikelyFileReference(text);
    if (readMatch || shouldReadByChineseVerb) {
      const selected = this.skills.find((item) => item.name === "read_file");
      return {
        steps: [
          {
            id: "step_1",
            kind: "tool_call",
            content: "Read a file",
            toolName: "read_file",
            input: buildSkillInput(
              selected ?? {
                name: "read_file",
                description: "Read one text file",
                toolName: "read_file",
                keywords: []
              },
              text
            )
          }
        ]
      };
    }

    const grepMatch = text.match(/^grep\s+(.+)$/i);
    if (grepMatch || /(?:search|find|搜索|查找)/i.test(text)) {
      const selected = this.skills.find((item) => item.name === "grep_code");
      return {
        steps: [
          {
            id: "step_1",
            kind: "tool_call",
            content: "Search code text",
            toolName: "grep_code",
            input: buildSkillInput(
              selected ?? {
                name: "grep_code",
                description: "Search code",
                toolName: "grep_code",
                keywords: []
              },
              text
            )
          }
        ]
      };
    }

    const cmdMatch = text.match(/^run\s+(.+)$/i);
    if (cmdMatch || /^(?:执行|运行)\s+/.test(text)) {
      const selected = this.skills.find((item) => item.name === "run_command");
      return {
        steps: [
          {
            id: "step_1",
            kind: "tool_call",
            content: "Run command",
            toolName: "run_command",
            input: buildSkillInput(
              selected ?? {
                name: "run_command",
                description: "Run command",
                toolName: "run_command",
                keywords: []
              },
              text
            )
          }
        ]
      };
    }

    if (/^git status$/i.test(text) || /^git\s*状态$/.test(text) || text === "查看git状态") {
      return {
        steps: [
          {
            id: "step_1",
            kind: "tool_call",
            content: "Get git status",
            toolName: "git_status",
            input: {}
          }
        ]
      };
    }

    if (allowHistoryFallback) {
      const followUp = this.reuseRecentCommand(text, recentMessages);
      if (followUp) {
        return this.createPlanByRules(followUp, [], false);
      }
    }

    const dynamicMatch = shortlistSkills(text, 1, this.skills)[0];
    if (dynamicMatch) {
      const hasKeywordHit = dynamicMatch.keywords.some((keyword) =>
        text.toLowerCase().includes(keyword.toLowerCase())
      );

      if (hasKeywordHit) {
        return {
          steps: [
            {
              id: "step_1",
              kind: "tool_call",
              content: `Execute dynamic skill: ${dynamicMatch.name}`,
              toolName: dynamicMatch.toolName,
              input: buildSkillInput(dynamicMatch, text)
            }
          ]
        };
      }
    }

    return {
      steps: [
        {
          id: "step_1",
          kind: "answer",
          content:
            "Unsupported command. Try: `list files`, `read <path>`, `write <path> <<< <content>`, `grep <text>`, `run <command>`, `git status`."
        }
      ]
    };
  }

  private getInputHint(toolName: string) {
    switch (toolName) {
      case "list_files":
        return "{ pattern?: string, limit?: number }";
      case "read_file":
        return "{ path: string }";
      case "write_file":
        return "{ path: string, content: string, createDirectories?: boolean }";
      case "grep_code":
        return "{ query: string, path?: string }";
      case "run_command":
        return "{ command: string }";
      case "open_app":
        return "{ app: string, contact?: string, message?: string, action?: string }";
      case "git_status":
        return "{}";
      default:
        return "{}";
    }
  }

  private sumObservationChars(observations: PlannerObservation[]) {
    return observations.reduce((sum, item) => sum + item.summary.length, 0);
  }

  private sumObservationTokens(observations: PlannerObservation[]) {
    return observations.reduce(
      (sum, item) => sum + estimateTokenCount(item.summary),
      0
    );
  }

  private reuseRecentCommand(
    userInput: string,
    recentMessages: SessionMessage[]
  ) {
    if (!this.shouldReuseRecentCommand(userInput)) {
      return null;
    }

    const normalizedCurrent = userInput.trim();

    for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
      const item = recentMessages[index];
      if (item.role !== "user") continue;

      const candidate = item.content.trim();
      if (!candidate || candidate === normalizedCurrent) continue;
      if (!this.isActionableCommand(candidate)) continue;

      return candidate;
    }

    return null;
  }

  private shouldReuseRecentCommand(text: string) {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return false;
    if (this.isActionableCommand(normalized)) return false;
    if (this.hasSkillKeywordHit(normalized)) return false;
    if (normalized.length > 18) return false;

    const pureChatSignals = [
      "你好",
      "hello",
      "hi",
      "谢谢",
      "thanks",
      "help",
      "帮助",
      "你是谁",
      "在吗"
    ];
    if (pureChatSignals.some((token) => normalized.includes(token))) {
      return false;
    }

    return true;
  }

  private isActionableCommand(text: string) {
    return (
      this.isLikelyOpenAppIntent(text) ||
      /^write\s+.+\s+<<<\s*[\s\S]+$/i.test(text) ||
      /(?:写入|保存).*(?:内容|为)|把\s+.+\s+写入\s+.+|(?:打开|新建).*(?:记事本|笔记).*(?:写入|记录)/.test(text) ||
      /^list files$/i.test(text) ||
      text.includes("列出文件") ||
      /^(?:列出|查看).*(?:文件|目录)/.test(text) ||
      /^read\s+.+$/i.test(text) ||
      /^(?:读取|打开|查看)\s+/.test(text) ||
      /^grep\s+.+$/i.test(text) ||
      /(?:search|find|搜索|查找)/i.test(text) ||
      /^run\s+.+$/i.test(text) ||
      /^(?:执行|运行)\s+/.test(text) ||
      /^git status$/i.test(text) ||
      /^git\s*状态$/.test(text) ||
      text === "查看git状态"
    );
  }

  private isLikelyOpenAppIntent(text: string) {
    const normalized = text.trim();
    if (!normalized) return false;

    const openVerb = /^(?:open|launch|start|打开|启动)\s+/i.test(normalized);
    if (!openVerb) return false;
    if (this.isLikelyFileReference(normalized)) return false;

    return true;
  }

  private isLikelyFileReference(text: string) {
    const normalized = text.trim();

    if (/\b(?:readme|package\.json|tsconfig\.json)\b/i.test(normalized)) {
      return true;
    }
    if (/\.[a-z0-9]{1,6}(?:\s|$)/i.test(normalized)) {
      return true;
    }
    if (/[\\/]/.test(normalized)) {
      return true;
    }
    if (/(?:文件|目录|路径|path)/i.test(normalized)) {
      return true;
    }

    return false;
  }

  private hasSkillKeywordHit(text: string) {
    return this.skills.some((skill) =>
      skill.keywords.some((keyword) =>
        text.includes(keyword.toLowerCase())
      )
    );
  }
}