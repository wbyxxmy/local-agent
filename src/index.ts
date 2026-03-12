import { createApp } from "./app.js";

async function main() {
  const app = createApp();
  const input = process.argv.slice(2).join(" ").trim();

  if (!input) {
    console.log("Usage:");
    console.log('  npm run dev -- "list files"');
    console.log('  npm run dev -- "read package.json"');
    console.log('  npm run dev -- "grep ToolDefinition"');
    console.log('  npm run dev -- "git status"');
    console.log('  npm run dev -- "run git status"');
    console.log('  npm run dev -- "write tmp/hello.txt <<< hello world"');
    process.exit(1);
  }

  app.eventBus.on("*", (event) => {
    console.log("[event]", JSON.stringify(event));
  });

  const result = await app.agent.run(input);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});