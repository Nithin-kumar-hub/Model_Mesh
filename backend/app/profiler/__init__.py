"""Workload profiler package.

Phase 1 ships text and code profilers. The ``ProfilerProtocol`` allows Phase 2
to add PDF, image, audio, video profilers without changing the routing engine.
"""

from __future__ import annotations

from .code_profiler import CodeProfiler
from .factory import get_profiler
from .protocol import ProfilerProtocol
from .text_profiler import TextProfiler

__all__ = ["ProfilerProtocol", "TextProfiler", "CodeProfiler", "get_profiler"]
