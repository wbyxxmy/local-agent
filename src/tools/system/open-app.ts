import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "../../types/tool.js";
import { execCommand } from "../../infra/shell/exec.js";

const inputSchema = z.object({
  app: z.string().min(1),
  contact: z.string().optional(),
  message: z.string().optional(),
  action: z.string().optional()
});

interface AppConfig {
  aliases: string[];
  launchers: Record<string, string[]>;
}

export interface AppLauncherProbe {
  launcher: string;
  command: string;
  available: boolean;
  detail: string;
  resolvedPath?: string;
  repairCommand?: string;
}

export interface AppStatusRow {
  appId: string;
  aliases: string[];
  launchers: AppLauncherProbe[];
}

interface AppLaunchStatusCacheEntry {
  expiresAt: number;
  status: {
    source: string;
    warning?: string;
    platform: string;
    apps: AppStatusRow[];
  };
}

interface AppLaunchStatusOptions {
  forceRefresh?: boolean;
  cacheKey?: string;
}

const appStatusCache = new Map<string, AppLaunchStatusCacheEntry>();
const APP_STATUS_CACHE_TTL_MS = 12_000;

const defaultAppCatalog: Record<string, AppConfig> = {
  wechat: {
    aliases: ["wechat", "微信", "weixin"],
    launchers: {
      linux: ["xdg-open weixin://", "wechat", "flatpak run com.tencent.WeChat"],
      darwin: ["open -a WeChat", "open weixin://"],
      win32: ["start weixin://", "start WeChat"]
    }
  },
  browser: {
    aliases: ["browser", "浏览器", "chrome", "edge", "firefox"],
    launchers: {
      linux: ["xdg-open https://www.example.com"],
      darwin: ["open https://www.example.com"],
      win32: ["start https://www.example.com"]
    }
  }
};

const appCatalogSchema = z.record(
  z.object({
    aliases: z.array(z.string()).default([]),
    launchers: z.record(z.array(z.string())).default({})
  })
);

async function loadAppCatalog(workspaceRoot: string) {
  const catalogPath = path.join(workspaceRoot, ".local-agent", "apps.json");

  try {
    const raw = await fs.readFile(catalogPath, "utf8");
    const parsed = appCatalogSchema.safeParse(JSON.parse(raw));

    if (!parsed.success) {
      return { catalog: defaultAppCatalog, source: "default", warning: "invalid config schema" };
    }

    const merged: Record<string, AppConfig> = { ...defaultAppCatalog };
    for (const [id, conf] of Object.entries(parsed.data)) {
      const existing = merged[id];
      merged[id] = {
        aliases: conf.aliases.length > 0 ? conf.aliases : (existing?.aliases ?? []),
        launchers: {
          ...(existing?.launchers ?? {}),
          ...conf.launchers
        }
      };
    }

    return { catalog: merged, source: catalogPath };
  } catch {
    return { catalog: defaultAppCatalog, source: "default" };
  }
}

function normalizeApp(input: string, catalog: Record<string, AppConfig>) {
  const value = input.trim().toLowerCase();

  for (const [id, config] of Object.entries(catalog)) {
    if (config.aliases.some((alias) => alias.toLowerCase() === value)) {
      return id;
    }
  }

  if (catalog[value]) return value;
  return value;
}

function parseLauncherCommand(launcher: string) {
  const normalized = launcher.trim();
  if (!normalized) return "";
  const first = normalized.split(/\s+/)[0] ?? "";
  return first;
}

async function commandAvailable(command: string, workspaceRoot: string) {
  if (!command) {
    return { available: false, detail: "empty launcher command" as const };
  }

  const platform = os.platform();
  const checkCmd = platform === "win32" ? `where ${command}` : `command -v ${command}`;
  const check = await execCommand(checkCmd, workspaceRoot);
  if (check.exitCode === 0) {
    const resolvedPath =
      String(check.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) || undefined;

    return {
      available: true,
      detail: resolvedPath ? "command found" : "command found (path unknown)",
      resolvedPath
    };
  }

  const stderr = check.stderr?.trim();
  return {
    available: false,
    detail: stderr || `command not found: ${command}`
  };
}

