import katex from "katex";
import type { PluginContentScriptContext } from "@get-bb/plugin-sdk/app";
import {
  findMath,
  mightContainMath,
  prepareTex,
  type MathMatch,
} from "./math";

const PREVIEW = "[data-markdown-preview]";
const LATEX_CLASS = "bb-latex";
const SKIP_CLOSEST =
  "pre, code, kbd, samp, script, style, textarea, .katex, .katex-display, .katex-error, .bb-latex, [contenteditable='true']";
const BLOCK_CLOSEST =
  "p, li, td, th, h1, h2, h3, h4, h5, h6, pre, blockquote, [data-markdown-preview]";
const OBSERVE: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
};

function observeRoot(): Node {
  return document.body ?? document.documentElement;
}

export function mountLatex({ signal }: PluginContentScriptContext) {
  const scheduled = new Set<Element>();
  let raf = 0;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const origin =
        mutation.target instanceof Element
          ? mutation.target
          : mutation.target.parentElement;
      if (origin) scheduleFrom(origin);
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) scheduleFrom(node);
      }
    }
  });

  const scheduleFrom = (node: Element) => {
    if (signal.aborted) return;
    for (const root of rootsFrom(node)) scheduled.add(root);
    if (raf !== 0) return;
    raf = requestAnimationFrame(flush);
  };

  const flush = () => {
    raf = 0;
    if (signal.aborted) return;
    const batch = [...scheduled];
    scheduled.clear();
    observer.disconnect();
    try {
      for (const root of batch) {
        if (!root.isConnected) continue;
        resetLatex(root);
        processRoot(root);
      }
    } finally {
      if (!signal.aborted) observer.observe(observeRoot(), OBSERVE);
    }
  };

  const dispose = () => {
    observer.disconnect();
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
    scheduled.clear();
    for (const span of document.querySelectorAll(`.${LATEX_CLASS}`)) {
      restoreSpan(span, { force: true });
    }
  };

  observer.observe(observeRoot(), OBSERVE);
  for (const root of document.querySelectorAll(PREVIEW)) {
    scheduled.add(root);
  }
  if (scheduled.size > 0) raf = requestAnimationFrame(flush);

  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}

function rootsFrom(node: Element): Element[] {
  if (node.matches(PREVIEW)) return [node];
  const closest = node.closest(PREVIEW);
  if (closest) return [closest];
  return [...node.querySelectorAll(PREVIEW)];
}

function resetLatex(root: Element): void {
  for (const span of root.querySelectorAll(`.${LATEX_CLASS}`)) {
    restoreSpan(span, { force: false });
  }
  root.normalize();
}

function restoreSpan(span: Element, { force }: { force: boolean }): void {
  const source = span.getAttribute("data-bb-latex-source") ?? "";
  if (!force && sourceAlreadyPresent(span, source)) {
    span.remove();
    return;
  }
  span.replaceWith(document.createTextNode(source));
}

function sourceAlreadyPresent(span: Element, source: string): boolean {
  if (source.length === 0) return false;
  const prev = span.previousSibling;
  const next = span.nextSibling;
  return (
    (prev?.nodeType === Node.TEXT_NODE &&
      (prev.textContent ?? "").includes(source)) ||
    (next?.nodeType === Node.TEXT_NODE &&
      (next.textContent ?? "").includes(source))
  );
}

function processRoot(root: Element): void {
  for (const run of collectBlockRuns(root)) {
    processRun(run);
  }
}

function collectBlockRuns(root: Element): Text[][] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text) || (node.nodeValue ?? "").length === 0) {
        return NodeFilter.FILTER_REJECT;
      }
      if (shouldSkip(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const groups = new Map<Element, Text[]>();
  const order: Element[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue;
    const block = node.parentElement?.closest(BLOCK_CLOSEST);
    if (block === null || block === undefined || block.closest("pre") !== null) {
      continue;
    }
    const run = groups.get(block);
    if (run === undefined) {
      groups.set(block, [node]);
      order.push(block);
    } else {
      run.push(node);
    }
  }
  return order.map((block) => groups.get(block) ?? []);
}

function shouldSkip(node: Text): boolean {
  const parent = node.parentElement;
  if (parent === null) return true;
  return parent.closest(SKIP_CLOSEST) !== null;
}

function processRun(nodes: Text[]): void {
  if (nodes.length === 0) return;
  let concat = "";
  const starts: number[] = [];
  for (const node of nodes) {
    starts.push(concat.length);
    concat += node.nodeValue ?? "";
  }
  if (!mightContainMath(concat)) return;

  const matches = findMath(concat);
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i];
    if (match === undefined) continue;
    applyMatch(nodes, starts, match);
  }
}

function applyMatch(nodes: Text[], starts: number[], match: MathMatch): void {
  const start = locateStart(nodes, starts, match.start);
  const end = locateEnd(nodes, starts, match.end);
  if (start === null || end === null) return;
  if (!start.node.isConnected || !end.node.isConnected) return;

  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return;
  }
  if (range.collapsed) return;

  const span = renderMatch(match.body, match.raw, match.display);
  range.deleteContents();
  range.insertNode(span);
}

function locateStart(
  nodes: Text[],
  starts: number[],
  index: number,
): { node: Text; offset: number } | null {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const start = starts[i];
    if (node === undefined || start === undefined) continue;
    const length = node.nodeValue?.length ?? 0;
    if (index >= start && index < start + length) {
      return { node, offset: index - start };
    }
  }
  for (let i = 0; i < nodes.length; i += 1) {
    if (starts[i] === index && nodes[i] !== undefined) {
      return { node: nodes[i], offset: 0 };
    }
  }
  return null;
}

function locateEnd(
  nodes: Text[],
  starts: number[],
  index: number,
): { node: Text; offset: number } | null {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const start = starts[i];
    if (node === undefined || start === undefined) continue;
    const length = node.nodeValue?.length ?? 0;
    if (index > start && index <= start + length) {
      return { node, offset: index - start };
    }
  }
  if (index === 0 && nodes[0] !== undefined) {
    return { node: nodes[0], offset: 0 };
  }
  return null;
}

function renderMatch(body: string, raw: string, display: boolean): HTMLElement {
  const span = document.createElement("span");
  span.className = display
    ? `${LATEX_CLASS} bb-latex-display`
    : `${LATEX_CLASS} bb-latex-inline`;
  span.setAttribute("data-bb-latex-source", raw);
  try {
    katex.render(prepareTex(body), span, {
      displayMode: display,
      throwOnError: false,
      output: "htmlAndMathml",
      trust: false,
      strict: "ignore",
    });
  } catch {
    span.classList.add("bb-latex-error");
    span.textContent = raw;
  }
  return span;
}
