import { KATEX_SHADOW_CSS } from "./katex-shadow-css";

const KATEX_SELECTOR = ".katex";
const PLUGIN_MATH_SELECTOR = ".bb-latex";
const PREVIEW_SELECTOR = "[data-markdown-preview]";
const DISPLAY_SELECTOR = ".katex-display, .bb-latex-display";
const SOURCE_ATTRIBUTE = "data-bb-latex-source";
const ENHANCED_CLASS = "bb-latex-selection-enhanced";
const PROXY_CLASS = "bb-latex-selection-proxy";
const SOURCE_CLASS = "bb-latex-selection-source";
const SOURCE_SLOT = "bb-better-latex-source";
const PROXY_OWNER_ATTRIBUTE = "data-bb-latex-selection-owner";
const SHADOW_VISUAL_ATTRIBUTE = "data-bb-latex-selection-visual";

const SHADOW_BASE_CSS = `
:host {
  display: contents;
}

[${SHADOW_VISUAL_ATTRIBUTE}],
[${SHADOW_VISUAL_ATTRIBUTE}] * {
  -webkit-user-select: none !important;
  user-select: none !important;
}

:host-context(.katex-display)
  > [${SHADOW_VISUAL_ATTRIBUTE}].katex-html {
  display: block;
  position: relative;
}

:host-context(.katex-display)
  > [${SHADOW_VISUAL_ATTRIBUTE}].katex-html > .tag {
  position: absolute;
  right: 0;
}

:host-context(.katex-display.leqno)
  > [${SHADOW_VISUAL_ATTRIBUTE}].katex-html > .tag {
  left: 0;
  right: auto;
}

slot[name="${SOURCE_SLOT}"] {
  display: contents;
}

::slotted(.${SOURCE_CLASS}) {
  position: absolute !important;
  inset: 0 !important;
  z-index: 2 !important;
  display: inline !important;
  overflow: hidden !important;
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  white-space: pre !important;
  -webkit-user-select: all !important;
  user-select: all !important;
}
`;

const KATEX_PROXY_CSS = KATEX_SHADOW_CSS.replace(
  /^\.katex\{[^{}]*\}/u,
  "",
)
  .replace(/\.katex-display[^{}]*\{[^{}]*\}/gu, "")
  .replace(/\.katex(?![-\w])/gu, ":host");

type ShadowStyles = {
  cssText: string;
  sheet: CSSStyleSheet | null;
};

type TexSource = {
  canonical: string;
};

type BoundaryPoint = {
  node: Node;
  offset: number;
};

type HostState = {
  canonical: string;
  visualMarkup: string;
};

export interface MathSelectionController {
  enhance(root: Element): void;
  reconcile(): void;
  dispose(): void;
}

const stylesByDocument = new WeakMap<Document, ShadowStyles>();

/**
 * Keep BB's native Selection path while making rendered KaTeX selectable as
 * canonical TeX. Only plugin-owned proxy elements receive shadow roots, so a
 * disabled or reloaded plugin can restore the original KaTeX DOM completely.
 */
