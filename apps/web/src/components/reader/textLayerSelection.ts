/**
 * reader/textLayerSelection — drags that end in blank space select what the reader expects.
 *
 * THE DEFECT. The text layer is a pile of absolutely-positioned spans over a canvas. A mouse drag
 * that ENDS in blank page (right of a short last line, below a paragraph, in the gutter between
 * columns) has no span under the pointer, so the browser resolves the end of the selection from
 * the text layer's DOM order and its own heuristics, and can jump to unrelated text elsewhere (the
 * other column, a caption, the paragraph above). Highlight and Ask would then capture that text.
 *
 * THE FIX is pdf.js's own viewer mechanism (`TextLayerBuilder#bindMouse` and the global
 * `selectionchange` listener in `pdfjs-dist/web/pdf_viewer.mjs`), ported: each text layer holds an
 * `endOfContent` div. At rest it sits below the layer. While a selection is being made (`selecting`
 * class) it covers the whole layer and is `user-select: none`, so a pointer over blank space lands
 * on it instead of on nothing; and on every `selectionchange` the div is moved in the DOM to sit
 * right after the selection's end, so "the nearest text" is the text the selection already reaches.
 * The effect is that a drag into whitespace extends to the end of the text the pointer passed,
 * exactly as in the pdf.js viewer.
 *
 * ON TOP of that, a drag that ends over blank text-layer space is SNAPPED to the nearest text
 * (`snapFocusToText`). `endOfContent` alone extends to "wherever the pointer last touched text",
 * which depends on how many mouse events the drag produced and on the path it took (a quick drag
 * to the right of a short last line never touches that line, and the selection stops a line
 * short). Snapping is geometry: the focus is moved to the end of the line the pointer is level
 * with, to the end of the line above when the pointer is in a gap, and never into another column
 * (the side of the pointer the drag started on decides).
 *
 * The CSS half lives in `PdfDocumentProvider`'s `TEXT_LAYER_CSS` (`.endOfContent`, `.selecting`).
 */

const END_CLASS = 'endOfContent';
const SELECTING_CLASS = 'selecting';

const layers = new Map<HTMLElement, HTMLElement>();
let globalAbort: AbortController | null = null;
let isFirefox: boolean | undefined;
let previousRange: Range | undefined;

function reset(end: HTMLElement, layer: HTMLElement): void {
  layer.append(end);
  end.style.width = '';
  end.style.height = '';
  end.style.userSelect = '';
  layer.classList.remove(SELECTING_CLASS);
}

function resetAll(): void {
  layers.forEach(reset);
}

function onSelectionChange(): void {
  const selection = document.getSelection();
  if (selection === null || selection.rangeCount === 0) {
    resetAll();
    return;
  }

  const active = new Set<HTMLElement>();
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    for (const layer of layers.keys()) {
      if (!active.has(layer) && range.intersectsNode(layer)) active.add(layer);
    }
  }
  for (const [layer, end] of layers) {
    if (active.has(layer)) layer.classList.add(SELECTING_CLASS);
    else reset(end, layer);
  }

  const first = layers.values().next().value;
  if (first === undefined) return;
  isFirefox ??= getComputedStyle(first).getPropertyValue('-moz-user-select') === 'none';
  // Firefox resolves a drag into blank space well by itself; the DOM shuffle below is for Blink/WebKit.
  if (isFirefox) return;

  const range = selection.getRangeAt(0);
  const modifyStart =
    previousRange !== undefined &&
    (range.compareBoundaryPoints(Range.END_TO_END, previousRange) === 0 ||
      range.compareBoundaryPoints(Range.START_TO_END, previousRange) === 0);

  let anchor: Node = modifyStart ? range.startContainer : range.endContainer;
  if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode as Node;
  if (!modifyStart && range.endOffset === 0) {
    do {
      while (anchor.previousSibling === null) {
        if (anchor.parentNode === null) return;
        anchor = anchor.parentNode;
      }
      anchor = anchor.previousSibling;
    } while (anchor.childNodes.length === 0);
  }

  const parent = anchor.parentElement;
  const layer = parent?.closest<HTMLElement>('.papertree-text-layer') ?? null;
  const end = layer === null ? undefined : layers.get(layer);
  if (end !== undefined && layer !== null && parent !== null) {
    end.style.width = layer.style.width;
    end.style.height = layer.style.height;
    end.style.userSelect = 'text';
    parent.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
  }
  previousRange = range.cloneRange();
}