function buildRepairCommand(command: string, platform: string) {
  if (!command) return undefined;

  const linuxHints: Record<string, string> = {
    "xdg-open": "sudo apt-get update && sudo apt-get install -y xdg-utils",
    flatpak: "sudo apt-get update && sudo apt-get install -y flatpak",
    wechat: "flatpak install -y flathub com.tencent.WeChat"
  };

  const darwinHints: Record<string, string> = {
    open: "which open",
    wechat: "brew install --cask wechat"
  };

  const winHints: Record<string, string> = {
    wechat: "winget install Tencent.WeChat"
  };

  if (platform === "linux") {
    return linuxHints[command] ?? `which ${command}`;
  }
  if (platform === "darwin") {
    return darwinHints[command] ?? `which ${command}`;
  }
  if (platform === "win32") {
    return winHints[command] ?? `where ${command}`;
  }

  return undefined;
}

export async function getAppLaunchStatus(
  workspaceRoot: string,
  options: AppLaunchStatusOptions = {}
) {
  const { catalog, source, warning } = await loadAppCatalog(workspaceRoot);
  const platform = os.platform();
  const cacheScope = options.cacheKey?.trim() || "global";
  const cacheId = `${workspaceRoot}::${platform}::${source}::${cacheScope}`;

  if (!options.forceRefresh) {
    const cached = appStatusCache.get(cacheId);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        ...cached.status,
        cached: true
      };
    }
  }

  const rows: AppStatusRow[] = [];

  for (const [appId, config] of Object.entries(catalog)) {
    const launchers = config.launchers[platform] ?? [];
    const launcherRows: AppLauncherProbe[] = [];

    for (const launcher of launchers) {
      const command = parseLauncherCommand(launcher);
      const probe = await commandAvailable(command, workspaceRoot);
      launcherRows.push({
        launcher,
        command,
        available: probe.available,
        detail: probe.detail,
        ...(probe.resolvedPath ? { resolvedPath: probe.resolvedPath } : {}),
        ...(probe.available
          ? {}
          : { repairCommand: buildRepairCommand(command, platform) })
      });
    }

    rows.push({
      appId,
      aliases: config.aliases,
      launchers: launcherRows
    });
  }

  const status = {
    source,
    warning,
    platform,
    apps: rows
  };

  appStatusCache.set(cacheId, {
    expiresAt: Date.now() + APP_STATUS_CACHE_TTL_MS,
    status
  });

  return {
    ...status,
    cached: false
  };
}

export const openAppTool: ToolDefinition<
  z.infer<typeof inputSchema>,
  {
    app: string;
    launcher: string;
    actionHint?: string;
    catalogSource?: string;
    note?: string;
  }
> = {
  name: "open_app",
  description: "Open a local application and optionally prepare a follow-up action",
  riskLevel: "high",
  requiresConfirmation: true,
  inputSchema,
  async run(input, ctx) {
    const { catalog, source, warning } = await loadAppCatalog(ctx.workspaceRoot);
    const appId = normalizeApp(input.app, catalog);
    const platform = os.platform();
    const config = catalog[appId];

    if (!config) {
      return {
        ok: false,
        error: `Unknown app: ${input.app}. Add aliases and launchers in .local-agent/apps.json.`
      };
    }

    const launchers = config.launchers[platform] ?? [];
    if (launchers.length === 0) {
      return {
        ok: false,
        error: `No launcher configured for ${input.app} on ${platform}`
      };
    }

    const errors: string[] = [];
    for (const launcher of launchers) {
      const result = await execCommand(launcher, ctx.workspaceRoot, ctx.abortSignal);
      if (result.exitCode === 0) {
        const actionHint = input.contact
          ? `请在 ${input.app} 中联系 ${input.contact}${input.message ? `，并发送：${input.message}` : ""}`
          : input.action;

        return {
          ok: true,
          data: {
            app: input.app,
            launcher,
            actionHint,
            ...(source !== "default" ? { catalogSource: source } : {}),
            note:
              warning
                ? `Loaded default app catalog (${warning}). 当前能力只负责打开应用；应用内的自动发消息依赖目标应用提供官方自动化接口。`
                : "当前能力只负责打开应用；应用内的自动发消息依赖目标应用提供官方自动化接口。"
          }
        };
      }

      const stderr = result.stderr?.trim();
      if (stderr) {
        errors.push(`${launcher}: ${stderr}`);
      } else {
        errors.push(`${launcher}: exit ${result.exitCode}`);
      }
    }

    return {
      ok: false,
      error: `Failed to open app ${input.app}. Tried: ${errors.join(" | ")}`
    };
  }
};
