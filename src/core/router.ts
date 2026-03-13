import type { ToolDefinition } from "../types/tool.js";

export class ToolRouter {
  selectTools(userInput: string, tools: ToolDefinition<any, any>[]) {
    const text = userInput.toLowerCase();

    const scored = tools.map((tool) => {
      let score = 0;
      const codeSearchIntent =
        /(?:代码|源码|repo|repository|workspace|文件|grep|符号|定义|引用)/i.test(text) ||
        text.includes("plannerconfig");
      const webSearchIntent =
        /(?:网页|网站|上网|internet|web|新闻|热点|热搜|热门|trending|current events)/i.test(text) ||
        ((text.includes("搜索") || text.includes("查") || text.includes("search")) && !codeSearchIntent);

      if ((text.includes("read") || text.includes("读取")) && tool.name === "read_file") score += 3;
      if ((text.includes("write") || text.includes("写入")) && tool.name === "write_file") score += 3;
      if ((text.includes("find") || text.includes("grep") || codeSearchIntent) && tool.name === "grep_code") score += 3;
      if (webSearchIntent && tool.name === "web_search") score += 4;
      if ((text.includes("list") || text.includes("列出")) && tool.name === "list_files") score += 3;
      if (text.includes("git") && tool.name.startsWith("git_")) score += 3;
      if ((text.includes("command") || text.includes("shell") || text.includes("执行") || text.includes("run ")) && tool.name === "run_command") score += 3;
      if ((/^\s*(open|launch|start|打开|启动)\b/.test(text) || text.startsWith("打开") || text.startsWith("启动")) && tool.name === "open_app") score += 4;

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