interface Candidate {
  readonly element: HTMLElement;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Where the selection's anchor (the end the drag started at) is on screen: its x and the vertical
 * middle of its line. A collapsed range has no client rects, so the character beside the offset is
 * measured instead.
 */
function anchorPoint(selection: Selection): { x: number; y: number } | null {
  const node = selection.anchorNode;
  if (node === null) return null;
  try {
    const range = document.createRange();
    const offset = selection.anchorOffset;
    let atEnd = false;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node as Text).data.length;
      if (length === 0) return null;
      atEnd = offset >= length;
      range.setStart(node, atEnd ? length - 1 : offset);
      range.setEnd(node, atEnd ? length : offset + 1);
    } else {
      range.selectNodeContents(node);
    }
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return { x: atEnd ? rect.right : rect.left, y: (rect.top + rect.bottom) / 2 };
  } catch {
    return null;
  }
}

/** UTF-16 offset in `node` nearest to a client point, clamped into the span's own box. */
function offsetAtPoint(node: Text, box: Candidate, x: number, y: number): number {
  const length = node.data.length;
  if (x >= box.right) return length;
  if (x <= box.left) return 0;
  const cx = Math.min(box.right - 0.5, Math.max(box.left + 0.5, x));
  const cy = Math.min(box.bottom - 1, Math.max(box.top + 1, y));
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(cx, cy);
  if (position && position.offsetNode === node) return position.offset;
  const range = doc.caretRangeFromPoint?.(cx, cy);
  if (range && range.startContainer === node) return range.startOffset;
  return Math.round(((x - box.left) / Math.max(1, box.right - box.left)) * length);
}

/**
 * Move the selection's focus to the text nearest a pointer that is over BLANK text-layer space.
 * Does nothing when the pointer is over text, outside any text layer, or there is no selection.
 */
