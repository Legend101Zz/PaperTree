"""Citation links between the owner's own papers (``GET /library/links``, #194).

A link A -> B means: a bibliography entry of paper A names paper B, and B is also in the library.
It is DERIVED on every read from the parse (``papers.references_json`` + the entry text); nothing
is stored, so a re-parse or a delete is reflected at once, and a reference block id (a
parse-derived pointer) never lands in a user row.

Only citation links exist. A board is per paper and no board node can reference a second paper, so
there is no honest "linked on a board" source yet; ``via`` is therefore the single value
``"citation"`` and ``"board"`` is not in the enum until a cross-paper board exists (the Map shows
"Papers you linked on a board: none yet").

THE MATCHING RULES (exact; nothing fuzzy, no similarity score anywhere)

arXiv id   An entry carries an arXiv id equal to B's ``arxiv_id``. The id is the parser's
           ``Reference.arxiv_id`` or found in the entry text (``arXiv:1706.03762v5``,
           ``arxiv.org/abs/1706.03762``, old style ``arXiv:hep-th/9901001``); a ``vN`` suffix is
           dropped on both sides (``1706.03762v5`` = ``1706.03762``).
title      B's parsed title, normalised, appears in the entry:
             * a title of 4 or more words: as a contiguous run of whole words inside the
               normalised entry;
             * a title of fewer words: only as one WHOLE segment of the entry (the text between
               ``. ? ! ; , "``), so "Attention" cannot match every entry that says "attention".
           Normalising is NFKC (folds ligatures such as ``ﬁ`` and full-width forms), casefold,
           curly quotes and every other punctuation mark to a space, whitespace collapsed. A hyphen
           is tried both ways, as a space (``self-attention``) and removed (``im-age`` broken over
           a line is ``image``), on both sides; a match on either pairing counts.
Order      arXiv id wins over title when the same entry matches both ways.
Straddle   The parser sometimes cuts one bibliography entry into two consecutive blocks
           ("...Deep residual learning for im-" / "age recognition. In CVPR..."). A title of 4 or
           more words that exists in neither entry alone but runs across the join of two
           consecutive entries (a trailing hyphen glues the word) is a match of the first entry;
           its reported text is the two joined. This is what finds Attention -> ResNet.
Dedupe     At most one link per (A, B, ``matched_by``), from the first matching entry (by index).
           Never a link from a paper to itself.

A paper's title is its parsed ``metadata.title``; the upload's filename is never used (a filename
is not a title and would invent matches).

Cost: the title index maps a title's first word to its papers, so an entry is compared only with
titles that start at one of its words. A library of 400 papers with 60 entries each is about 24 000
entries and answers in well under a second (``test_links_scale``), so there is no cache.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final, Literal

from papertree_db import LinkReference, LinkSource

MatchedBy = Literal["arxiv_id", "title"]

#: A title shorter than this many words matches only as a whole entry segment.
MIN_RUN_WORDS: Final = 4

#: ``arXiv:1706.03762v5``, ``arXiv: 1706.03762``, ``arxiv.org/abs/1706.03762v5``.
_ARXIV_NEW = re.compile(
    r"arxiv(?:\.org/(?:abs|pdf)/|\s*:\s*)(\d{4}\.\d{4,5})(?:v\d+)?", re.IGNORECASE
)
#: Old style, ``arXiv:hep-th/9901001`` or ``arxiv.org/abs/hep-th/9901001``.
_ARXIV_OLD = re.compile(
    r"arxiv(?:\.org/(?:abs|pdf)/|\s*:\s*)([a-z]+(?:-[a-z]+)*(?:\.[a-z]{2})?/\d{7})(?:v\d+)?",
    re.IGNORECASE,
)
_VERSION = re.compile(r"v\d+$", re.IGNORECASE)
_SEGMENT_BREAK = re.compile(r"[.?!;,\"“”]")
_NOT_WORD = re.compile(r"[^\w]+|_+")
#: Hyphens and dashes that join or break a word.
_HYPHENS = "-‐‑‒­"
_HYPHEN_RUN = re.compile(f"[{_HYPHENS}]+")


@dataclass(frozen=True, slots=True)
class CitationLink:
    """One derived link: ``from_paper_id`` cites ``to_paper_id`` in its reference ``index``."""

    from_paper_id: str
    to_paper_id: str
    matched_by: MatchedBy
    #: Zero-based position of the matching entry in the citing paper's bibliography.
    reference_index: int
    reference_text: str


def normalise_arxiv_id(value: str | None) -> str | None:
    """An arXiv id without its ``vN`` suffix, lower-cased; None when empty.

    Args:
        value: ``1706.03762v5``, ``1706.03762`` or an old-style ``hep-th/9901001v2``.

    Returns:
        ``1706.03762`` for the first two, ``hep-th/9901001`` for the third.
    """
    if value is None:
        return None
    cleaned = _VERSION.sub("", value.strip().lower())
    return cleaned or None


def arxiv_ids_in(text: str) -> list[str]:
    """Every arXiv id a reference string names, without version suffixes, in order.

    Args:
        text: One bibliography entry.

    Returns:
        ``["1706.03762"]`` for "... arXiv preprint arXiv:1706.03762v5, 2017".
    """
    found = [(m.start(), m.group(1)) for m in _ARXIV_NEW.finditer(text)]
    found += [(m.start(), m.group(1)) for m in _ARXIV_OLD.finditer(text)]
    return [normalise_arxiv_id(value) or "" for _, value in sorted(found)]


def _words(text: str, hyphen: Literal["space", "join"]) -> list[str]:
    folded = unicodedata.normalize("NFKC", text).casefold()
    folded = _HYPHEN_RUN.sub(" " if hyphen == "space" else "", folded)
    return [w for w in _NOT_WORD.sub(" ", folded).split() if w]


def title_variants(title: str) -> list[tuple[str, ...]]:
    """A title as normalised word tuples: hyphens as spaces, and hyphens removed (when different).

    Args:
        title: A parsed paper title.

    Returns:
        One or two tuples of words; empty when the title has no word characters.
    """
    spaced, joined = tuple(_words(title, "space")), tuple(_words(title, "join"))
    out = [spaced] if spaced == joined else [spaced, joined]
    return [v for v in out if v]


def _contains_run(words: Sequence[str], run: tuple[str, ...]) -> bool:
    size = len(run)
    return any(tuple(words[i : i + size]) == run for i in range(len(words) - size + 1))


def title_in_entry(title: str, entry: str) -> bool:
    """Whether a paper's title is named by a bibliography entry (the rule in the module doc).

    Args:
        title: The cited paper's parsed title.
        entry: One reference entry's text.

    Returns:
        True for a contiguous whole-word run (titles of 4+ words) or a whole segment (shorter).
    """
    for run in title_variants(title):
        if len(run) >= MIN_RUN_WORDS:
            for hyphen in ("space", "join"):
                if _contains_run(_words(entry, hyphen), run):
                    return True
        elif any(
            tuple(_words(segment, hyphen)) == run
            for segment in _SEGMENT_BREAK.split(entry)
            for hyphen in ("space", "join")
        ):
            return True
    return False


def _entry_arxiv_ids(reference: LinkReference) -> set[str]:
    ids = set(arxiv_ids_in(reference.text))
    parsed = normalise_arxiv_id(reference.arxiv_id)
    if parsed:
        ids.add(parsed)
    return ids


def find_links(sources: Sequence[LinkSource]) -> list[CitationLink]:
    """The citation links among ``sources`` (one owner's promoted papers).

    Args:
        sources: ``PaperTreeDb.library_link_sources`` output; the caller passes ONE owner's papers
            only, which is what keeps another user's papers out of the answer.

    Returns:
        Links ordered by citing paper (input order), then cited paper, then arXiv id before title.
        Never a self-link; at most one per (citing, cited, matched_by).
    """
    by_arxiv: dict[str, list[str]] = {}
    by_first_word: dict[str, list[tuple[str, str, tuple[str, ...]]]] = {}
    for source in sources:
        arxiv = normalise_arxiv_id(source.arxiv_id)
        if arxiv:
            by_arxiv.setdefault(arxiv, []).append(source.paper_id)
        if source.title:
            for run in title_variants(source.title):
                if len(run) >= MIN_RUN_WORDS:
                    by_first_word.setdefault(run[0], []).append(
                        (source.paper_id, source.title, run)
                    )
    short = [
        (source.paper_id, source.title)
        for source in sources
        if source.title and any(len(v) < MIN_RUN_WORDS for v in title_variants(source.title))
    ]

    links: list[CitationLink] = []
    for citing in sources:
        found: dict[tuple[str, MatchedBy], CitationLink] = {}
        refs = citing.references
        alone = [_title_matches(ref.text, by_first_word, short) for ref in refs]
        for position, ref in enumerate(refs):  # document order: the first matching entry wins
            text, titles = ref.text, set(alone[position])
            if position + 1 < len(refs):
                # The parser sometimes cuts one bibliography entry into two blocks ("...for im-" /
                # "age recognition. In CVPR..."), so a title can straddle two consecutive entries.
                # Only a match that exists in NEITHER entry alone is taken from the pair, and it
                # belongs to the first entry (whose text is then shown joined to its tail).
                joined = _join_entries(ref.text, refs[position + 1].text)
                straddling = (
                    _title_matches(joined, by_first_word, ()) - titles - alone[position + 1]
                )
                if straddling:
                    titles |= straddling
                    text = joined
            by_id = {pid for aid in _entry_arxiv_ids(ref) for pid in by_arxiv.get(aid, ())}
            for pid in sorted(by_id):
                _record(found, citing.paper_id, pid, "arxiv_id", ref.index, ref.text)
            for pid in sorted(titles - by_id):
                _record(found, citing.paper_id, pid, "title", ref.index, text)
        links.extend(
            sorted(
                found.values(), key=lambda link: (link.to_paper_id, link.matched_by != "arxiv_id")
            )
        )
    return links


def _join_entries(first: str, second: str) -> str:
    """Two consecutive entries as one text; a trailing hyphen is a line-broken word (no space)."""
    head = first.rstrip()
    return (
        head + second.lstrip() if head.endswith(tuple(_HYPHENS)) else head + " " + second.lstrip()
    )


def _record(
    found: dict[tuple[str, MatchedBy], CitationLink],
    citing: str,
    cited: str,
    how: MatchedBy,
    index: int,
    text: str,
) -> None:
    """Keeps the first link per (cited, how); never one from a paper to itself."""
    if cited != citing and (cited, how) not in found:
        found[(cited, how)] = CitationLink(citing, cited, how, index, text)


def _title_matches(
    entry: str,
    by_first_word: dict[str, list[tuple[str, str, tuple[str, ...]]]],
    short: Sequence[tuple[str, str]],
) -> set[str]:
    """Paper ids whose title the entry names. Long titles via the first-word index."""
    matched: set[str] = set()
    for hyphen in ("space", "join"):
        words = _words(entry, hyphen)
        for i, word in enumerate(words):
            for pid, _title, run in by_first_word.get(word, ()):
                if tuple(words[i : i + len(run)]) == run:
                    matched.add(pid)
    for pid, title in short:
        if title_in_entry(title, entry):
            matched.add(pid)
    return matched
