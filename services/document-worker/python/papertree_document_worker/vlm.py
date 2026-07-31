"""The VLM boundary: flagged crops in, a proposed reading out. Never a source field.

WHAT THIS IS ALLOWED TO PRODUCE, AND WHAT IT IS NOT

`SourceKind` is `pdf_text_layer | pdf_vector | pdf_raster | ocr` and has **no model value, by
design** (DESIGN.md §2.2). A model's reading of a region is therefore never `Block.text` and
never a `source`. It is one of exactly two things:

  * a **`Repair`** with `kind: "vlm_substitution"`, `applied: false`, obliged to name its
    `model_id` and carry a `prompt_hash`; or
  * an **`Alternative`** with `authored_by: "model"`, obliged to be `not_selected`.

and `EquationPayload.latex` - which is a *declared interpretation* with its own confidence,
sitting beside a **required** `image` that is the ground truth (§11 residual risk 4). The crop is
always retained. If the LaTeX is wrong, the crop still says what the page says.

`prompt_hash` is what makes a proposal auditable rather than merely attributed, so the prompt is
a frozen constant in this module and is hashed with the model id and the decoding parameters. A
prompt that drifts silently would make two runs incomparable while both claiming the same hash.

WHY MINIMAX-M3

The project owner's decision, 2026-07-31. The endpoint is Anthropic-compatible, so this is
`x-api-key` + `anthropic-version` + the standard content-block shape and needs no SDK - stdlib
`urllib` only, which keeps the epic's new-dependency count at one (pymupdf).

**Only `MiniMax-M3` accepts an image block.** M2.7 / M2.5 / M2.1 / M2 are text-and-tool-calls
only. Separately, `apps/api/.env` already carries `OPENROUTER_MODEL=deepseek/deepseek-v3.2`,
which is a **text** model that would accept this call shape and return confident nonsense - so
this module never falls back to the app's configured LLM, and takes its model from its own
setting or not at all.

Measured 2026-07-31 on the `dh(t)/dt = f(h(t), t, theta)` display equation from
`neural-odes-mathheavy.pdf` p0: `\\frac{d\\mathbf{h}(t)}{dt} = f(\\mathbf{h}(t), t, \\theta)`,
correct including the bold `h`, in 3.5 s for 457 input + 23 output tokens. The extractor this
replaces produced `ht+1 = ht + f(ht, \\theta t)` for the same class of input - every subscript
lost (findings.md B2).

THE BUDGET IS A HARD STOP, NOT A TARGET

`VlmBudget` counts calls and refuses past its cap. A parser that silently spends per page is a
parser nobody can run on a 75-page paper, and the run cost has to be reportable in
`EPIC-01-RESULT.md`. Exhausting the budget is not an error: the equation keeps its crop and its
`latex` stays `None`, which is a completely valid document.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

__all__ = [
    "LATEX_PROMPT",
    "VlmBudget",
    "VlmClient",
    "VlmError",
    "VlmReading",
    "prompt_hash",
]

#: The endpoint. Anthropic-compatible, so no SDK and no new dependency.
DEFAULT_BASE_URL = "https://api.minimax.io/anthropic/v1/messages"
#: The ONLY MiniMax model that accepts an image block. See the module docstring.
DEFAULT_MODEL = "MiniMax-M3"
DEFAULT_TIMEOUT_SECONDS = 120.0

#: Frozen. Changing this changes `prompt_hash`, which is the point: two runs with different
#: prompts must not claim the same provenance.
LATEX_PROMPT = (
    "Transcribe this display equation as LaTeX. Output ONLY the LaTeX body - no surrounding "
    "$ or \\[ delimiters, no explanation, no markdown fence. If the image does not contain "
    "mathematics, output exactly: NOT_MATH"
)

#: The sentinel the prompt asks for. A VLM told to transcribe an image will transcribe
#: *something*, so it needs a way to say "this is not an equation" that is not prose.
NOT_MATH = "NOT_MATH"


class VlmError(RuntimeError):
    """A call failed. Callers keep the crop and leave `latex` unset - never a partial reading."""


@dataclass(slots=True)
class VlmBudget:
    """A hard cap on calls per run, so cost is bounded and reportable."""

    max_calls: int
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    seconds: float = 0.0

    @property
    def exhausted(self) -> bool:
        return self.calls >= self.max_calls

    def record(self, input_tokens: int, output_tokens: int, seconds: float) -> None:
        self.calls += 1
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens
        self.seconds += seconds


@dataclass(frozen=True, slots=True)
class VlmReading:
    """One model reading of one crop. A proposal, never a fact."""

    latex: str | None
    model_id: str
    prompt_hash: str
    #: Not a calibrated probability and not presented as one - see `_confidence`.
    confidence: float
    input_tokens: int
    output_tokens: int
    seconds: float

    @property
    def is_math(self) -> bool:
        return self.latex is not None


def prompt_hash(prompt: str, model: str, max_tokens: int) -> str:
    """A digest over everything that determines the output, not just the prompt string.

    The model id and the token cap are in it because the same prompt against a different model,
    or truncated at a different length, is a different experiment. Schema-shaped as
    `AlgoPrefixedHash` (`^[a-z0-9]+:[0-9a-f]{16,128}$`).
    """
    payload = json.dumps(
        {"prompt": prompt, "model": model, "max_tokens": max_tokens},
        sort_keys=True,
        ensure_ascii=False,
    )
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _confidence(latex: str) -> float:
    """A crude, deliberately coarse score for a transcription.

    There is no calibration set for this - PTUB Tier B gold does not exist - so a precise-looking
    number would be invented. These are round on purpose and their meaning is stated:

      0.70  balanced delimiters and at least one LaTeX command: a plausible transcription
      0.40  unbalanced braces, or no command at all: probably a partial read

    `EquationPayload.latex_confidence` carries it, and the crop remains the ground truth
    regardless. Revise this only alongside DESIGN.md's confidence mapping table.
    """
    if latex.count("{") != latex.count("}"):
        return 0.4
    return 0.7 if "\\" in latex else 0.4


class VlmClient:
    """Stdlib-only client for the Anthropic-compatible endpoint.

    `api_key` defaults to `$PAPERTREE_VLM_API_KEY`. There is deliberately **no fallback** to
    `OPENROUTER_API_KEY`: that account's configured model is text-only and would answer.
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        model: str = DEFAULT_MODEL,
        base_url: str = DEFAULT_BASE_URL,
        max_tokens: int = 512,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self.api_key = api_key if api_key is not None else os.environ.get("PAPERTREE_VLM_API_KEY")
        self.model = model
        self.base_url = base_url
        self.max_tokens = max_tokens
        self.timeout = timeout

    @property
    def available(self) -> bool:
        """Whether a call could be made at all. Callers check this and degrade, never crash."""
        return bool(self.api_key)

    @property
    def prompt_digest(self) -> str:
        return prompt_hash(LATEX_PROMPT, self.model, self.max_tokens)

    def read_equation(self, png: bytes, budget: VlmBudget) -> VlmReading | None:
        """Transcribe one crop, or return `None` when unavailable or out of budget.

        `None` is a normal outcome, not a failure: the equation keeps its crop and `latex` stays
        unset, which is a valid document. Only a genuine protocol error raises.
        """
        if not self.available or budget.exhausted:
            return None

        body = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": base64.b64encode(png).decode("ascii"),
                            },
                        },
                        {"type": "text", "text": LATEX_PROMPT},
                    ],
                }
            ],
        }
        request = urllib.request.Request(
            self.base_url,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-api-key": self.api_key or "",
                "anthropic-version": "2023-06-01",
            },
        )

        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as exc:  # pragma: no cover - needs a live endpoint
            raise VlmError(f"{exc.code} from {self.base_url}: {exc.read()[:400]!r}") from exc
        except OSError as exc:  # pragma: no cover - network
            raise VlmError(f"{type(exc).__name__}: {exc}") from exc
        elapsed = time.perf_counter() - started

        usage = payload.get("usage") or {}
        input_tokens = int(usage.get("input_tokens", 0))
        output_tokens = int(usage.get("output_tokens", 0))
        budget.record(input_tokens, output_tokens, elapsed)

        text = "".join(
            part.get("text", "") for part in payload.get("content", ()) if isinstance(part, dict)
        ).strip()
        latex = _clean(text)
        return VlmReading(
            latex=latex,
            model_id=str(payload.get("model") or self.model),
            prompt_hash=self.prompt_digest,
            confidence=_confidence(latex) if latex else 0.0,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            seconds=elapsed,
        )


def _clean(text: str) -> str | None:
    """Strip the wrappers a chat model adds however firmly it is told not to.

    Not a LaTeX validator - it removes markdown fences and `$`/`\\[` delimiters and nothing else.
    Rewriting the body would make the stored `latex` something no model actually said, which is
    the opposite of the point.
    """
    if not text:
        return None
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = [line for line in stripped.splitlines() if not line.strip().startswith("```")]
        stripped = "\n".join(lines).strip()
    for opener, closer in (("$$", "$$"), ("\\[", "\\]"), ("$", "$")):
        if (
            stripped.startswith(opener)
            and stripped.endswith(closer)
            and len(stripped) > len(opener) + len(closer)
        ):
            stripped = stripped[len(opener) : -len(closer)].strip()
            break
    if not stripped or stripped == NOT_MATH:
        return None
    return stripped
