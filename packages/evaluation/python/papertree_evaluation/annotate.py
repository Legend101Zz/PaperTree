"""The gold-annotation tool: a local HTML page over rendered pages, per F1.9.

WHY THIS EXISTS AND WHAT IT UNBLOCKS. `benchmarks/README.md` §7 lists gold annotations as
*"not started — the critical path item; ~60 expert-hours"* and closes with *"No parser
selection is authorised until Tier B gold exists."* Everything about the zero-ML-vs-Docling
decision is downstream of somebody being able to actually produce gold, and F1.9's brief is
explicit: *"Includes a minimal annotation UI (a local HTML page over page images is fine) so
gold data is actually producible."*

THREE THINGS THE DESIGN IS DELIBERATE ABOUT

  * **The annotator draws on a rendered page image, not on parser output.** §2: "Annotation is
    done against the rendered page image at 150 DPI with PDF-space coordinates recorded, so
    annotations are independent of any parser." Pre-filling boxes from this epic's parser would
    make the gold agree with the parser by construction - the exact bias the decision rule was
    written in advance to prevent.
  * **Stratified page sampling, not the first N.** §1.2: "First-10-pages sampling systematically
    over-weights introductions, which are the easiest pages in any paper." The quota is 1 first
    page, 2 dense two-column body, 1 equation-dense, 1 figure-dominant, 1 table-dominant, 1
    references, 1 appendix, 2 random.
  * **It writes the schema §2 already specifies**, not a new one - `gold_id`, `type`, `bbox` in
    PDF user space with origin top-left, `reading_order` (null for anything not in the body
    flow), `flow`, `parent`, `text`, `continues_from`/`continues_to`.

The page renders at 150 DPI, so the browser-to-PDF transform is a single divide by
`150/72 = 2.0833…`. That constant is written into the page rather than inferred, because a
wrong scale silently produces gold that no parser can ever match.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from papertree_evaluation.normalise import CANONICAL_FLOW

__all__ = ["GOLD_TYPES", "AnnotationTask", "build_annotator", "stratified_pages"]

#: §2's type vocabulary, "deliberately identical to PaperIR block types so gold data is directly
#: comparable to parser output".
GOLD_TYPES = (
    "title",
    "author",
    "affiliation",
    "abstract",
    "heading",
    "paragraph",
    "list",
    "equation",
    "inline_equation",
    "figure",
    "table",
    "table_cell",
    "algorithm",
    "code",
    "caption",
    "footnote",
    "citation",
    "reference_entry",
    "header",
    "footer",
    "page_number",
    "margin_note",
    "unknown",
)

#: §2: gold is annotated against a 150 DPI render. PDF user space is 72 dpi, so one CSS pixel of
#: the image is 72/150 pt. Written down rather than derived in the browser.
GOLD_DPI = 150.0
PDF_POINTS_PER_INCH = 72.0
IMAGE_SCALE = GOLD_DPI / PDF_POINTS_PER_INCH


@dataclass(frozen=True, slots=True)
class AnnotationTask:
    paper: str
    page_index: int
    image_path: Path
    width_pt: float
    height_pt: float


def stratified_pages(page_count: int, quota: int = 10) -> list[int]:
    """§1.2's stratified sample, degraded gracefully for short papers.

    The full quota needs per-page content classification (equation-dense, figure-dominant,
    table-dominant), which the ANNOTATOR is better placed to judge than a parser - using the
    parser to pick the pages would re-introduce the bias the whole design avoids. So this
    returns an evenly spread sample including the first page and the last, and the guide asks
    the annotator to swap pages to fill the quota.

    Even spread rather than the first N, because §1.2 is explicit that first-N over-weights
    introductions.
    """
    if page_count <= quota:
        return list(range(page_count))
    picks = {0, page_count - 1}
    step = (page_count - 1) / (quota - 1)
    picks.update(round(index * step) for index in range(quota))
    return sorted(picks)[:quota]


def _page_html(task: AnnotationTask) -> str:
    return (
        f'<section class="page" data-paper="{task.paper}" data-page="{task.page_index}" '
        f'data-width="{task.width_pt}" data-height="{task.height_pt}">'
        f"<h2>{task.paper} — page {task.page_index}</h2>"
        f'<div class="canvas"><img src="{task.image_path.name}" alt="page {task.page_index}">'
        f'<div class="overlay"></div></div></section>'
    )


def build_annotator(tasks: list[AnnotationTask], destination: Path) -> Path:
    """Write a single self-contained HTML file that produces §2-shaped gold JSON.

    No build step, no server, no dependency: F1.9 says "a local HTML page over page images is
    fine", and the constraint that actually matters is that a human can open it and start.
    """
    destination.parent.mkdir(parents=True, exist_ok=True)
    pages = "\n".join(_page_html(task) for task in tasks)
    options = "\n".join(f'<option value="{name}">{name}</option>' for name in GOLD_TYPES)
    # The SAME table `normalise.py` applies server-side, shipped into the page so the tool and
    # the normaliser cannot drift apart. Imported here rather than duplicated as a JS literal:
    # two copies of this mapping is exactly how the flow field went wrong in the first place.
    canonical_flow = json.dumps({name: CANONICAL_FLOW[name] for name in GOLD_TYPES})

    html = f"""<!doctype html>
