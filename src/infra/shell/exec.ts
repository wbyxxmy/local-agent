import { execa } from "execa";

export async function execCommand(
  command: string,
  cwd: string,
  signal?: AbortSignal
) {
  const result = await execa(command, {
    cwd,
    shell: true,
    reject: false,
    signal
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr
  };
}