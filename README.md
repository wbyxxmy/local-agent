# local-agent

A minimal local TypeScript agent runtime with:

- file read/write
- file listing
- code grep
- shell command execution with approval
- git status
- workspace sandbox
- simple planner/router/executor pipeline

## Requirements

- Node.js 20+
- npm 10+ (or pnpm/yarn if you adapt scripts)

## Install

```bash
npm install
```

## Run

```bash
npm run dev -- "list files"
npm run dev -- "read package.json"
npm run dev -- "grep ToolDefinition"
npm run dev -- "git status"
npm run dev -- "run git status"
npm run dev -- "读取 README.md"
npm run dev -- "搜索 PlannerConfig"
npm run dev -- "执行 git status"
```

### Web UI

```bash
npm run web
```

Then open:

- `http://localhost:4173`

The Web UI keeps a persistent session per browser tab, so follow-up inputs like
"再读一下" or "重试" can reuse the previous command context.

Optional custom port:

```bash
PORT=5001 npm run web
```

For natural conversation in Web UI (non-command chat), enable local model:

```bash
export LOCAL_MODEL_ENABLED=true
export LOCAL_MODEL_BASE_URL=http://127.0.0.1:11434
export LOCAL_MODEL_NAME=qwen2.5:7b
npm run web
```

## Write file example

```bash
npm run dev -- "write tmp/hello.txt <<< hello world"
```

This will ask for approval before writing.

## Safety model

This project intentionally starts with strict defaults:

- file access is limited to workspace root
- sensitive paths are denied
- shell commands are allowlisted
- dangerous tools require explicit approval

## Local model planner (optional)

You can enable local-model based planning to auto-select skills while keeping
token usage low.

```bash
export LOCAL_MODEL_ENABLED=true
export LOCAL_MODEL_BASE_URL=http://127.0.0.1:11434
export LOCAL_MODEL_NAME=qwen2.5:7b
export MAX_PLANNER_INPUT_CHARS=600
export MAX_SKILL_CANDIDATES=4
export MAX_PLANNING_TURNS=4
export MAX_OBSERVATION_CHARS=280
export MAX_TOTAL_PLANNING_TOKENS=0
export SOFT_BUDGET_RATIO=0.7
export SKILL_CATALOG_DIR=.local-agent/skills
export SKILL_CATALOG_AUTO_RELOAD=true
export SKILL_CATALOG_REFRESH_MS=1500
```

Set `MAX_TOTAL_PLANNING_TOKENS` to a positive number to enforce a hard planning
budget. `0` means unlimited.

When `MAX_TOTAL_PLANNING_TOKENS` is set, `SOFT_BUDGET_RATIO` controls when the
agent enters soft-budget mode before hard stop:

- soft mode shrinks candidate skills and observation context automatically
- hard stop still triggers at `MAX_TOTAL_PLANNING_TOKENS`

When enabled, planner behavior is:

- shortlist candidate skills by keywords before model call
- clip long user input before sending to model
- clip tool observations before next planning turn
- let model choose skill only, while tool input is extracted by local templates
- request strict JSON output only
- fallback to rule planner on any model failure

Runtime output also includes `planningTrace` with per-turn prompt and
observation character sizes, which can be used as a lightweight token budget
proxy while tuning configs.

Runtime output includes `planningBudget` too:

- `totalPromptTokens`: estimated prompt token usage across all turns
- `totalObservationTokens`: estimated observation token usage across all turns
- `totalPlanningTokens`: combined estimated planning token usage
- `totalTurns`: number of planning turns in this run

Each item in `planningTrace` includes `budgetMode`:

- `normal`: regular planning context size
- `soft`: reduced context/candidate planning mode to lower token use

## Dynamic skill catalog

Planner loads built-in skills first, then merges custom skill manifests from
`SKILL_CATALOG_DIR` (default `.local-agent/skills`).

When auto-reload is enabled, planner periodically refreshes the skill catalog
without process restart.

Manifest schema:

```json
{
	"name": "custom_skill_name",
	"description": "Skill description shown to planner",
	"toolName": "registered_tool_name",
	"keywords": ["keyword1", "keyword2"],
	"priority": 10,
	"enabled": true,
	"inputTemplate": {
		"type": "list_pattern | read_path | write_heredoc | grep_query | run_command | empty",
		"defaults": {
			"limit": 20
		}
	}
}
```

- `name` duplicates override built-in entries
- invalid JSON or invalid schema files are skipped safely
- `inputTemplate.defaults` can prefill tool input fields without extra model tokens
- `priority` resolves keyword conflicts (higher wins)
- `enabled: false` disables a skill without deleting the file
- `toolName` must match a registered runtime tool, otherwise the skill is ignored

When auto-reload is on, planner emits `skills.catalog.reloaded` events with
added/removed/changed skill names and catalog counts.

Example manifest: [examples/skills/example-skill.json](examples/skills/example-skill.json)

## Supported commands

- `list files`
- `read <path>`
- `write <path> <<< <content>`
- `grep <text>`
- `git status`
- `run <command>`
- `open wechat`
- `打开微信，给张三打个招呼`

### App Catalog (optional)

You can add or override app launch mappings in `.local-agent/apps.json`.

Schema:

```json
{
	"app_id": {
		"aliases": ["alias1", "alias2"],
		"launchers": {
			"linux": ["launcher command"],
			"darwin": ["launcher command"],
			"win32": ["launcher command"]
		}
	}
}
```

Example: [examples/apps/apps.example.json](examples/apps/apps.example.json)

Web API for app launcher health:

- `GET /api/apps/status`
- `GET /api/apps/status?sessionId=<id>` (session-scoped cache)
- `GET /api/apps/status?refresh=1` (force refresh, bypass cache)

Each launcher row includes:

- `available`: whether launcher command is available in current environment
- `resolvedPath`: resolved executable path when available
- `repairCommand`: copyable shell command suggestion when unavailable

## Next steps

Recommended next iterations:

- replace string shell with argv mode
- add patch/diff based file writes
- replace rule planner with LLM planner
- add retrieval/index layer
- add plugin/MCP adapter