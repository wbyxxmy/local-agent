import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createApp } from "../app.js";
import { LocalModelClient } from "../llm/local-model.js";
import type { ToolEvent } from "../types/tool.js";
import { WebApprover } from "../approval/web-approver.js";

interface RunRequestBody {
  input?: unknown;
}

interface ChatRequestBody {
  message?: unknown;
  history?: unknown;
}

const webApprover = new WebApprover();
const app = createApp({ approver: webApprover });
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pagePath = path.resolve(__dirname, "./index.html");
const port = Number(process.env.PORT || 4173);
const chatModel = app.config.planner.localModelEnabled
  ? new LocalModelClient({
      baseUrl: app.config.planner.localModelBaseUrl,
      model: app.config.planner.localModelName,
      timeoutMs: app.config.planner.localModelTimeoutMs
    })
  : undefined;

const server = createServer(async (req, res) => {
  const { method = "GET", url = "/" } = req;
  const parsedUrl = new URL(url, `http://127.0.0.1:${port}`);
  const pathname = parsedUrl.pathname;

  if (method === "GET" && pathname === "/") {
    const html = await fs.readFile(pagePath, "utf8");
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8"
    });
    res.end(html);
    return;
  }

  if (method === "POST" && pathname === "/api/run") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const rawBody = Buffer.concat(chunks).toString("utf8");
      const body = (JSON.parse(rawBody || "{}") as RunRequestBody) ?? {};
      const input = typeof body.input === "string" ? body.input.trim() : "";

      if (!input) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "`input` is required" }));
        return;
      }

      const events: ToolEvent[] = [];
      const listener = (event: ToolEvent) => {
        events.push(event);
      };

      app.eventBus.on("*", listener);
      try {
        const result = await app.agent.run(input);

        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            ok: true,
            input,
            events,
            result
          })
        );
      } finally {
        app.eventBus.off("*", listener);
      }
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
    return;
  }

  if (method === "GET" && pathname === "/api/approvals") {
    const sessionId = parsedUrl.searchParams.get("sessionId") || undefined;
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: true,
        pending: webApprover.listPending(sessionId)
      })
    );
    return;
  }

  if (method === "POST" && pathname.startsWith("/api/approvals/")) {
    try {
      const approvalId = decodeURIComponent(pathname.slice("/api/approvals/".length));
      if (!approvalId) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "approval id is required" }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const rawBody = Buffer.concat(chunks).toString("utf8");
      const body = (JSON.parse(rawBody || "{}") as { approved?: unknown }) ?? {};
      const approved = body.approved === true;
      const resolved = webApprover.resolveApproval(approvalId, approved);
      if (!resolved) {
        res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "approval not found" }));
        return;
      }

      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, approved }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
    return;
  }

  if (method === "POST" && pathname === "/api/chat") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const rawBody = Buffer.concat(chunks).toString("utf8");
      const body = (JSON.parse(rawBody || "{}") as ChatRequestBody) ?? {};
      const message = typeof body.message === "string" ? body.message.trim() : "";
      const history = Array.isArray(body.history) ? body.history : [];

      if (!message) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "`message` is required" }));
        return;
      }

      const events: ToolEvent[] = [];
      const listener = (event: ToolEvent) => {
        events.push(event);
      };

      app.eventBus.on("*", listener);
      let result: unknown;
      let sessionId = "";
      try {
        result = await app.agent.run(message);
        sessionId =
          result && typeof result === "object" && typeof (result as { sessionId?: unknown }).sessionId === "string"
            ? ((result as { sessionId: string }).sessionId)
            : "";
      } finally {
        app.eventBus.off("*", listener);
      }

      const unsupported = isUnsupportedResult(result);
      const hasToolActivity = events.some((e) =>
        e.type.startsWith("tool.execution.")
      );

      if (!unsupported || hasToolActivity) {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            ok: true,
            mode: "tool",
            message: buildToolMessage(result),
            sessionId,
            events,
            result
          })
        );
        return;
      }

      if (chatModel) {
        const chatReply = await generateChatReply(chatModel, message, history);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            ok: true,
            mode: "chat",
            message: chatReply,
            sessionId,
            events,
            result
          })
        );
        return;
      }

      const simpleReply = generateSimpleChatReply(message);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: true,
          mode: "fallback",
          message: simpleReply,
          sessionId,
          events,
          result
        })
      );
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
    return;
  }

  res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, error: "Not found" }));
});

