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

interface Caret {
  readonly node: Text;
  readonly offset: number;
}

/**
 * The text layer a pointer position belongs to, and whether the pointer is over a text item.
 * `null` when the position is not on a page (a toolbar, a dialog, outside the reader). Past the edge
 * of a page, on the desk beside it, the layer is the one whose page the pointer is level with: a
 * drag that overshoots still means "to the end of the line I am level with".
 */
function layerUnder(
  clientX: number,
  clientY: number,
): { readonly layer: HTMLElement; readonly overText: boolean; readonly onPage: boolean } | null {
  const hit = document.elementFromPoint(clientX, clientY);
  if (hit === null) return null;
  const layer = hit.closest<HTMLElement>('.papertree-text-layer');
  if (layer !== null) {
    if (!layers.has(layer)) return null;
    return { layer, overText: hit.closest('[data-item-index]') !== null, onPage: true };
  }
  // Only inside the reader's scroller, and only level with a page.
  if (
    hit.closest('[data-papertree-scroller]') === null ||
    hit.closest('[role="toolbar"], [role="dialog"], button') !== null
  )
    return null;
  for (const candidate of layers.keys()) {
    const box = candidate.getBoundingClientRect();
    if (clientY >= box.top && clientY <= box.bottom)
      return { layer: candidate, overText: false, onPage: false };
  }
  return null;
}

/** Every non-empty item of one layer, with its box. */
function candidatesOf(layer: HTMLElement): Candidate[] {
  const all: Candidate[] = [];
  layer.querySelectorAll<HTMLElement>('[data-item-index]').forEach((element) => {
    const node = element.firstChild;
    if (!(node instanceof Text) || node.data.trim().length === 0) return;
    const r = element.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    // Text set along a margin (the arXiv stamp) is a tall, thin box that spans every line beside
    // it: a pointer in the margin is "level with" it for the whole page. It is never a line.
    if (r.height > 60 && r.height > r.width * 1.5) return;
    all.push({ element, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  });
  return all;
}

/**
 * The item a pointer over BLANK space means. Level with a line: the nearest item on it. In a gap or
 * past the text: the line before the pointer (dragging down) or after it (dragging up).
 */
function nearestItem(
  pool: readonly Candidate[],
  clientX: number,
  clientY: number,
  forward: boolean,
): Candidate | null {
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
  if (best !== null) return best;
  // 2. in a gap or past the text.
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
  return best;
}

/** The offset in `best` for a pointer that is over blank space near it. */
function caretIn(
  best: Candidate,
  clientX: number,
  clientY: number,
  forward: boolean,
): Caret | null {
  const node = best.element.firstChild;
  if (!(node instanceof Text)) return null;
  let offset = offsetAtPoint(node, best, clientX, clientY);
  // Below/above the line and beyond it: take the whole line, not a half-letter.
  if (clientY > best.bottom && forward)
    offset =
      clientX >= best.left && clientX < best.right
        ? offset
        : clientX >= best.right
          ? node.data.length
          : 0;
  return { node, offset };
}

/** The caret under a pointer that is over a text item (what the browser itself would choose). */
function caretUnder(clientX: number, clientY: number): Caret | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(clientX, clientY);
  if (position && position.offsetNode instanceof Text)
    return { node: position.offsetNode, offset: position.offset };
  const range = doc.caretRangeFromPoint?.(clientX, clientY);
  if (range && range.startContainer instanceof Text)
    return { node: range.startContainer, offset: range.startOffset };
  return null;
}

/**
 * Where a drag or Shift+click that STARTS or EXTENDS over blank space should put its anchor: the
 * nearest text, with no column to respect yet (the drag has not started). `null` when the pointer
 * is over text (the browser's own choice is right) or not on a page.
 */
export function caretNearBlank(clientX: number, clientY: number): Caret | null {
  const under = layerUnder(clientX, clientY);
  if (under === null || under.overText) return null;
  const pool = candidatesOf(under.layer);
  const best = nearestItem(pool, clientX, clientY, true);
  return best === null ? null : caretIn(best, clientX, clientY, true);
}

/**
 * Move the selection's focus to the text nearest a pointer that is over BLANK text-layer space.
 * Does nothing when the pointer is over text (unless `force`: the drag's anchor was set here, so the
 * browser's own extension cannot be trusted), outside any text layer, or there is no selection.
 * Returns whether the selection was extended.
 */
export function snapFocusToText(clientX: number, clientY: number, force = false): boolean {
  const selection = document.getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.anchorNode === null)
    return false;
  const under = layerUnder(clientX, clientY);
  if (under === null) return false;
  if (under.overText && !force) return false;
  const layer = under.layer;

  const extendTo = (caret: Caret): boolean => {
    if (selection.focusNode === caret.node && selection.focusOffset === caret.offset) return true;
    try {
      selection.extend(caret.node, caret.offset);
      return true;
    } catch {
      /* a selection that cannot be extended is left as the browser made it */
      return false;
    }
  };
  if (under.overText) {
    const caret = caretUnder(clientX, clientY);
    return caret === null ? false : extendTo(caret);
  }

  const anchor = anchorPoint(selection);
  const forward =
    anchor === null
      ? true
      : clientY > anchor.y + 2 || (Math.abs(clientY - anchor.y) <= 2 && clientX >= anchor.x);

  const all = candidatesOf(layer);
  // A drag stays in its column: only text that overlaps the horizontal span between where the drag
  // started and where the pointer is can be a target. Text wholly outside that span is another
  // column (or the other side of the gutter), however close it is vertically.
  const lo = anchor === null ? clientX : Math.min(anchor.x, clientX) - 4;
  const hi = anchor === null ? clientX : Math.max(anchor.x, clientX) + 4;
  const eligible = anchor === null ? all : all.filter((c) => c.right >= lo && c.left <= hi);
  const pool = eligible.length > 0 ? eligible : all;
  if (pool.length === 0) return false;

  const best = nearestItem(pool, clientX, clientY, forward);
  if (best === null) return false;
  const caret = caretIn(best, clientX, clientY, forward);
  return caret === null ? false : extendTo(caret);
}