<meta charset="utf-8">
<title>PTUB gold annotation</title>
<style>
 body {{ font: 14px/1.5 system-ui, sans-serif; margin: 2rem; background: #fafafa; }}
 .canvas {{ position: relative; display: inline-block; border: 1px solid #ccc; }}
 .canvas img {{ display: block; max-width: 100%; }}
 .overlay {{ position: absolute; inset: 0; }}
 .box {{ position: absolute; border: 2px solid #d33; background: rgba(221,51,51,.12); }}
 .box b {{ position: absolute; top: -1.4em; left: 0; font-size: 11px; background: #d33;
           color: #fff; padding: 0 4px; white-space: nowrap; }}
 /* A region loaded from a previous pass that is still missing the field its type needs.
    Amber rather than red so "what is left to do" is answerable by scrolling, not by counting. */
 .box.needs {{ border-color: #f0ad4e; background: rgba(240,173,78,.18); }}
 .box.needs b {{ background: #f0ad4e; color: #3b2c06; }}
 .box.sel {{ border-color: #2563eb; background: rgba(37,99,235,.18); }}
 .box.sel b {{ background: #2563eb; }}
 .box.done {{ border-color: #16a34a; background: rgba(22,163,74,.10); }}
 .box.done b {{ background: #16a34a; }}
 .overlay.editing .box {{ cursor: pointer; }}
 #editor {{ display: none; background: #eff6ff; border: 1px solid #bfdbfe; padding: .5rem .75rem;
            margin-top: .5rem; }}
 #editor.on {{ display: block; }}
 .bar {{ position: sticky; top: 0; background: #fff; padding: .75rem; border: 1px solid #ddd;
         z-index: 10; margin-bottom: 1rem; }}
 .hint {{ font-size: 12px; color: #64748b; margin-left: .35rem; }}
 .extra {{ margin-left: .75rem; padding-left: .75rem; border-left: 1px solid #e3e3e3; }}
 details.help {{ background: #fff; border: 1px solid #ddd; padding: .75rem 1rem;
                 margin-bottom: 1rem; }}
 details.help summary {{ cursor: pointer; font-weight: 600; }}
 details.help table {{ border-collapse: collapse; margin: .6rem 0; font-size: 13px; }}
 details.help td, details.help th {{ border: 1px solid #e3e3e3; padding: .25rem .5rem;
                                     text-align: left; vertical-align: top; }}
 details.help code {{ background: #f4f4f4; padding: 0 .25rem; }}
 .warn {{ background: #fff8e1; border-left: 3px solid #f0ad4e; padding: .5rem .75rem;
          margin: .6rem 0; }}
 button {{ margin-left: .5rem; }}
 section.page {{ margin-bottom: 3rem; }}
</style>

<details class="help" open>
<summary>How to mark a region — read once, then collapse</summary>

<div class="warn"><b>FLOW matters more than TYPE.</b> Flow decides whether a region gets a
<code>reading_order</code>. Only <code>body</code> is ranked; everything else is
nulled, which is what stops a parser being punished for correctly leaving furniture
out of the reading order.
Get the flow right even if you are unsure of the type.</div>

<b>Pick the flow first</b>

<table>
<tr><th>flow</th><th>use for</th></tr>
<tr><td><code>body</code></td><td>the paper itself — title, authors, headings,
  paragraphs, equations, tables, lists. <b>Draw these in reading order</b>
  (left column fully, then right).</td></tr>
<tr><td><code>caption</code></td><td>anything starting "Figure 3." / "Table 1:"</td></tr>
<tr><td><code>footnote</code></td><td>an asterisked or numbered note — <i>content</i>, usually at
  the page bottom above a rule</td></tr>
<tr><td><code>header</code> / <code>footer</code></td><td>page <i>furniture</i> repeated across
  pages — running head, page number, conference/copyright line</td></tr>
<tr><td><code>margin</code></td><td>the rotated arXiv stamp down the left edge</td></tr>
<tr><td><code>float</code></td><td>a figure or table that sits outside the text column</td></tr>
</table>

<b>Then the type</b>

<table>
<tr><th>type</th><th>use for</th></tr>
<tr><td><code>title</code></td><td>the paper's title, once</td></tr>
<tr><td><code>author</code></td><td>the names line/block</td></tr>
<tr><td><code>affiliation</code></td><td><b>who the authors belong to</b> — "Google Brain",
  "University of Toronto". Near the top, part of the author block.</td></tr>
<tr><td><code>abstract</code></td><td>the abstract's TEXT (the word "Abstract" itself is a
  <code>heading</code>)</td></tr>
<tr><td><code>heading</code></td><td>a section heading — "1 Introduction", "Abstract",
  "References"</td></tr>
<tr><td><code>paragraph</code></td><td>ordinary body prose. One box per paragraph, <b>not per
  line</b>.</td></tr>
<tr><td><code>equation</code></td><td>a display equation set on its own line(s)</td></tr>
<tr><td><code>figure</code></td><td>the figure INCLUDING its axis labels and interior text, but
  NOT its caption</td></tr>
<tr><td><code>table</code></td><td>the table body. Add <code>table_cell</code> boxes only on a
  page where you want cell-level scoring.</td></tr>
<tr><td><code>caption</code></td><td>the caption text, its own box, never part of
  the figure</td></tr>
<tr><td><code>footnote</code></td><td>the note text</td></tr>
<tr><td><code>footer</code>/<code>header</code>/<code>page_number</code></td>
  <td>furniture</td></tr>
<tr><td><code>margin_note</code></td><td>the arXiv stamp</td></tr>
<tr><td><code>reference_entry</code></td><td>one entry in the bibliography</td></tr>
<tr><td><code>unknown</code></td><td><b>when unsure.</b> Better than a wrong type —
  a wrong label makes a correct parser look wrong.</td></tr>
</table>

<b>The three that are easy to confuse</b>
<table>
<tr><th>looks like</th><th>it is</th><th>because</th></tr>
<tr><td>"Google Brain" under the authors</td><td><code>affiliation</code> / body</td>
  <td>it says who the authors are</td></tr>
<tr><td>"∗Equal contribution. Jakob proposed…"</td><td><code>footnote</code> / footnote</td>
  <td>it is content the paper is making a point with</td></tr>
<tr><td>"31st Conference on NIPS 2017, Long Beach"</td><td><code>footer</code> / footer</td>
  <td>it is furniture — the venue notice, not the paper</td></tr>
</table>

<b>Two more rules</b><br>
• One box per <i>logical region</i>, not per line — a five-line paragraph is ONE box.<br>
• A two-column page should end up with roughly 8–20 regions. Hundreds means you boxed lines.
</details>

<div class="bar">
  <label>type <select id="type">{options}</select></label>
  <label>flow
    <select id="flow">
      <option>body</option><option>caption</option><option>footnote</option>
      <option>header</option><option>footer</option><option>margin</option><option>float</option>
    </select>
  </label>
  <span id="flowhint" class="hint">follows the type</span>
  <button id="undo">undo</button>
  <button id="download">download gold JSON</button>
  <span id="count">0 regions</span>
  <!-- The two fields whose absence made two of §4.1's four metrics unmeasurable on the first
       pass. Both are cheap to collect while drawing and impossible to recover afterwards. -->
  <label id="vectorwrap" class="extra"><input type="checkbox" id="isvector">
    vector figure <span class="hint">drawn, not a photo</span></label>
  <label id="parentwrap" class="extra">describes
    <select id="parent"><option value="">— pick the figure/table —</option></select></label>
  <!-- RESUME. Without this, adding `is_vector` and `parent` to gold that already exists means
       redrawing every region by hand - 249 of them on the first pass, which is the whole
       annotation budget spent again to fill in two fields. The tool could only ever download. -->
  <label class="extra">reopen
    <input type="file" id="loadgold" accept="application/json,.json"></label>
  <button id="jump" style="display:none">next unfilled →</button>
  <span id="todo" class="hint"></span>
  <div id="editor">
    <b id="edittitle">region</b>
    <label id="editvectorwrap"><input type="checkbox" id="editvector"> vector figure
      <span class="hint">drawn, not a photo</span></label>
    <label id="editparentwrap">describes
      <select id="editparent"><option value="">— pick the figure/table —</option></select></label>
    <button id="editclose">done</button>
    <span class="hint">click any box to edit it; only these two fields change</span>
  </div>
</div>

{pages}

<script>
// PDF user space is 72 dpi and the images are rendered at {GOLD_DPI}. One image pixel is
// therefore {PDF_POINTS_PER_INCH}/{GOLD_DPI} pt. Written in rather than guessed: a wrong scale
// produces gold that no parser can ever match, and nothing downstream would reveal why.
const SCALE = {IMAGE_SCALE};
const regions = [];

// `gold_id` is a GLOBAL counter across every page, not per-page - the existing gold runs r00 to
// r248 across 18 pages. Reloading has to continue that sequence rather than restart it, or a
// second pass mints ids that collide with the first.
let nextId = 0;
const elFor = new Map();          // gold_id -> the box element, so a region can be restyled
const pageMeta = new Map();       // "paper:page" -> {{annotator, minutes_spent, notes}}, preserved

function idOf(n) {{ return 'r' + String(n).padStart(2, '0'); }}

// A region is "unfilled" when its type demands a field the first pass could not collect.
function needsWork(r) {{
  if (r.type === 'figure') return r.is_vector === null || r.is_vector === undefined;
  if (r.type === 'caption') return !r.parent;
  return false;
}}

function paint(r) {{
  const el = elFor.get(r.gold_id);
  if (!el) return;
  el.classList.toggle('needs', needsWork(r));
  el.classList.toggle('done', !needsWork(r) && (r.type === 'figure' || r.type === 'caption'));
  el.querySelector('b').textContent = r.gold_id + ' ' + r.type
    + (r.type === 'figure' && r.is_vector != null ? (r.is_vector ? ' ·vector' : ' ·raster') : '')
    + (r.type === 'caption' && r.parent ? ' →' + r.parent : '');
}}

function refreshTodo() {{
  const left = regions.filter(needsWork).length;
  document.getElementById('todo').textContent =
    regions.length + ' regions' + (left ? ' · ' + left + ' still need a field' : '');
  document.getElementById('count').textContent = regions.length + ' regions';
  document.getElementById('jump').style.display = left ? '' : 'none';
}}

// THE FLOW SELECT FOLLOWS THE TYPE SELECT.
//
// The first real annotation pass came back with 55 of 249 regions whose flow contradicted their
// type - page numbers in the body flow, a run of thirteen figures on `caption`. The cause was
// this pair of controls being INDEPENDENT and STICKY: pick a type, forget the flow, and the
// region inherits whatever the previous one left behind. The annotator never sees the mismatch
// because only the type is drawn on the box.
//
// So flow is now DERIVED, using the same table `normalise.py` applies server-side. It stays a
// select rather than becoming a read-only field: `float` is a real choice for a figure that sits
// outside the text column, and a deliberate override is worth keeping. Touching it just stops
// the auto-follow until the type changes again, and the hint says which mode it is in.
const CANONICAL_FLOW = {canonical_flow};
let flowOverridden = false;

const typeSelect = document.getElementById('type');
const flowSelect = document.getElementById('flow');
const flowHint = document.getElementById('flowhint');

function syncFlow() {{
  const canonical = CANONICAL_FLOW[typeSelect.value];
  if (canonical && !flowOverridden) flowSelect.value = canonical;
  flowHint.textContent = flowOverridden
    ? 'overridden — reset by changing type' : 'follows the type';
  flowHint.style.color = flowOverridden ? '#b45309' : '#64748b';
}}
// `is_vector` only means anything on a figure, and `parent` only on a caption. Showing them
// unconditionally invites the same mistake the flow select made: a control that is always
// present is a control that carries the previous region's answer into this one.
const vectorWrap = document.getElementById('vectorwrap');
const parentWrap = document.getElementById('parentwrap');
const parentSelect = document.getElementById('parent');

function syncExtras() {{
  const kind = typeSelect.value;
  vectorWrap.style.display = kind === 'figure' ? '' : 'none';
  parentWrap.style.display = kind === 'caption' ? '' : 'none';
  if (kind !== 'figure') document.getElementById('isvector').checked = false;
  if (kind !== 'caption') parentSelect.value = '';
}}

function refreshParents(paper, page) {{
  // Only floats ON THIS PAGE, because a caption never describes a float on another one.
  const floats = regions.filter(r => r.paper === paper && r.page === page
    && ['figure', 'table', 'algorithm'].includes(r.type));
  const chosen = parentSelect.value;
  parentSelect.innerHTML = '<option value="">— pick the figure/table —</option>'
    + floats.map(r => '<option value="' + r.gold_id + '">' + r.gold_id + ' ' + r.type
                      + '</option>').join('');
  parentSelect.value = chosen;
}}

typeSelect.addEventListener('change', () => {{
  flowOverridden = false; syncFlow(); syncExtras();
}});
flowSelect.addEventListener('change', () => {{
  flowOverridden = flowSelect.value !== CANONICAL_FLOW[typeSelect.value];
  syncFlow();
}});
syncFlow();
syncExtras();

function toPdf(box, img) {{
  // The image may be displayed smaller than its natural size; normalise through naturalWidth
  // so the recorded coordinates do not depend on the browser window.
  const factor = img.naturalWidth / img.clientWidth;
  const pts = [box.x * factor / SCALE, box.y * factor / SCALE,
               (box.x + box.w) * factor / SCALE, (box.y + box.h) * factor / SCALE];
  return pts.map(v => +v.toFixed(2));
}}

document.querySelectorAll('.canvas').forEach(canvas => {{
  const img = canvas.querySelector('img');
  const overlay = canvas.querySelector('.overlay');
  const page = canvas.closest('.page');
  let start = null, live = null;

  overlay.addEventListener('mousedown', e => {{
    const r = overlay.getBoundingClientRect();
    start = {{ x: e.clientX - r.left, y: e.clientY - r.top }};
    live = document.createElement('div');
    live.className = 'box';
    overlay.appendChild(live);
  }});
  overlay.addEventListener('mousemove', e => {{
    if (!start) return;
    const r = overlay.getBoundingClientRect();
    const x = Math.min(start.x, e.clientX - r.left), y = Math.min(start.y, e.clientY - r.top);
    const w = Math.abs(e.clientX - r.left - start.x), h = Math.abs(e.clientY - r.top - start.y);
    Object.assign(live.style, {{ left: x+'px', top: y+'px', width: w+'px', height: h+'px' }});
    live._box = {{ x, y, w, h }};
  }});
  overlay.addEventListener('mouseup', () => {{
    if (!start || !live || !live._box || live._box.w < 4 || live._box.h < 4) {{
      if (live) live.remove(); start = null; live = null; return;
    }}
    const type = document.getElementById('type').value;
    const flow = document.getElementById('flow').value;
    const bodyCount = regions.filter(r => r.paper === page.dataset.paper
      && r.page === +page.dataset.page && r.flow === 'body').length;
    const region = {{
      paper: page.dataset.paper,
      page: +page.dataset.page,
      page_size: {{ width: +page.dataset.width, height: +page.dataset.height }},
      gold_id: idOf(nextId++),
      type, flow,
      bbox: toPdf(live._box, img),
      // §2: reading_order ranks ONLY the body flow. Captions, footnotes and page furniture get
      // null and their own flow, so a parser is not punished for correctly EXCLUDING a footnote.
      reading_order: flow === 'body' ? bodyCount : null,
      // THE TWO FIELDS THE FIRST PASS COULD NOT SUPPLY.
      //
      // `is_vector` carries §4.1's isolated vector-figure recall - the metric that exists
      // because findings.md B3 measured BOTH old extractors finding 0 of ResNet's figures, all
      // of which are vector ink. `parent` carries caption association. Neither can be recovered
      // after the fact: inferring a caption's float from proximity would score the parser's own
      // caption heuristic against a copy of itself, and no amount of re-reading the PDF tells
      // you whether the annotator considered a figure to be drawn or photographed.
      is_vector: type === 'figure' ? document.getElementById('isvector').checked : null,
      parent: document.getElementById('parent').value || null,
      text: '', continues_from: null, continues_to: null
    }};
    regions.push(region);
    live.innerHTML = '<b></b>';
    elFor.set(region.gold_id, live);
    live._region = region;
    attachEditor(live, region);
    paint(region);
    refreshTodo();
    refreshParents(region.paper, region.page);
    // A caption's `parent` select has to be populated from the floats on THIS page, and it is
    // only correct after the region exists. Reading it at draw time - as the toolbar copy does -
    // means the first caption drawn on a page reads a list built for the previous page. So the
    // editor opens on the region just drawn and the link is chosen after, not before.
    if (region.type === 'caption' || region.type === 'figure') live.click();
    start = null; live = null;
  }});
}});

document.getElementById('undo').onclick = () => {{
  const last = regions.pop();
  if (!last) return;
  elFor.get(last.gold_id)?.remove();
  elFor.delete(last.gold_id);
  refreshTodo();
}};

// ---------------------------------------------------------------- reopening a previous pass

// Boxes restored from a file are positioned as a PERCENTAGE of the page, computed from the
// recorded bbox and the page's own point size. Deliberately not via the image's pixel metrics:
// those depend on the image having finished loading and on the window width, and a box that is
// placed before `naturalWidth` is known lands silently in the wrong spot.
function placeRestored(region, pageEl) {{
  const W = +pageEl.dataset.width, H = +pageEl.dataset.height;
  const [x0, y0, x1, y1] = region.bbox;
  const el = document.createElement('div');
  el.className = 'box';
  el.innerHTML = '<b></b>';
  Object.assign(el.style, {{
    left: (100 * x0 / W) + '%', top: (100 * y0 / H) + '%',
    width: (100 * (x1 - x0) / W) + '%', height: (100 * (y1 - y0) / H) + '%'
  }});
  pageEl.querySelector('.overlay').appendChild(el);
  el._region = region;
  elFor.set(region.gold_id, el);
  attachEditor(el, region);
  paint(region);
}}

document.getElementById('loadgold').addEventListener('change', async event => {{
  const file = event.target.files[0];
  if (!file) return;
  let parsed;
  try {{ parsed = JSON.parse(await file.text()); }}
  catch (err) {{ alert('Not JSON: ' + err.message); return; }}
  if (!Array.isArray(parsed)) {{ alert('Expected the array-of-pages gold format.'); return; }}

  regions.length = 0; nextId = 0; elFor.clear(); pageMeta.clear();
  document.querySelectorAll('.box').forEach(b => b.remove());

  let restored = 0, orphaned = [];
  for (const page of parsed) {{
    const key = page.paper_id + ':' + page.page;
    pageMeta.set(key, {{ annotator: page.annotator || '', minutes_spent: page.minutes_spent || 0,
                        notes: page.notes || '' }});
    const pageEl = document.querySelector(
      'section.page[data-paper="' + page.paper_id + '"][data-page="' + page.page + '"]');
    for (const raw of (page.regions || [])) {{
      const region = Object.assign({{
        paper: page.paper_id, page: page.page, page_size: page.page_size,
        is_vector: null, parent: null, text: '', continues_from: null, continues_to: null
      }}, raw);
      const n = parseInt(String(region.gold_id).replace(/^r/, ''), 10);
      if (!Number.isNaN(n)) nextId = Math.max(nextId, n + 1);
      regions.push(region);
      // A page in the file that this bundle did not render still has to survive the round trip.
      // Dropping it would silently delete gold, so it is kept and reported, just not drawn.
      if (pageEl) {{ placeRestored(region, pageEl); restored++; }}
      else orphaned.push(key);
    }}
  }}
  refreshTodo();
  const missing = [...new Set(orphaned)];
  alert('Reopened ' + regions.length + ' regions; ' + restored + ' drawn.\\n'
    + regions.filter(needsWork).length + ' still need is_vector or parent (amber).'
    + (missing.length ? '\\n\\nNot in this bundle, kept but not shown: ' + missing.join(', ')
        + '\\nRe-run annotate with the same --papers/--pages to edit those.' : ''));
}});

// ------------------------------------------------------------------- editing one loaded region

let editing = null;
const editor = document.getElementById('editor');
const editVector = document.getElementById('editvector');
const editParent = document.getElementById('editparent');

function attachEditor(el, region) {{
  el.addEventListener('click', event => {{
    event.stopPropagation();
    // Only the two retrofit fields are editable. Type, flow, bbox and reading_order are what the
    // annotator actually drew; a second pass that can silently retype them is a second pass that
    // can quietly rewrite the benchmark.
    if (region.type !== 'figure' && region.type !== 'caption') return;
    if (editing) elFor.get(editing.gold_id)?.classList.remove('sel');
    editing = region;
    el.classList.add('sel');
    editor.classList.add('on');
    document.getElementById('edittitle').textContent = region.gold_id + ' ' + region.type;
    document.getElementById('editvectorwrap').style.display =
      region.type === 'figure' ? '' : 'none';
    document.getElementById('editparentwrap').style.display =
      region.type === 'caption' ? '' : 'none';
    editVector.checked = region.is_vector === true;
    const floats = regions.filter(r => r.paper === region.paper && r.page === region.page
      && ['figure', 'table', 'algorithm'].includes(r.type));
    editParent.innerHTML = '<option value="">— pick the figure/table —</option>'
      + floats.map(r => '<option value="' + r.gold_id + '">' + r.gold_id + ' ' + r.type
                        + '</option>').join('');
    editParent.value = region.parent || '';
    // No scrollIntoView here. The editor lives in the sticky bar and is always on screen, and
    // scrolling to it actively fights `next unfilled`, which has just scrolled to the region.
  }});
}}

editVector.addEventListener('change', () => {{
  if (!editing || editing.type !== 'figure') return;
  editing.is_vector = editVector.checked;
  paint(editing); refreshTodo();
}});
editParent.addEventListener('change', () => {{
  if (!editing || editing.type !== 'caption') return;
  editing.parent = editParent.value || null;
  paint(editing); refreshTodo();
}});
document.getElementById('editclose').onclick = () => {{
  if (editing) elFor.get(editing.gold_id)?.classList.remove('sel');
  editing = null; editor.classList.remove('on');
}};

document.getElementById('jump').onclick = () => {{
  const next = regions.find(needsWork);
  if (!next) return;
  const el = elFor.get(next.gold_id);
  if (!el) {{ alert('The next unfilled region is on a page this bundle did not render.'); return; }}
  el.scrollIntoView({{ block: 'center', behavior: 'smooth' }});
  el.click();
}};

document.getElementById('download').onclick = () => {{
  const left = regions.filter(needsWork).length;
  if (left && !confirm(left + ' regions still need is_vector or parent. Download anyway?')) return;
  const byPage = {{}};
  for (const r of regions) {{
    const key = r.paper + ':' + r.page;
    const meta = pageMeta.get(key) || {{ annotator: '', minutes_spent: 0, notes: '' }};
    (byPage[key] ||= {{ paper_id: r.paper, page: r.page, page_size: r.page_size,
                        regions: [], ...meta }})
      .regions.push((({{ paper, page, page_size, ...rest }}) => rest)(r));
  }}
  const blob = new Blob([JSON.stringify(Object.values(byPage), null, 2)],
                        {{ type: 'application/json' }});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ptub-gold.json';
  a.click();
}};

refreshTodo();
</script>
"""
    destination.write_text(html, encoding="utf-8")
    return destination


def render_pages(pdf_path: Path, pages: list[int], destination: Path) -> list[AnnotationTask]:
    """Render the sampled pages at 150 DPI beside the annotator."""
    from papertree_document_worker.pdf import pymupdf

    destination.mkdir(parents=True, exist_ok=True)
    document = pymupdf.open(str(pdf_path))
    tasks: list[AnnotationTask] = []
    try:
        for index in pages:
            page = document[index]
            pixmap = page.get_pixmap(dpi=int(GOLD_DPI))
            image = destination / f"{pdf_path.stem}-p{index:03d}.png"
            image.write_bytes(pixmap.tobytes("png"))
            tasks.append(
                AnnotationTask(
                    paper=pdf_path.stem,
                    page_index=index,
                    image_path=image,
                    width_pt=round(float(page.rect.width), 2),
                    height_pt=round(float(page.rect.height), 2),
                )
            )
    finally:
        document.close()
    return tasks


def write_manifest(tasks: list[AnnotationTask], destination: Path) -> None:
    """Record which pages were sampled, so a later run can be compared against the same set."""
    destination.write_text(
        json.dumps(
            [
                {
                    "paper": t.paper,
                    "page": t.page_index,
                    "image": t.image_path.name,
                    "width_pt": t.width_pt,
                    "height_pt": t.height_pt,
                }
                for t in tasks
            ],
            indent=2,
        ),
        encoding="utf-8",
    )
