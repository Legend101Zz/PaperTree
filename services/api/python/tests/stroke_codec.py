"""A Python twin of the web's ``encodeStroke`` (stroke.ts), for the notebook stroke tests.

It builds blobs for sizes no fixture file should hold (20,000 points at the coordinate extremes).
It is held to the real encoder, not trusted: ``test_notebook_api`` asserts it reproduces the bytes
in ``fixtures/stroke_blobs.json``, which ``fixtures/make_stroke_blobs.ts`` wrote with the TS code.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Final

QUANT: Final = 16


def _varint(n: int) -> bytes:
    out = bytearray()
    while n >= 0x80:
        out.append((n % 0x80) | 0x80)
        n //= 0x80
    out.append(n)
    return bytes(out)


def _zigzag(n: int) -> int:
    return n * 2 if n >= 0 else -n * 2 - 1


def encode_stroke(points: Sequence[tuple[float, float, float]], *, has_pressure: bool) -> bytes:
    """The bytes ``encodeStroke`` writes: ``[1, flags, varint n]`` then zigzag-varint x/y deltas
    at 1/16 unit and, with pressure, one byte per point.

    Args:
        points: ``(x, y, pressure)`` in page units, pressure 0..1.
        has_pressure: Whether a pressure byte follows each point.

    Returns:
        The blob. ``Math.round`` is ``floor(v + 0.5)``, which is what is used here.
    """
    out = bytearray([1, 1 if has_pressure else 0]) + _varint(len(points))
    px = py = 0
    for x, y, p in points:
        qx, qy = math.floor(x * QUANT + 0.5), math.floor(y * QUANT + 0.5)
        out += _varint(_zigzag(qx - px)) + _varint(_zigzag(qy - py))
        if has_pressure:
            out.append(math.floor(min(1.0, max(0.0, p)) * 255 + 0.5))
        px, py = qx, qy
    return bytes(out)
