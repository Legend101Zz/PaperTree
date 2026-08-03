# The Docling probe environment

`research/benchmarks/README.md` row 5. This file is what `packages/evaluation`'s
`pyproject.toml` and `adapters.py`'s `unavailable` message both point at, and until #100 it
did not exist — so the one instruction a session got when the comparison arm was missing
pointed at nothing.

Docling is an **opt-in comparison arm**. It is not a dependency of this repo in any form and
it must never become one. It lives in a venv outside the repo and outside `$HOME`, and the
harness reaches it through one interpreter path.

---

## Where it is, and how the harness finds it

```
/Volumes/Mrigesh SSD/papertree-docling/
├── .venv/          the probe interpreter
├── uv-cache/       uv's package cache, pinned here too
├── README.md       the source this file was transcribed from
└── install.log     the resolution, kept as the record of what was pulled in
```

`packages/evaluation/python/papertree_evaluation/adapters.py`:

```python
DOCLING_PYTHON_ENV     = "PAPERTREE_DOCLING_PYTHON"
DEFAULT_DOCLING_PYTHON = "/Volumes/Mrigesh SSD/papertree-docling/.venv/bin/python"
```

**`$PAPERTREE_DOCLING_PYTHON` is the override** and it is the only knob. Point it at any
interpreter that can `import docling`; the default above is used when it is unset. The path is
absolute and machine-specific on purpose — this is a probe environment, not a deliverable, and
pretending otherwise would put it in the lock file.

When the interpreter is absent the adapter reports **`unavailable`** and the harness records
**"not run"** as an outcome *distinct from* "scored 0". That distinction is the point: a
missing comparison arm must never read as a comparison the arm lost.

---

## Recreate it

```bash
export UV_CACHE_DIR="/Volumes/Mrigesh SSD/papertree-docling/uv-cache"
uv venv --python 3.12 "/Volumes/Mrigesh SSD/papertree-docling/.venv"
VIRTUAL_ENV="/Volumes/Mrigesh SSD/papertree-docling/.venv" uv pip install docling
```

Verify, and **re-derive the version rather than trusting this file**:

```bash
"/Volumes/Mrigesh SSD/papertree-docling/.venv/bin/python" -c "import docling; print(docling.__version__)"
```

### What that resolves to, measured

| | |
|---|---|
| `docling.__version__` | **2.117.0** |
| interpreter | CPython **3.12.8** |
| distributions installed in the venv | **101** |
| `.venv` on disk | **1.1 GB** |
| `uv-cache/` on disk | **1.1 GB** |

`adapters.py` hard-codes `version = "2.117.0"` on `DoclingAdapter`. **If your rebuild resolves
a different version, that string is now a lie and must be updated** — a results table
attributing numbers to 2.117.0 that were produced by something else is worse than no table.
`docling` is unpinned in the install command above, so this *will* drift.

`findings.md` §E says "~1.4 GB with docling". Re-derived today it is **1.1 GB for the venv
alone and ~2.2 GB with the uv cache**. Budget the larger number.

---

## Why it is outside the repo AND outside `~`

Two separate reasons. Both were paid for.

- **uv locks a dependency group whether or not it installs it.** This is the one that matters,
  and it is why Docling is absent from `packages/evaluation/python/pyproject.toml` in *every*
  form — not a dependency, not an optional extra, not a dependency-group. **Measured: one
  `docling>=2.0` line took the workspace `uv.lock` from 22 packages to 100+**, including
  `xlsxwriter` and `websockets`, for a benchmark row that runs at most once per epic. Every
  `uv sync` in the repo, and every CI run, would then resolve torch, onnxruntime and
  transformers. (Re-derived today: the workspace lock is **42** packages and the probe venv
  resolves **101** on its own. The 22 was the count when the measurement was taken; the shape
  of the finding is unchanged and the ratio is what the argument rests on.)
- **The boot volume is small and this stack is not.** When the environment was created the
  internal disk had **14 GiB** free against the SSD's **649 GiB**. Re-derived today: **30 GiB**
  free on `/` against **648 GiB** on the SSD. Both the venv and uv's cache live on the SSD so
  the torch/onnxruntime download never touches the boot volume — hence `UV_CACHE_DIR` in the
  recreate block, which is easy to omit and silently writes ~1.1 GB to `~/.cache/uv` if you do.

This is the pattern `findings.md` §E already established for probe environments, and
`AGENTS.md` §3's rule applies unchanged: **work on the SSD, and if `/Volumes/Mrigesh SSD` is
not mounted, stop.** Unmounted, it is an ordinary directory on the system disk, so the recreate
commands above would fill the wrong volume under a path that looks correct.

---

## How the arm actually runs

`packages/evaluation/python/papertree_evaluation/docling_bridge.py` is executed **by the probe
venv's interpreter**, as a subprocess, and imports nothing from PaperTree — the probe venv has
Docling and its ~100 transitive dependencies and none of this repo's packages. It prints a small
JSON summary of counts on stdout rather than the document, because a full `DoclingDocument` is
megabytes of JSON crossing a pipe.

```bash
uv run python -m papertree_evaluation speed --with-docling --quiesced
```

Without `--with-docling` no ratio exists and the harness says so rather than reporting one.

`DoclingAdapter`'s timeout is **1800 s per paper**: `research/benchmarks/README.md` §4.5 defines
a timeout as >120 s/page, and 1800 s covers a 15-page paper at Docling's measured 19 s/page
(`findings.md` H2) with margin while still terminating a hang. Timeouts are counted separately
from crashes, per §4.5.

---

## What a Docling number does and does not mean

`AGENTS.md` §4, carried here because this is where someone will read a Docling score: **the gold
set measures, it does not authorise.** 442 regions, 36 pages, 6 of 8 corpus papers, **one
annotator, no inter-annotator agreement**. Docling's own absolute F1 against this gold is
**0.168–0.308** — a mature converter scoring 0.28 says the boxing conventions differ from *both*
parsers, not that both parsers are bad. Read the comparison as a ratio between arms measured the
same way, never as an absolute grade.
