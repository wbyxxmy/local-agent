import type { SkillDefinition } from "./skills.js";

export function buildSkillInput(
  skill: SkillDefinition,
  userInput: string
): Record<string, unknown> {
  const text = userInput.trim();
  const normalized = text.replace(/\s+/g, " ").trim();
  const templateType =
    skill.inputTemplate?.type ?? inferTemplateTypeFromToolName(skill.toolName);
  const defaults = skill.inputTemplate?.defaults ?? {};

  switch (templateType) {
    case "list_pattern": {
      const match =
        text.match(/^list(?:\s+files?)?\s+(.+)$/i) ||
        text.match(/(?:列出|查看)\s+(.+?)(?:\s+文件)?$/);
      const pattern = match?.[1]?.trim();

      if (pattern && /[*?{}[\]]/.test(pattern)) {
        return { ...defaults, pattern };
      }

      return { pattern: "**/*", limit: 100, ...defaults };
    }

    case "read_path": {
      const match =
        text.match(/^read\s+(.+)$/i) ||
        text.match(/(?:读取|打开|查看)\s+(.+?)(?:\s+文件)?$/);
      const path = match?.[1] ? trimQuotes(match[1].trim()) : "";
      return path ? { ...defaults, path } : { ...defaults };
    }

    case "write_heredoc": {
      const noteMatch =
        normalized.match(
          /(?:打开|新建)(?:\s*)(?:记事本|笔记|note)(?:\s*)(?:并|后)?(?:\s*)(?:写入|记录|写下)\s+([\s\S]+)$/i
        ) ||
        normalized.match(/(?:写在|记在)(?:\s*)(?:记事本|笔记|note)(?:\s*)(?:里|中)?\s+([\s\S]+)$/i);
      if (noteMatch?.[1]) {
        return {
          ...defaults,
          path: "tmp/note.txt",
          content: noteMatch[1].trim()
        };
      }

      const match =
        text.match(/^write\s+(.+?)\s+<<<\s*([\s\S]+)$/i) ||
        text.match(/(?:写入|保存)\s+(.+?)\s*(?:内容|为)\s*[:：]?\s*([\s\S]+)$/) ||
        text.match(/(?:在|向)\s+(.+?)(?:\s+里|\s+中)?\s*(?:写入|保存)\s*[:：]?\s*([\s\S]+)$/);
      if (!match) {
        const cnAlt = text.match(/把\s+([\s\S]+?)\s+写入\s+(.+)$/);
        if (!cnAlt) return { ...defaults };

        return {
          ...defaults,
          path: trimQuotes(cnAlt[2].trim()),
          content: cnAlt[1].trim()
        };
      }

      return {
        ...defaults,
        path: trimQuotes(match[1].trim()),
        content: match[2]
      };
    }

    case "grep_query": {
      const match =
        text.match(/^grep\s+(.+)$/i) ||
        text.match(/(?:search|find|搜索|查找)\s+(.+)$/i) ||
        text.match(/(?:在代码中)?(?:搜索|查找)\s+(.+?)(?:\s+关键词)?$/);
      const query = match?.[1]?.trim();
      return query ? { ...defaults, query } : { ...defaults };
    }

    case "run_command": {
      const match =
        text.match(/^run\s+(.+)$/i) ||
        text.match(/(?:执行|运行)\s+(.+)$/);
      const command = match?.[1]?.trim();
      return command ? { ...defaults, command } : { ...defaults };
    }

    case "open_app": {
      const openMatch = normalized.match(
        /(?:(?:open|launch|start)\s+|(?:打开|启动)\s*)([^，,\s]+(?:\s+[^，,\s]+)?)/i
      );
      const app = openMatch?.[1] ? trimQuotes(openMatch[1].trim()) : "";

      const greetMatch =
        normalized.match(/给\s*([a-zA-Z0-9_\-\u4e00-\u9fa5]+)\s*(?:打个招呼|发个消息|发消息|问好)\s*(.*)$/i) ||
        normalized.match(/(?:向|给)\s*([a-zA-Z0-9_\-\u4e00-\u9fa5]+)\s*说\s*([\s\S]+)$/i);

      const contact = greetMatch?.[1]?.trim();
      const message = greetMatch?.[2]?.trim() || (greetMatch ? "你好" : undefined);

      if (!app) return { ...defaults };
      return {
        ...defaults,
        app,
        ...(contact ? { contact } : {}),
        ...(message ? { message } : {})
      };
    }

    case "web_search": {
      const hotIntent = /(?:热点|热搜|热门|trending|hot\s*topics?)/i.test(normalized);
      const queryMatch =
        normalized.match(/(?:搜索|查一下|查下|查查|查|search|web)\s+([\s\S]+)$/i) ||
        normalized.match(/(?:当前|今天|今日)?\s*(?:热点|热搜|热门)\s*(.*)$/i);
      const topic = inferWebTopic(normalized);
      const site = inferWebSite(normalized);
      const timeRange = inferWebTimeRange(normalized);

      const query = stripWebControlTokens(queryMatch?.[1] || "").trim();
      if (query) {
        return {
          ...defaults,
          query,
          ...(topic ? { topic } : {}),
          ...(site ? { site } : {}),
          ...(timeRange ? { timeRange } : {})
        };
      }

      if (hotIntent) {
        return {
          ...defaults,
          ...(topic ? { topic } : {}),
          ...(site ? { site } : {}),
          ...(timeRange ? { timeRange } : {}),
          query: topic ? undefined : "今日 热点 新闻"
        };
      }

      return {
        ...defaults,
        query: stripWebControlTokens(text),
        ...(topic ? { topic } : {}),
        ...(site ? { site } : {}),
        ...(timeRange ? { timeRange } : {})
      };
    }

    case "empty":
      return { ...defaults };

    default:
      return { ...defaults };
  }
}

