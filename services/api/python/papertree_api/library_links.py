"""Citation links between the owner's own papers (``GET /library/links``, #194).

A link A -> B means: a bibliography entry of paper A cites paper B, and B is also in the library.
It is DERIVED on every read from the parse (``papers.references_json`` + the entry text); nothing
is stored, so a re-parse or a delete is reflected at once, and a reference block id (a
parse-derived pointer) never lands in a user row.

Only citation links exist. A board is per paper and no board node can reference a second paper, so
there is no honest "linked on a board" source yet; ``via`` is therefore the single value
``"citation"`` and ``"board"`` is not in the enum until a cross-paper board exists (the Map shows
"Papers you linked on a board: none yet").

THE MATCHING RULES (exact; nothing fuzzy, no similarity score anywhere)

arXiv id   An entry carries an arXiv id equal to B's ``arxiv_id``: the parser's
           ``Reference.arxiv_id`` or one found in the entry text (``arXiv:1706.03762v5``,
           ``arxiv.org/abs/1706.03762``, ``10.48550/arXiv.1706.03762``, old style
           ``arXiv:hep-th/9901001``). A ``vN`` suffix is dropped on both sides, and the id must be
           the whole digit run (``1706.037621`` is not ``1706.03762``).
title      B's parsed title, normalised, EQUALS the entry's TITLE SEGMENT, whatever its length.
           Never a run of words found somewhere in the entry, so a longer title that starts with
           B's ("Attention is all you need for graphs"), prose that mentions it, and a venue line
           ("... Attention Is All You Need Workshop Track") do not link.
             * The entry is split into sentences at ``. ? !`` followed by whitespace, except after
               an initial (``J.``), ``vs``, ``no``, ``pp``, ``vol``, ``ed(s)``, or when the next
               letter is lower case.
             * The title segment is the first sentence after the first one (the author block) that
               is not just a year; or the tail of the first sentence after its last initial
               (``... Polosukhin I. Title``, Vancouver style); or, when the entry quotes it
               (``"..."`` or curly quotes), the quoted text. Each is a whole-segment candidate;
               punctuation is ignored. An entry that opens with its title and has no author block
               is not matched.
             * Normalising is NFKC (folds ligatures such as ``\ufb01``), casefold, every punctuation
               mark to a space, whitespace collapsed. A hyphen is tried both ways, as a space and
               removed (``im-age`` broken over a line is ``image``), on both sides.
Straddle   The parser sometimes cuts one bibliography entry into two consecutive blocks
           ("...Deep residual learning for im-" / "age recognition. In CVPR..."). Two consecutive
           entries are joined only when the first ends in a hyphen-broken word (``[a-z]-``; no space
           is inserted) or has no sentence-final punctuation while the second starts lower case. A
           title found only in the join is a match of the first entry; its reported text is the two
           joined. This is what finds Attention -> ResNet.
Dedupe     One link per (A, B): arXiv id when any entry matched it, else title from the first
           matching entry (by index). Never a link from a paper to itself.

A paper's title is its parsed ``metadata.title``; the upload's filename is never used. A parser
title that is boilerplate (a running header) will match entries that really have that title
segment: that is a parser defect this module does not hide.

Cost: each entry is split and normalised once, and titles are looked up in a dict keyed by the
normalised word tuple, so matching is about O(entries); measured numbers are in
``test_links_scale`` (400 papers x 60 entries). There is no cache.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final, Literal

from papertree_db import LinkReference, LinkSource

MatchedBy = Literal["arxiv_id", "title"]

#: ``arXiv:1706.03762v5``, ``arXiv: 1706.03762``, ``arxiv.org/abs/1706.03762v5``, the DOI form
#: ``10.48550/arXiv.1706.03762``. ``(?!\d)``: a longer digit run is not a shorter id.
_ARXIV_PREFIX = r"(?:arxiv(?:\.org/(?:abs|pdf)/|\s*:\s*)|10\.48550/arxiv\.)"
_ARXIV_NEW = re.compile(_ARXIV_PREFIX + r"(\d{4}\.\d{4,5})(?:v\d+)?(?!\d)", re.IGNORECASE)
#: Old style, ``arXiv:hep-th/9901001`` or ``arxiv.org/abs/hep-th/9901001``.
_ARXIV_OLD = re.compile(
    _ARXIV_PREFIX + r"([a-z]+(?:-[a-z]+)*(?:\.[a-z]{2})?/\d{7})(?:v\d+)?(?!\d)", re.IGNORECASE
)
_VERSION = re.compile(r"v\d+$", re.IGNORECASE)
_NOT_WORD = re.compile(r"[^\w]+|_+")
#: Hyphens and dashes that join or break a word.
_HYPHENS = "-\u2010\u2011\u2012\u00ad"
_HYPHEN_RUN = re.compile(f"[{_HYPHENS}]+")
_SENTENCE_END = re.compile(r"[.?!]\s+")
#: Words whose period is not a sentence end (an initial is any single letter).
_ABBREVIATIONS: Final = frozenset({"vs", "no", "pp", "vol", "ed", "eds", "approx"})
_INITIAL_BREAK = re.compile(r"(?<![A-Za-z])[A-Za-z]\.\s+")
_QUOTED = re.compile(r"[\u201c\"]([^\u201d\"]{3,}?)[\u201d\"]")
_YEAR_ONLY = re.compile(r"\W*(?:19|20)\d\d[a-z]?\W*", re.IGNORECASE)
_HYPHEN_BROKEN = re.compile(r"[A-Za-z][" + _HYPHENS + r"]$")
_SENTENCE_FINAL = '.?!"\u201d'

WordKey = tuple[str, ...]


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


def _words(text: str, hyphen: Literal["space", "join"]) -> WordKey:
    folded = unicodedata.normalize("NFKC", text).casefold()
    folded = _HYPHEN_RUN.sub(" " if hyphen == "space" else "", folded)
    return tuple(w for w in _NOT_WORD.sub(" ", folded).split() if w)


def title_keys(text: str) -> list[WordKey]:
    """Normalised word tuples of a title or a candidate segment.

    Hyphens become spaces in one tuple and are removed in the other (when that differs).

    Args:
        text: A parsed paper title, or one segment of a reference entry.

    Returns:
        One or two non-empty tuples; empty when the text has no word characters.
    """
    spaced, joined = _words(text, "space"), _words(text, "join")
    return [k for k in ((spaced,) if spaced == joined else (spaced, joined)) if k]


def _sentences(entry: str) -> list[str]:
    """Split the entry at sentence ends.

    Not after an initial or abbreviation, nor before a lower-case letter:
    ``"K. He, and J. Sun. Deep learning. In CVPR, 2016."`` is three sentences.
    """
    out: list[str] = []
    start = 0
    for match in _SENTENCE_END.finditer(entry):
        before = entry[start : match.start()].split()
        token = before[-1].strip("()[]\"'\u201c\u201d") if before else ""
        following = entry[match.end() : match.end() + 1]
        if (len(token) == 1 and token.isalpha()) or token.lower() in _ABBREVIATIONS:
            continue
        if following.islower():
            continue
        out.append(entry[start : match.start()])
        start = match.end()
    out.append(entry[start:])
    return [part.strip() for part in out if part.strip()]


def title_candidates(entry: str) -> list[str]:
    """The entry's title segment(s), by the rules in the module docstring.

    Quoted text, the tail of the author block after its last initial, and the first later sentence
    that is not only a year.

    Args:
        entry: One reference entry's text (or two joined, see ``_join_entries``).

    Returns:
        Zero to two raw strings; none for an entry with no author block before its title.
    """
    found = [m.group(1) for m in _QUOTED.finditer(entry)]
    sentences = _sentences(entry)
    # Vancouver style ends the author block with an initial ("... Polosukhin I. Title."), which
    # _sentences does not split after: the title is then the tail of the first sentence.
    initials = list(_INITIAL_BREAK.finditer(sentences[0])) if sentences else []
    if initials:
        tail = sentences[0][initials[-1].end() :]
        if any(c.isalpha() for c in tail):
            found.append(tail)
    for sentence in sentences[1:]:
        if any(c.isalpha() for c in sentence) and not _YEAR_ONLY.fullmatch(sentence):
            found.append(sentence)
            break
    return found


def title_in_entry(title: str, entry: str) -> bool:
    """Whether a paper's title equals the entry's title segment (the rule in the module doc).

    Args:
        title: The cited paper's parsed title.
        entry: One reference entry's text.

    Returns:
        True when the normalised title equals a normalised title segment of the entry.
    """
    wanted = set(title_keys(title))
    return any(k in wanted for c in title_candidates(entry) for k in title_keys(c))


def _entry_arxiv_ids(reference: LinkReference) -> set[str]:
    ids = set(arxiv_ids_in(reference.text))
    parsed = normalise_arxiv_id(reference.arxiv_id)
    if parsed:
        ids.add(parsed)
    return ids


def _join_entries(first: str, second: str) -> str | None:
    """Two consecutive entries as one text when the parser plausibly cut ONE entry in two.

    That is when the first ends in a hyphen-broken word (joined with no space), or has no
    sentence-final punctuation while the second starts lower case. Otherwise None.
    """
    head, tail = first.rstrip(), second.lstrip()
    if not head or not tail:
        return None
    if _HYPHEN_BROKEN.search(head):
        return head + tail
    if head[-1] not in _SENTENCE_FINAL and tail[0].islower():
        return head + " " + tail
    return None


def _matches(entry: str, titles: dict[WordKey, list[str]]) -> set[str]:
    """Paper ids whose normalised title equals one of the entry's title segments."""
    return {
        pid for c in title_candidates(entry) for k in title_keys(c) for pid in titles.get(k, ())
    }


