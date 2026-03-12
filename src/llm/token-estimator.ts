export function estimateTokenCount(text: string): number {
  if (!text) return 0;

  let cjkChars = 0;
  let asciiChars = 0;

  for (const ch of text) {
    if (isCjk(ch)) {
      cjkChars += 1;
    } else if (!/\s/.test(ch)) {
      asciiChars += 1;
    }
  }

  // Heuristic: CJK chars are close to 1 token each, non-space ASCII is ~4 chars/token.
  const asciiTokens = Math.ceil(asciiChars / 4);
  return cjkChars + asciiTokens;
}

function isCjk(ch: string) {
  const code = ch.codePointAt(0);
  if (code === undefined) return false;

  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}