export function snapFocusToText(clientX: number, clientY: number): void {
  const selection = document.getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.anchorNode === null) return;
  const hit = document.elementFromPoint(clientX, clientY);
  if (hit === null) return;
  let layer = hit.closest<HTMLElement>('.papertree-text-layer');
  if (layer !== null) {
    if (!layers.has(layer)) return;
    if (hit.closest('[data-item-index]') !== null) return;
  } else {
    // Past the edge of the page, on the desk beside it: a drag that overshoots still means "to the
    // end of the line I am level with". Only inside the reader's scroller, and only level with a page.
    if (hit.closest('[data-papertree-scroller]') === null || hit.closest('[role="toolbar"], [role="dialog"], button') !== null) return;
    for (const candidate of layers.keys()) {
      const box = candidate.getBoundingClientRect();
      if (clientY >= box.top && clientY <= box.bottom) {
        layer = candidate;
        break;
      }
    }
    if (layer === null) return;
  }

  const anchor = anchorPoint(selection);
  const forward = anchor === null ? true : clientY > anchor.y + 2 || (Math.abs(clientY - anchor.y) <= 2 && clientX >= anchor.x);

  const all: Candidate[] = [];
  layer.querySelectorAll<HTMLElement>('[data-item-index]').forEach((element) => {
    const node = element.firstChild;
    if (!(node instanceof Text) || node.data.trim().length === 0) return;
    const r = element.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    all.push({ element, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  });
  // A drag stays in its column: only text that overlaps the horizontal span between where the drag
  // started and where the pointer is can be a target. Text wholly outside that span is another
  // column (or the other side of the gutter), however close it is vertically.
  const lo = anchor === null ? clientX : Math.min(anchor.x, clientX) - 4;
  const hi = anchor === null ? clientX : Math.max(anchor.x, clientX) + 4;
  const eligible = anchor === null ? all : all.filter((c) => c.right >= lo && c.left <= hi);
  const pool = eligible.length > 0 ? eligible : all;
  if (pool.length === 0) return;

  let best: Candidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  // 1. level with a line: the nearest item on it.
  for (const c of pool) {
    if (clientY < c.top || clientY > c.bottom) continue;
    const dx = clientX < c.left ? c.left - clientX : clientX > c.right ? clientX - c.right : 0;
    if (dx < bestScore) {
      best = c;
      bestScore = dx;
    }
  }
  // 2. in a gap or past the text: the line before the pointer (dragging down) or after it (up).
  if (best === null) {
    for (const c of pool) {
      const before = c.bottom <= clientY;
      const after = c.top >= clientY;
      if (!before && !after) continue;
      const dy = before ? clientY - c.bottom : c.top - clientY;
      const dx = clientX < c.left ? c.left - clientX : clientX > c.right ? clientX - c.right : 0;
      const wrongSide = forward ? after : before;
      const score = dy * 4 + dx + (wrongSide ? 100000 : 0);
      if (score < bestScore) {
        best = c;
        bestScore = score;
      }
    }
  }
  if (best === null) return;
  const node = best.element.firstChild;
  if (!(node instanceof Text)) return;
  let offset = offsetAtPoint(node, best, clientX, clientY);
  // Below/above the line and beyond it: take the whole line, not a half-letter.
  if (clientY > best.bottom && forward) offset = clientX >= best.left && clientX < best.right ? offset : clientX >= best.right ? node.data.length : 0;
  if (selection.focusNode === node && selection.focusOffset === offset) return;
  try {
    selection.extend(node, offset);
  } catch {
    /* a selection that cannot be extended is left as the browser made it */
  }
}

function enableGlobalListeners(): void {
  if (globalAbort !== null) return;
  const controller = new AbortController();
  globalAbort = controller;
  const { signal } = controller;
  let pointerDown = false;
  let frame = 0;
  // A drag that began in a text layer and travelled: the only thing that may be snapped. A plain
  // click, or a press on a toolbar, must never grow a selection out of a stale caret.
  let dragging = false;
  let downAt: { x: number; y: number } | null = null;
  document.addEventListener(
    'pointerdown',
    (event) => {
      pointerDown = true;
      dragging = false;
      const target = event.target instanceof Element ? event.target : null;
      const inLayer = target?.closest('.papertree-text-layer') ?? null;
      downAt = inLayer !== null && event.button === 0 && !event.shiftKey ? { x: event.clientX, y: event.clientY } : null;
    },
    { signal },
  );
  // Live feedback while dragging: after the browser has applied its own selection for this move.
  document.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType === 'touch' || (event.buttons & 1) === 0 || !pointerDown) return;
      const { clientX, clientY } = event;
      if (downAt === null) return;
      if (Math.hypot(clientX - downAt.x, clientY - downAt.y) > 4) dragging = true;
      if (!dragging) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => snapFocusToText(clientX, clientY));
    },
    { signal },
  );
  document.addEventListener(
    'pointerup',
    (event) => {
      cancelAnimationFrame(frame);
      // The final word: before the reader's own pointerup handler reads the selection.
      if (pointerDown && dragging && event.pointerType !== 'touch') snapFocusToText(event.clientX, event.clientY);
      pointerDown = false;
      dragging = false;
      downAt = null;
      resetAll();
    },
    { signal, capture: true },
  );
  window.addEventListener(
    'blur',
    () => {
      pointerDown = false;
      resetAll();
    },
    { signal },
  );
  document.addEventListener(
    'keyup',
    () => {
      if (!pointerDown) resetAll();
    },
    { signal },
  );
  document.addEventListener('selectionchange', onSelectionChange, { signal });
}

/**
 * Give one rendered text layer its `endOfContent` and join the shared `selectionchange` handling.
 * Call after the layer's spans exist (a re-render empties the container). Returns the detach function.
 */
export function attachSelectionEnd(layer: HTMLElement): () => void {
  const end = document.createElement('div');
  end.className = END_CLASS;
  layer.append(end);

  const onMouseDown = (): void => layer.classList.add(SELECTING_CLASS);
  layer.addEventListener('mousedown', onMouseDown);
  layers.set(layer, end);
  enableGlobalListeners();

  return () => {
    layer.removeEventListener('mousedown', onMouseDown);
    layers.delete(layer);
    layer.classList.remove(SELECTING_CLASS);
    end.remove();
    if (layers.size === 0) {
      globalAbort?.abort();
      globalAbort = null;
      previousRange = undefined;
    }
  };
}