function trimQuotes(value: string) {
  return value.replace(/^['"]|['"]$/g, "");
}

function inferTemplateTypeFromToolName(skillToolName: string):
  | "list_pattern"
  | "read_path"
  | "write_heredoc"
  | "grep_query"
  | "run_command"
  | "open_app"
  | "web_search"
  | "empty" {
  switch (skillToolName) {
    case "list_files":
      return "list_pattern";
    case "read_file":
      return "read_path";
    case "write_file":
      return "write_heredoc";
    case "grep_code":
      return "grep_query";
    case "run_command":
      return "run_command";
    case "open_app":
      return "open_app";
    case "web_search":
      return "web_search";
    default:
      return "empty";
  }
}

function inferWebTopic(text: string): "general" | "ai" | "tech" | "finance" | null {
  if (/(?:ai|人工智能|大模型|llm|机器学习)/i.test(text)) {
    return "ai";
  }
  if (/(?:科技|tech|数码|互联网|芯片|半导体)/i.test(text)) {
    return "tech";
  }
  if (/(?:财经|finance|经济|股市|市场|宏观)/i.test(text)) {
    return "finance";
  }
  if (/(?:热点|热搜|新闻|trending|hot)/i.test(text)) {
    return "general";
  }
  return null;
}

function inferWebSite(
  text: string
): "all" | "xinhua" | "caixin" | "36kr" | "cls" | "eastmoney" | null {
  if (/(?:新华社|新华网|xinhua)/i.test(text)) {
    return "xinhua";
  }
  if (/(?:财新|caixin)/i.test(text)) {
    return "caixin";
  }
  if (/(?:36kr|36氪)/i.test(text)) {
    return "36kr";
  }
  if (/(?:财联社|cls)/i.test(text)) {
    return "cls";
  }
  if (/(?:东方财富|eastmoney)/i.test(text)) {
    return "eastmoney";
  }
  if (/(?:全部来源|所有来源|all sources)/i.test(text)) {
    return "all";
  }
  return null;
}

function inferWebTimeRange(text: string): "any" | "24h" | "7d" | null {
  if (/(?:24h|24小时|一天内|最近一天|过去一天|today)/i.test(text)) {
    return "24h";
  }
  if (/(?:7d|7天|一周内|最近一周|过去一周|week)/i.test(text)) {
    return "7d";
  }
  if (/(?:不限时间|全部时间|任意时间|any time)/i.test(text)) {
    return "any";
  }
  return null;
}

function stripWebControlTokens(text: string) {
  return text
    .replace(/(?:查当前热点|当前热点|今日热点|热点)/gi, " ")
    .replace(/(?:综合新闻|综合|ai|人工智能|科技|财经)/gi, " ")
    .replace(/(?:全部来源|所有来源|新华网|新华社|财新|36kr|36氪|财联社|东方财富)/gi, " ")
    .replace(/(?:不限时间|24小时|7天|一天内|一周内|today|week)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