export function createMathSelectionController(
  document: Document,
): MathSelectionController {
  const owner = createOwnerId();
  const hosts = new Set<HTMLElement>();
  const states = new WeakMap<HTMLElement, HostState>();
  let disposed = false;
  let normalizing = false;
  let pointerIsDown = false;
  let pointerUsesLiveSelection = false;

  const normalize = () => {
    if (disposed || normalizing) return;
    const selection = document.getSelection();
    if (
      selection === null ||
      selection.rangeCount !== 1 ||
      selection.isCollapsed
    ) {
      return;
    }

    const range = selection.getRangeAt(0);
    const startSource = sourceForBoundary(
      range.startContainer,
      range.startOffset,
      "start",
      hosts,
      owner,
    );
    const endSource = sourceForBoundary(
      range.endContainer,
      range.endOffset,
      "end",
      hosts,
      owner,
    );
    if (startSource === null && endSource === null) return;

    const start =
      startSource === null
        ? { node: range.startContainer, offset: range.startOffset }
        : sourceBoundary(startSource, "start");
    const end =
      endSource === null
        ? { node: range.endContainer, offset: range.endOffset }
        : sourceBoundary(endSource, "end");
    if (
      sameBoundary(start, range.startContainer, range.startOffset) &&
      sameBoundary(end, range.endContainer, range.endOffset)
    ) {
      return;
    }

    const next = document.createRange();
    try {
      next.setStart(start.node, start.offset);
      next.setEnd(end.node, end.offset);
    } catch {
      return;
    }

    const backward = selectionIsBackward(selection, range);
    normalizing = true;
    try {
      if (typeof selection.setBaseAndExtent === "function") {
        selection.setBaseAndExtent(
          backward ? end.node : start.node,
          backward ? end.offset : start.offset,
          backward ? start.node : end.node,
          backward ? start.offset : end.offset,
        );
      } else {
        selection.removeAllRanges();
        selection.addRange(next);
      }
    } finally {
      normalizing = false;
    }
  };

  const handlePointerDown = (event: PointerEvent) => {
    pointerIsDown = true;
    pointerUsesLiveSelection = event.pointerType !== "mouse";
  };
  const handlePointerRelease = () => {
    pointerIsDown = false;
    pointerUsesLiveSelection = false;
    normalize();
  };
  const handleSelectionChange = () => {
    if (pointerIsDown && !pointerUsesLiveSelection) return;
    normalize();
  };

  document.addEventListener("pointerdown", handlePointerDown, true);
  document.addEventListener("pointerup", handlePointerRelease, true);
  document.addEventListener("pointercancel", handlePointerRelease, true);
  document.addEventListener("mouseup", handlePointerRelease, true);
  document.addEventListener("selectionchange", handleSelectionChange, true);
  document.addEventListener("keyup", handleSelectionChange, true);

  return {
    enhance(root) {
      if (disposed) return;
      reconcileHosts(hosts, states, owner);
      for (const host of katexHosts(root)) {
        enhanceMathHost(host, hosts, states, owner);
      }
    },
    reconcile() {
      if (!disposed) reconcileHosts(hosts, states, owner);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointerup", handlePointerRelease, true);
      document.removeEventListener("pointercancel", handlePointerRelease, true);
      document.removeEventListener("mouseup", handlePointerRelease, true);
      document.removeEventListener(
        "selectionchange",
        handleSelectionChange,
        true,
      );
      document.removeEventListener("keyup", handleSelectionChange, true);
      for (const host of [...hosts]) {
        if (proxyOwner(host) === owner) restoreMathHost(host, states);
      }
      hosts.clear();
    },
  };
}

function createOwnerId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function reconcileHosts(
  hosts: Set<HTMLElement>,
  states: WeakMap<HTMLElement, HostState>,
  owner: string,
): void {
  for (const host of [...hosts]) {
    if (proxyOwner(host) !== owner) {
      states.delete(host);
      hosts.delete(host);
      continue;
    }
    if (!host.isConnected || !isEligibleHost(host)) {
      restoreMathHost(host, states);
      hosts.delete(host);
    }
  }
}

function isEligibleHost(host: HTMLElement): boolean {
  return (
    host.matches(KATEX_SELECTOR) &&
    host.closest(PREVIEW_SELECTOR) !== null &&
    host.closest(".bb-latex-error") === null &&
    host.querySelector(".katex-error") === null &&
    texSource(host) !== null
  );
}