def find_links(sources: Sequence[LinkSource]) -> list[CitationLink]:
    """The citation links among ``sources`` (one owner's promoted papers).

    Args:
        sources: ``PaperTreeDb.library_link_sources`` output; the caller passes ONE owner's papers
            only, which is what keeps another user's papers out of the answer.

    Returns:
        Links in citing-paper input order, then cited-paper id. Never a self-link; at most one per
        (citing, cited), arXiv id preferred over title.
    """
    by_arxiv: dict[str, list[str]] = {}
    titles: dict[WordKey, list[str]] = {}
    for source in sources:
        arxiv = normalise_arxiv_id(source.arxiv_id)
        if arxiv:
            by_arxiv.setdefault(arxiv, []).append(source.paper_id)
        for key in title_keys(source.title or ""):
            titles.setdefault(key, []).append(source.paper_id)

    links: list[CitationLink] = []
    for citing in sources:
        found: dict[str, CitationLink] = {}
        refs = citing.references
        alone = [_matches(ref.text, titles) for ref in refs]
        for position, ref in enumerate(refs):  # document order: the first matching entry wins
            text, matched = ref.text, set(alone[position])
            if position + 1 < len(refs):
                joined = _join_entries(ref.text, refs[position + 1].text)
                if joined is not None:
                    # A title only the join contains belongs to the first entry.
                    straddling = _matches(joined, titles) - matched - alone[position + 1]
                    if straddling:
                        matched |= straddling
                        text = joined
            by_id = {pid for aid in _entry_arxiv_ids(ref) for pid in by_arxiv.get(aid, ())}
            for pid in by_id:
                _record(found, citing.paper_id, pid, "arxiv_id", ref.index, ref.text)
            for pid in matched - by_id:
                _record(found, citing.paper_id, pid, "title", ref.index, text)
        links.extend(sorted(found.values(), key=lambda link: link.to_paper_id))
    return links


def _record(
    found: dict[str, CitationLink],
    citing: str,
    cited: str,
    how: MatchedBy,
    index: int,
    text: str,
) -> None:
    """Keep one link per cited paper, never one from a paper to itself.

    An arXiv link replaces a title link; otherwise the first link wins.
    """
    if cited == citing:
        return
    have = found.get(cited)
    if have is None or (how == "arxiv_id" and have.matched_by == "title"):
        found[cited] = CitationLink(citing, cited, how, index, text)
