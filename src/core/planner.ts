export interface PlanStep {
  id: string;
  kind: "tool_call" | "answer";
  content: string;
  toolName?: string;
  input?: Record<string, unknown>;
}

export interface Plan {
  steps: PlanStep[];
}

export class Planner {
  createPlan(userInput: string): Plan {
    const text = userInput.trim();

    if (/^list files$/i.test(text) || text.includes("列出文件")) {
      return {
        steps: [
          {
            id: "step_1",
            kind: "tool_call",
            content: "List files in workspace",
            toolName: "list_files",
            input: { pattern: "**/*", limit: 100 }
          }
        ]
      };
    }

    const readMatch = text.match(/^read\s+(.+)$/i);
    if (readMatch) {
      return {
        steps: [
          {
            id: "step_1",
            kind: "tool_call",
            content: "Read a file",
            toolName: "read_file",
            input: { path: readMatch[1].trim() }
          }
        ]
      };
    }

    const writeMatch = text.match(/^write\s+(.+?)\s+<<<\s*([\s\S]+)$/i);
    if (writeMatch) {
      return {
        steps: [
          {
            id: "step_1",
            kind: "tool_call",
            content: "Write file content",
            toolName: "write_file",
            input: {
              path: writeMatch[1].trim(),
              content: writeMatch[2]
            }
          }
        ]
      };
    }

    const grepMatch = text.match(/^grep\s+(.+)$/i);
    if (grepMatch) {
      return {
        steps: [
          {
            id: "step_1",
            kind: "tool_call",
            content: "Search code text",
            toolName: "grep_code",
            input: { query: grepMatch[1].trim() }
          }
        ]
      };
    }

    const cmdMatch = text.match(/^run\s+(.+)$/i);
    if (cmdMatch) {
      return {
        steps: [
          {
            id: "step_1",
            kind: "tool_call",
            content: "Run command",
            toolName: "run_command",
            input: { command: cmdMatch[1].trim() }
          }
        ]
      };
    }

    if (/^git status$/i.test(text)) {
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
}