function enhanceMathHost(
  host: HTMLElement,
  hosts: Set<HTMLElement>,
  states: WeakMap<HTMLElement, HostState>,
  owner: string,
): void {
  if (!isEligibleHost(host)) return;
  const source = texSource(host);
  if (source === null) return;
  const styles = shadowStyles(host.ownerDocument);
  const visualMarkup = originalVisualMarkup(host);
  const state = states.get(host);
  const currentProxy = directProxy(host);
  if (
    currentProxy?.getAttribute(PROXY_OWNER_ATTRIBUTE) === owner &&
    state?.canonical === source.canonical &&
    state.visualMarkup === visualMarkup &&
    directSource(currentProxy)?.textContent === source.canonical &&
    currentProxy.shadowRoot?.querySelector(
      `[${SHADOW_VISUAL_ATTRIBUTE}]`,
    ) !== null
  ) {
    hosts.add(host);
    return;
  }

  restoreMathHost(host, states);

  const visualChildren: HTMLElement[] = [];
  for (const child of [...host.children]) {
    if (child.classList.contains(PROXY_CLASS)) continue;
    const visual = child.cloneNode(true) as HTMLElement;
    visual.setAttribute(SHADOW_VISUAL_ATTRIBUTE, "");
    visualChildren.push(visual);
  }
  if (visualChildren.length === 0) return;

  const proxy = host.ownerDocument.createElement("span");
  proxy.className = PROXY_CLASS;
  proxy.setAttribute(PROXY_OWNER_ATTRIBUTE, owner);

  let shadow: ShadowRoot;
  try {
    shadow = proxy.attachShadow({ mode: "open" });
  } catch {
    return;
  }

  const sourceNode = host.ownerDocument.createElement("span");
  sourceNode.className = SOURCE_CLASS;
  sourceNode.slot = SOURCE_SLOT;
  sourceNode.textContent = source.canonical;
  sourceNode.setAttribute("aria-hidden", "true");

  const sourceSlot = host.ownerDocument.createElement("slot");
  sourceSlot.name = SOURCE_SLOT;

  try {
    applyShadowStyles(shadow, styles);
    shadow.append(...visualChildren, sourceSlot);
    proxy.append(sourceNode);
    host.append(proxy);
    host.classList.add(ENHANCED_CLASS);
    states.set(host, { canonical: source.canonical, visualMarkup });
    hosts.add(host);
  } catch {
    proxy.remove();
    host.classList.remove(ENHANCED_CLASS);
    states.delete(host);
  }
}

function originalVisualMarkup(host: HTMLElement): string {
  return [...host.children]
    .filter((child) => !child.classList.contains(PROXY_CLASS))
    .map((child) => child.outerHTML)
    .join("");
}

function restoreMathHost(
  host: HTMLElement,
  states: WeakMap<HTMLElement, HostState>,
): void {
  for (const child of [...host.children]) {
    if (child.classList.contains(PROXY_CLASS)) child.remove();
  }
  host.classList.remove(ENHANCED_CLASS);
  states.delete(host);
}

function directProxy(host: HTMLElement): HTMLElement | null {
  for (const child of [...host.children]) {
    if (child instanceof HTMLElement && child.classList.contains(PROXY_CLASS)) {
      return child;
    }
  }
  return null;
}

function directSource(proxy: HTMLElement): HTMLElement | null {
  for (const child of [...proxy.children]) {
    if (
      child instanceof HTMLElement &&
      child.classList.contains(SOURCE_CLASS) &&
      child.getAttribute("slot") === SOURCE_SLOT
    ) {
      return child;
    }
  }
  return null;
}

function proxyOwner(host: HTMLElement): string | null {
  return directProxy(host)?.getAttribute(PROXY_OWNER_ATTRIBUTE) ?? null;
}

function applyShadowStyles(shadow: ShadowRoot, styles: ShadowStyles): void {
  if (styles.sheet !== null) {
    try {
      shadow.adoptedStyleSheets = [styles.sheet];
      return;
    } catch {
      // Fall through to a local style element on older webviews.
    }
  }

  const style = shadow.ownerDocument.createElement("style");
  style.textContent = styles.cssText;
  shadow.append(style);
}

function shadowStyles(document: Document): ShadowStyles {
  const cached = stylesByDocument.get(document);
  if (cached !== undefined) return cached;

  const cssText = `${KATEX_PROXY_CSS}\n${SHADOW_BASE_CSS}`;
  let sheet: CSSStyleSheet | null = null;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
  } catch {
    sheet = null;
  }

  const styles = { cssText, sheet };
  stylesByDocument.set(document, styles);
  return styles;
}

function texSource(host: HTMLElement): TexSource | null {
  const annotation = host.querySelector(
    'annotation[encoding="application/x-tex"]',
  )?.textContent;
  const display = host.closest(DISPLAY_SELECTOR) !== null;
  const pluginSource = host
    .closest(PLUGIN_MATH_SELECTOR)
    ?.getAttribute(SOURCE_ATTRIBUTE);
  const body = annotation?.trim() || sourceBody(pluginSource, display);
  if (!body) return null;
  return {
    canonical: display ? `\\[\n${body}\n\\]` : `\\(${body}\\)`,
  };
}

