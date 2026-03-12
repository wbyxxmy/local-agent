import path from "node:path";

export function resolveInRoot(root: string, targetPath: string): string {
  const rootAbs = path.resolve(root);
  const resolved = path.resolve(rootAbs, targetPath);

  if (resolved !== rootAbs && !resolved.startsWith(rootAbs + path.sep)) {
    throw new Error(`Path escapes workspace root: ${targetPath}`);
  }

  return resolved;
}