"""Signed asset URLs (contracts.md §2.3): how an `<img>` loads a crop without a Bearer header.

    sig = base64url(HMAC-SHA256(PAPERTREE_SIGNING_SECRET,
                                "{paper_id}|{gen}|{kind}|{block_id}|{exp}"))

`exp` is a Unix time one hour ahead. `base64url` is RFC 4648 §5 WITHOUT padding (43 characters
for a 32-byte MAC): it goes in a query string, where `=` would need escaping.

WHY THIS EXISTS. The parser stores crops as opaque `asset://<paper>/<gen>/<kind>/<block>@3x.png`
URIs (`crops.py`: baking a host into an immutable, content-addressed document would make every
stored generation wrong the day the host changes). A browser cannot load that scheme, and an
`<img>` cannot send `Authorization: Bearer`. So `GET /papers/{id}/ir` rewrites every such URI, at
serve time, into an absolute URL of `GET /papers/{id}/assets/{kind}/{block_id}` carrying a
signature for exactly that one object, valid for an hour. The stored document is never changed.

WHAT THE SIGNATURE IS WORTH. It stands in for the Bearer for ONE object: the MAC covers the paper,
the generation, the kind, the block and the expiry, so changing any of them invalidates it, and the
asset route still resolves the paper's owner (`PaperTreeDb.asset_grant`) and reads through the
owner-scoped queries. The secret is `PAPERTREE_SIGNING_SECRET`, or random per boot (then signed URLs
die with the process; the reader re-fetches `/ir`). The query string is never logged
(`logging.py`: a route is its template).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
from collections.abc import Callable
from typing import Any, Final
from urllib.parse import urlencode

#: contracts.md §2.3: "`exp` is a Unix time 1 h ahead".
SIGNED_URL_SECONDS: Final = 3600

#: The kinds `crops.py` writes, and so the only ones the asset route serves.
ASSET_KINDS: Final = frozenset({"figures", "equations"})

#: The one URI shape the asset route can serve: `crops.crop_uri` at the default 3x scale, for a
#: `ppr_` paper and a `blk_` block (the id patterns `papertree_document_ir` enforces).
ASSET_URI: Final = re.compile(
    r"asset://(?P<paper_id>ppr_[0-9A-HJKMNP-TV-Z]{26})/(?P<gen>[1-9][0-9]{0,18})"
    r"/(?P<kind>figures|equations)/(?P<block_id>blk_[a-z2-7]{16})@3x\.png"
)
_SIGNATURE: Final = re.compile(r"[A-Za-z0-9_-]{43}")
_UNIX_TIME: Final = re.compile(r"[0-9]{1,12}")


def sign(secret: str, paper_id: str, gen: int, kind: str, block_id: str, exp: int) -> str:
    message = f"{paper_id}|{gen}|{kind}|{block_id}|{exp}".encode()
    mac = hmac.new(secret.encode(), message, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).rstrip(b"=").decode("ascii")


def verify(
    secret: str,
    *,
    paper_id: str,
    gen: int | None,
    kind: str,
    block_id: str,
    exp: str | None,
    sig: str | None,
    now: float,
) -> bool:
    """Whether `?gen=&exp=&sig=` is a live signature for exactly this object. Never raises: a
    malformed parameter is simply not a valid signature (the caller answers 401)."""
    if gen is None or exp is None or sig is None:
        return False
    if _UNIX_TIME.fullmatch(exp) is None or _SIGNATURE.fullmatch(sig) is None:
        return False
    if int(exp) <= now:
        return False
    expected = sign(secret, paper_id, gen, kind, block_id, int(exp))
    return hmac.compare_digest(expected, sig)


def signed_url(
    base_url: str,
    secret: str,
    *,
    paper_id: str,
    gen: int,
    kind: str,
    block_id: str,
    exp: int,
) -> str:
    """The absolute URL of one crop, signed until `exp`. `base_url` ends with `/`."""
    query = urlencode(
        {"gen": gen, "exp": exp, "sig": sign(secret, paper_id, gen, kind, block_id, exp)}
    )
    return f"{base_url}papers/{paper_id}/assets/{kind}/{block_id}?{query}"


def rewrite_asset_uris(
    document: Any, *, paper_id: str, url_for: Callable[[int, str, str], str]
) -> int:
    """Replaces, IN PLACE, every string in `document` that is exactly a servable `asset://` URI of
    THIS paper with `url_for(gen, kind, block_id)`. Returns how many it replaced.

    Every string, not a list of known fields: `payload.image.uri` today, and wherever the next
    field that holds a crop puts it. Only an EXACT match is touched, so prose that mentions
    `asset://` is left alone, and a URI naming another paper is never signed (the signature is a
    grant, and this response is about this paper only).
    """
    replaced = 0

    def walk(node: Any) -> Any:
        nonlocal replaced
        if isinstance(node, str):
            found = ASSET_URI.fullmatch(node)
            if found is None or found["paper_id"] != paper_id:
                return node
            replaced += 1
            return url_for(int(found["gen"]), found["kind"], found["block_id"])
        if isinstance(node, dict):
            for key, value in node.items():
                node[key] = walk(value)
        elif isinstance(node, list):
            for index, value in enumerate(node):
                node[index] = walk(value)
        return node

    walk(document)
    return replaced
