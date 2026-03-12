import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { z } from "zod";

export interface SkillDefinition {
  name: string;
  description: string;
  toolName: string;
  keywords: string[];
  priority?: number;
  enabled?: boolean;
  inputTemplate?: {
    type:
      | "list_pattern"
      | "read_path"
      | "write_heredoc"
      | "grep_query"
      | "run_command"
      | "empty";
    defaults?: Record<string, unknown>;
  };
}

export interface SkillSelection {
  skill: string;
  input?: Record<string, unknown>;
}

export const builtinSkills: SkillDefinition[] = [
  {
    name: "list_files",
    description: "List files in workspace",
    toolName: "list_files",
    keywords: ["list", "files", "列出", "文件"],
    priority: 0,
    enabled: true,
    inputTemplate: {
      type: "list_pattern",
      defaults: { pattern: "**/*", limit: 100 }
    }
  },
  {
    name: "read_file",
    description: "Read one text file",
    toolName: "read_file",
    keywords: ["read", "cat", "打开", "读取"],
    priority: 0,
    enabled: true,
    inputTemplate: {
      type: "read_path"
    }
  },
  {
    name: "write_file",
    description: "Write text into file",
    toolName: "write_file",
    keywords: ["write", "save", "写入", "保存"],
    priority: 0,
    enabled: true,
    inputTemplate: {
      type: "write_heredoc"
    }
  },
  {
    name: "grep_code",
    description: "Search text in code",
    toolName: "grep_code",
    keywords: ["grep", "find", "search", "查找", "搜索"],
    priority: 0,
    enabled: true,
    inputTemplate: {
      type: "grep_query"
    }
  },
  {
    name: "git_status",
    description: "Show git status",
    toolName: "git_status",
    keywords: ["git", "status"],
    priority: 0,
    enabled: true,
    inputTemplate: {
      type: "empty"
    }
  },
  {
    name: "run_command",
    description: "Run a shell command",
    toolName: "run_command",
    keywords: ["run", "command", "shell", "执行", "命令"],
    priority: 0,
    enabled: true,
    inputTemplate: {
      type: "run_command"
    }
  }
];

const skillManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  toolName: z.string().min(1),
  keywords: z.array(z.string()).default([]),
  priority: z.number().int().min(-100).max(100).default(0),
  enabled: z.boolean().default(true),
  inputTemplate: z
    .object({
      type: z.enum([
        "list_pattern",
        "read_path",
        "write_heredoc",
        "grep_query",
        "run_command",
        "empty"
      ]),
      defaults: z.record(z.unknown()).optional()
    })
    .optional()
});

export function loadSkillCatalog(
  workspaceRoot: string,
  relativeDir: string,
  allowedToolNames?: Set<string>
): SkillDefinition[] {
  const catalog = new Map<string, SkillDefinition>();

  for (const skill of builtinSkills) {
    catalog.set(skill.name, skill);
  }

  const absoluteDir = path.resolve(workspaceRoot, relativeDir);
  if (!fs.existsSync(absoluteDir)) {
    return [...catalog.values()];
  }

  const files = fg.sync("**/*.json", {
    cwd: absoluteDir,
    onlyFiles: true,
    dot: false
  });

  for (const relFile of files) {
    const absFile = path.join(absoluteDir, relFile);

    try {
      const text = fs.readFileSync(absFile, "utf8");
      const raw = JSON.parse(text) as unknown;
      const parsed = skillManifestSchema.safeParse(raw);

      if (!parsed.success) {
        continue;
      }

      catalog.set(parsed.data.name, parsed.data);
    } catch {
      continue;
    }
  }

  return [...catalog.values()].filter((item) => {
    if (item.enabled === false) return false;
    if (allowedToolNames && !allowedToolNames.has(item.toolName)) return false;
    return true;
  });
}

export function shortlistSkills(
  userInput: string,
  maxSkillCandidates: number,
  skills: SkillDefinition[] = builtinSkills
): SkillDefinition[] {
  const text = userInput.toLowerCase();

  const scored = skills.map((skill) => {
    let score = 0;
    for (const keyword of skill.keywords) {
      if (text.includes(keyword.toLowerCase())) score += 1;
    }
    return { skill, score };
  });

  const positive = scored
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.skill.priority ?? 0) - (a.skill.priority ?? 0)
    )
    .slice(0, maxSkillCandidates)
    .map((item) => item.skill);

  if (positive.length > 0) {
    return positive;
  }

  return [...skills]
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, maxSkillCandidates);
}
