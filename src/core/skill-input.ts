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
    default:
      return "empty";
  }
}
