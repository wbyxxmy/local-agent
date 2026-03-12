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

## Supported commands

- `list files`
- `read <path>`
- `write <path> <<< <content>`
- `grep <text>`
- `git status`
- `run <command>`

## Next steps

Recommended next iterations:

- replace string shell with argv mode
- add patch/diff based file writes
- replace rule planner with LLM planner
- add retrieval/index layer
- add plugin/MCP adapter