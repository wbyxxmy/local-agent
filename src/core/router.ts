import type { ToolDefinition } from "../types/tool.js";

export class ToolRouter {
  selectTools(userInput: string, tools: ToolDefinition<any, any>[]) {
    const text = userInput.toLowerCase();

    const scored = tools.map((tool) => {
      let score = 0;

      if ((text.includes("read") || text.includes("读取")) && tool.name === "read_file") score += 3;
      if ((text.includes("write") || text.includes("写入")) && tool.name === "write_file") score += 3;
      if ((text.includes("find") || text.includes("search") || text.includes("搜索") || text.includes("grep")) && tool.name === "grep_code") score += 3;
      if ((text.includes("list") || text.includes("列出")) && tool.name === "list_files") score += 3;
      if (text.includes("git") && tool.name.startsWith("git_")) score += 3;
      if ((text.includes("command") || text.includes("shell") || text.includes("执行") || text.includes("run ")) && tool.name === "run_command") score += 3;

      if (score === 0 && ["read_file", "list_files", "grep_code"].includes(tool.name)) {
        score += 1;
      }

      return { tool, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((item) => item.tool);
  }
}