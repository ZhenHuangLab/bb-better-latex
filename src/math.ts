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

export function mightContainMath(text: string): boolean {
  return text.includes("$") || text.includes("\\(") || text.includes("\\[");
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
            const raw = text.slice(i, end + close.length);
            matches.push({ start: i, end: end + close.length, body, raw, display });
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
            const raw = text.slice(i, end + 2);
            matches.push({
              start: i,
              end: end + 2,
              body,
              raw,
              display: /[\r\n]/.test(body),
            });
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
          const raw = text.slice(i, end + 1);
          matches.push({ start: i, end: end + 1, body, raw, display: false });
          i = end + 1;
          continue;
        }
      }
    }

    i += 1;
  }

  return matches;
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
