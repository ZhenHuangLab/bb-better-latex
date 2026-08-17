export type MathMatch = {
  start: number;
  end: number;
  body: string;
  raw: string;
  display: boolean;
};

const MAX_BODY = 2000;

const MATH_SIGNAL =
  /[_^=+*/<>|≤≥≠≈∈∉⊂⊃∞∫∑∏√∂∇·×÷±∓→←⇒⇔∀∃λθαβγπσωμΔΩℝℂℕℤℚ{}\\^]/;

const SIMPLE_IDENT = /^[A-Za-z][A-Za-z0-9]*$/;
const ALL_CAPS_IDENT = /^[A-Z][A-Z0-9_]{2,}$/;
const CURRENCY_OR_NUMBER =
  /^[\d,.]+(?:\s*(?:k|K|m|M|usd|USD|usdt|USDT))?$/;
const GREEK = /^[\u0370-\u03FF\u1F00-\u1FFF]+$/;
const FN_CALL = /^[A-Za-z][A-Za-z0-9]*\([^)]{0,40}\)$/;
const SHORT_SUBSCRIPT = /^[A-Za-z][A-Za-z0-9]*(_\{[^}]+\}|_[A-Za-z0-9])+$/;

export function mightContainMath(text: string): boolean {
  return (
    text.includes("$") ||
    text.includes("\\(") ||
    text.includes("\\[") ||
    text.includes("[") ||
    text.includes("(")
  );
}

export function isPlausibleInlineMath(body: string): boolean {
  if (body.length === 0 || body.length > MAX_BODY) return false;
  if (body !== body.trim()) return false;
  if (/[\r\n]/.test(body)) return false;
  if (/^\d/.test(body) || CURRENCY_OR_NUMBER.test(body)) return false;
  if (ALL_CAPS_IDENT.test(body)) return false;
  if (/\\[A-Za-z]+/.test(body) || MATH_SIGNAL.test(body)) return true;
  if (GREEK.test(body) || FN_CALL.test(body)) return true;
  return SIMPLE_IDENT.test(body) && body.length <= 8;
}

export function isPlausibleDisplayMath(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_BODY) return false;
  if (/\\[A-Za-z]+/.test(trimmed)) return true;
  return /[=^]/.test(trimmed) && /[_\\{}+\-*/]/.test(trimmed);
}

export function isPlausibleParenMath(body: string): boolean {
  if (!isPlausibleInlineMath(body)) return false;
  if (SIMPLE_IDENT.test(body)) return false;
  if (/\\[A-Za-z]+/.test(body)) return true;
  if (/[\^{}]/.test(body)) return true;
  if (SHORT_SUBSCRIPT.test(body)) return true;
  return /[=+\-*/]/.test(body) && /[_^\\]/.test(body);
}

export function findMath(text: string): MathMatch[] {
  const matches: MathMatch[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "\\" && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === "(" || next === "[") {
        const display = next === "[";
        const close = display ? "\\]" : "\\)";
        const end = text.indexOf(close, i + 2);
        if (end !== -1) {
          const body = text.slice(i + 2, end);
          if (body.trim().length > 0 && body.length <= MAX_BODY) {
            push(matches, text, i, end + close.length, body, display);
            i = end + close.length;
            continue;
          }
        }
      }
      i += 2;
      continue;
    }

    if (ch === "$") {
      if (text[i + 1] === "$") {
        const end = text.indexOf("$$", i + 2);
        if (end !== -1) {
          const body = text.slice(i + 2, end);
          if (body.trim().length > 0 && body.length <= MAX_BODY) {
            push(matches, text, i, end + 2, body, /[\r\n]/.test(body));
            i = end + 2;
            continue;
          }
        }
        i += 2;
        continue;
      }

      const end = findSingleDollarEnd(text, i + 1);
      if (end !== -1) {
        const body = text.slice(i + 1, end);
        if (isPlausibleInlineMath(body)) {
          push(matches, text, i, end + 1, body, false);
          i = end + 1;
          continue;
        }
      }
      i += 1;
      continue;
    }

    if (ch === "[" && text[i + 1] !== "^" && isAtLineStart(text, i)) {
      const end = findDisplayBracketEnd(text, i);
      if (end !== -1) {
        const body = text.slice(i + 1, end);
        if (isPlausibleDisplayMath(body)) {
          push(matches, text, i, end + 1, body.trim(), true);
          i = end + 1;
          continue;
        }
      }
    }

    if (ch === "(") {
      const end = findBalanced(text, "(", ")", i);
      if (end !== -1) {
        const body = text.slice(i + 1, end);
        if (isPlausibleParenMath(body)) {
          push(matches, text, i, end + 1, body, false);
          i = end + 1;
          continue;
        }
      }
    }

    i += 1;
  }

  return matches;
}

function push(
  matches: MathMatch[],
  text: string,
  start: number,
  end: number,
  body: string,
  display: boolean,
): void {
  matches.push({
    start,
    end,
    body,
    raw: text.slice(start, end),
    display,
  });
}

function isAtLineStart(text: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && (text[i] === " " || text[i] === "\t")) i -= 1;
  return i < 0 || text[i] === "\n" || text[i] === "\r";
}

function findSingleDollarEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === "$" && text[i + 1] !== "$") return i;
  }
  return -1;
}

const TEX_RIGHT_PREFIX = /\\(?:right|[bB]igg?[lr]?)$/;

function findDisplayBracketEnd(text: string, openIndex: number): number {
  let lastGood = -1;
  for (let i = openIndex + 1; i < text.length; i += 1) {
    if (text[i] !== "]") continue;
    if (text[i + 1] === "(") continue;
    if (isInternalTexBracket(text, i)) continue;
    lastGood = i;
    if (isTrailingCloser(text, i)) return i;
  }
  return lastGood;
}

function isInternalTexBracket(text: string, bracketIndex: number): boolean {
  const before = text.slice(0, bracketIndex);
  if (TEX_RIGHT_PREFIX.test(before)) return true;
  return /\\[A-Za-z]+\s*\[[^\]]*$/.test(before);
}

function isTrailingCloser(text: string, bracketIndex: number): boolean {
  let i = bracketIndex + 1;
  while (i < text.length && /[\s.,;:!?。，、]/.test(text[i] ?? "")) i += 1;
  return i >= text.length || text[i] === "\n" || text[i] === "\r";
}

function findBalanced(
  text: string,
  open: string,
  close: string,
  from: number,
): number {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === open) depth += 1;
    else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