function sourceBody(
  source: string | null | undefined,
  display: boolean,
): string | null {
  if (source == null) return null;
  const trimmed = source.trim();
  const delimiters: ReadonlyArray<readonly [string, string]> = [
    ["$$", "$$"],
    ["\\[", "\\]"],
    ["\\(", "\\)"],
    ["$", "$"],
  ];
  for (const [open, close] of delimiters) {
    if (
      trimmed.startsWith(open) &&
      trimmed.endsWith(close) &&
      trimmed.length > open.length + close.length
    ) {
      return trimmed.slice(open.length, -close.length).trim();
    }
  }
  if (display && trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).trim();
  }
  if (!display && trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed || null;
}

function sourceForBoundary(
  node: Node,
  offset: number,
  edge: "start" | "end",
  hosts: ReadonlySet<HTMLElement>,
  owner: string,
): HTMLElement | null {
  if (
    node.nodeType === Node.ELEMENT_NODE ||
    node.nodeType === Node.DOCUMENT_FRAGMENT_NODE
  ) {
    const childIndex = edge === "start" ? offset : offset - 1;
    return sourceForNode(node.childNodes[childIndex] ?? null, hosts, owner);
  }
  return sourceForNode(node, hosts, owner);
}

function sourceForNode(
  node: Node | null,
  hosts: ReadonlySet<HTMLElement>,
  owner: string,
): HTMLElement | null {
  if (node === null) return null;

  const element = node instanceof Element ? node : node.parentElement;
  const source = element?.closest<HTMLElement>(`.${SOURCE_CLASS}`) ?? null;
  if (source !== null) {
    const proxy = source.parentElement;
    const host = proxy?.parentElement;
    if (
      proxy?.classList.contains(PROXY_CLASS) === true &&
      proxy.getAttribute(PROXY_OWNER_ATTRIBUTE) === owner &&
      host instanceof HTMLElement &&
      hosts.has(host)
    ) {
      return source;
    }
  }

  const root = node.getRootNode();
  if (root instanceof ShadowRoot) {
    const proxy = root.host;
    const host = proxy.parentElement;
    if (
      proxy instanceof HTMLElement &&
      proxy.classList.contains(PROXY_CLASS) &&
      proxy.getAttribute(PROXY_OWNER_ATTRIBUTE) === owner &&
      host instanceof HTMLElement &&
      hosts.has(host)
    ) {
      return directSource(proxy);
    }
  }

  if (element instanceof HTMLElement && hosts.has(element)) {
    const proxy = directProxy(element);
    if (proxy?.getAttribute(PROXY_OWNER_ATTRIBUTE) === owner) {
      return directSource(proxy);
    }
  }
  return null;
}

function sourceBoundary(
  source: HTMLElement,
  edge: "start" | "end",
): BoundaryPoint {
  const text = source.firstChild;
  if (text?.nodeType === Node.TEXT_NODE) {
    return {
      node: text,
      offset: edge === "start" ? 0 : (text.textContent?.length ?? 0),
    };
  }
  return {
    node: source,
    offset: edge === "start" ? 0 : source.childNodes.length,
  };
}

function sameBoundary(
  boundary: BoundaryPoint,
  node: Node,
  offset: number,
): boolean {
  return boundary.node === node && boundary.offset === offset;
}

function selectionIsBackward(selection: Selection, range: Range): boolean {
  const direction = (selection as Selection & { direction?: string }).direction;
  if (direction === "backward") return true;
  if (direction === "forward") return false;
  return (
    selection.anchorNode === range.endContainer &&
    selection.anchorOffset === range.endOffset
  );
}

function katexHosts(root: ParentNode): HTMLElement[] {
  const hosts = [...root.querySelectorAll<HTMLElement>(KATEX_SELECTOR)];
  if (root instanceof HTMLElement && root.matches(KATEX_SELECTOR)) {
    hosts.unshift(root);
  }
  return hosts;
}
