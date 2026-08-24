"""Profiler factory — dispatches to the right profiler based on modality.

Phase 2 extends this to add PdfProfiler, ImageProfiler, AudioProfiler, etc.
without modifying the routing engine.
"""

from __future__ import annotations

from app.domain import Modality

from .code_profiler import CodeProfiler
from .protocol import ProfilerProtocol
from .text_profiler import TextProfiler

# Singleton instances (stateless, so safe to reuse).
_TEXT_PROFILER = TextProfiler()
_CODE_PROFILER = CodeProfiler()

_PROFILERS: dict[Modality, ProfilerProtocol] = {
    Modality.TEXT: _TEXT_PROFILER,
    Modality.CODE: _CODE_PROFILER,
}


def get_profiler(modality: Modality) -> ProfilerProtocol:
    """Return a profiler for the given modality.

    Falls back to the text profiler if no specialised profiler exists
    (Phase 2 modalities before their profiler is added).
    """
    return _PROFILERS.get(modality, _TEXT_PROFILER)