server.listen(port, () => {
  console.log(`Web UI: http://localhost:${port}`);
});

function isUnsupportedResult(result: unknown): boolean {
  if (!result || typeof result !== "object") return true;
  const rows = (result as { results?: unknown[] }).results;
  if (!Array.isArray(rows) || rows.length === 0) return true;

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const data = (row as { data?: unknown }).data;
    if (
      typeof data === "string" &&
      data.toLowerCase().includes("unsupported command")
    ) {
      return true;
    }
  }

  return false;
}

function buildToolMessage(result: unknown): string {
  if (!result || typeof result !== "object") {
    return "执行完成。";
  }

  const rows = (result as { results?: unknown[] }).results;
  if (!Array.isArray(rows) || rows.length === 0) {
    return "执行完成。";
  }

  const parts: string[] = [];
  parts.push("我已完成这次操作。关键结果如下：");

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const ok = (row as { ok?: boolean }).ok;
    const data = (row as { data?: unknown }).data;
    const error = (row as { error?: unknown }).error;

    if (ok === false) {
      parts.push(`步骤失败：${typeof error === "string" ? error : "unknown"}`);
      continue;
    }

    if (typeof data === "string") {
      parts.push(data);
      continue;
    }

    if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;

      if (Array.isArray(obj.files)) {
        parts.push(`- 已列出 ${obj.files.length} 个文件。`);
        continue;
      }

      if (Array.isArray(obj.matches)) {
        parts.push(`- 检索到 ${obj.matches.length} 条匹配。`);
        continue;
      }

      if (typeof obj.path === "string" && typeof obj.content === "string") {
        const preview = obj.content.slice(0, 600);
        parts.push(`- 已读取 ${obj.path}。`);
        parts.push(`内容预览：\n${preview}`);
        continue;
      }

      if (typeof obj.path === "string" && typeof obj.bytesWritten === "number") {
        parts.push(`- 已写入 ${obj.path}，共 ${obj.bytesWritten} 字节。`);
        continue;
      }

      if (typeof obj.exitCode === "number") {
        const out = String(obj.stdout || obj.stderr || "").slice(0, 220);
        parts.push(`- 命令执行结束，退出码 ${obj.exitCode}。`);
        if (out) parts.push(`输出片段：${out}`);
        continue;
      }
    }
  }

  return parts.join("\n\n") || "我已执行完成。";
}

async function generateChatReply(
  model: LocalModelClient,
  message: string,
  history: unknown[]
) {
  const compactHistory = history
    .slice(-8)
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const role = (item as { role?: unknown }).role;
      const content = (item as { content?: unknown }).content;
      if (typeof role !== "string" || typeof content !== "string") return "";
      return `${role}: ${content.slice(0, 240)}`;
    })
    .filter(Boolean)
    .join("\n");

  const prompt = [
    "你是一个本地开发助手，回答简洁、实用。",
    "如果用户是闲聊，就自然回答。",
    "如果用户在问如何使用本地 agent，可给出具体命令。",
    "不要输出 JSON。",
    `history:\n${compactHistory}`,
    `user: ${message}`
  ].join("\n\n");

  return model.generateText(prompt);
}

function generateSimpleChatReply(message: string) {
  const text = message.trim().toLowerCase();

  if (/(你好|hello|hi|在吗|早上好|晚上好)/i.test(message)) {
    return "你好，我在。你可以直接说需求，我会先自动识别是否要调用技能，再补充文字解释。";
  }

  if (/(你是谁|你能做什么|help|帮助)/i.test(message)) {
    return [
      "我可以两种方式工作：",
      "1. 自动识别并调用本地技能（读文件、列文件、搜索、git 状态、运行命令等）",
      "2. 直接聊天回答问题",
      "你可以先试：list files、read README.md、搜索 PlannerConfig。"
    ].join("\n");
  }

  return [
    "我已收到你的消息。",
    "当前没有命中可执行技能时，我会先给你文字回复。",
    "如果你希望更自然的长对话，可以开启本地模型：LOCAL_MODEL_ENABLED=true。"
  ].join("\n");
}