/**
 * A drag that BEGAN in blank space, or a Shift+click: the browser guesses the anchor (or the
 * extension) from the text layer's DOM order, and the guess is wrong for blank space just as it is
 * for the end of a drag. These carry the anchor we choose instead.
 */
interface OwnedStart {
  /** Where the selection's anchor must be: snapped from the press (drag), or the one it had (Shift). */
  readonly anchor: Caret;
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
  let owned: OwnedStart | null = null;

  /** Put the selection where we mean it to be for a pointer at (x, y), then snap its focus there. */
  const apply = (x: number, y: number): void => {
    const selection = document.getSelection();
    if (selection === null) return;
    if (owned === null) {
      snapFocusToText(x, y);
      return;
    }
    const before =
      selection.focusNode !== null
        ? { node: selection.focusNode, offset: selection.focusOffset }
        : null;
    try {
      selection.setBaseAndExtent(
        owned.anchor.node,
        owned.anchor.offset,
        owned.anchor.node,
        owned.anchor.offset,
      );
    } catch {
      owned = null;
      return;
    }
    if (!snapFocusToText(x, y, true) && before !== null) {
      // Not on a page (a toolbar, past the reader): keep what the browser had extended to.
      try {
        selection.extend(before.node, before.offset);
      } catch {
        /* leave the collapsed selection */
      }
    }
  };

  document.addEventListener(
    'pointerdown',
    (event) => {
      pointerDown = true;
      dragging = false;
      owned = null;
      const target = event.target instanceof Element ? event.target : null;
      const inLayer = target?.closest('.papertree-text-layer') ?? null;
      const primary = inLayer !== null && event.button === 0 && event.pointerType !== 'touch';
      downAt =
        inLayer !== null && event.button === 0 && !event.shiftKey
          ? { x: event.clientX, y: event.clientY }
          : null;
      if (!primary || event.detail > 1) return;
      const selection = document.getSelection();
      if (event.shiftKey) {
        // Shift+click extends the selection the reader already has. Into blank space the browser
        // chooses the extension from DOM order; the anchor is kept and the focus snapped.
        if (
          selection === null ||
          selection.rangeCount === 0 ||
          !(selection.anchorNode instanceof Text)
        )
          return;
        const host = selection.anchorNode.parentElement?.closest('.papertree-text-layer');
        if (host === null || host === undefined) return;
        if (caretNearBlank(event.clientX, event.clientY) === null) return;
        owned = { anchor: { node: selection.anchorNode, offset: selection.anchorOffset } };
        const { clientX, clientY } = event;
        // After the browser's own handling of this press, before the next paint.
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => apply(clientX, clientY));
        return;
      }
      const anchor = caretNearBlank(event.clientX, event.clientY);
      if (anchor !== null) owned = { anchor };
    },
    { signal, capture: true },
  );
  // Live feedback while dragging: after the browser has applied its own selection for this move.
  document.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType === 'touch' || (event.buttons & 1) === 0 || !pointerDown) return;
      const { clientX, clientY } = event;
      if (downAt === null && owned === null) return;
      if (downAt !== null && Math.hypot(clientX - downAt.x, clientY - downAt.y) > 4)
        dragging = true;
      if (!dragging && owned === null) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => apply(clientX, clientY));
    },
    { signal },
  );
  document.addEventListener(
    'pointerup',
    (event) => {
      cancelAnimationFrame(frame);
      // The final word: before the reader's own pointerup handler reads the selection.
      if (pointerDown && (dragging || owned !== null) && event.pointerType !== 'touch')
        apply(event.clientX, event.clientY);
      pointerDown = false;
      dragging = false;
      downAt = null;
      owned = null;
      resetAll();
    },
    { signal, capture: true },
  );
  window.addEventListener(
    'blur',
    () => {
      pointerDown = false;
      owned = null;
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
