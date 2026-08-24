"""Deterministic rule-based task classifier (Phase 1).

Uses keyword/pattern matching to determine modality, task type, complexity,
and confidence. No ML model, no external calls — runs purely on the input
text structure. Designed to be replaced by on-device or cloud classifiers in
Phase 2 while the routing pipeline stays unchanged.

Classification signals are recorded as human-readable strings so the UI can
show *why* the classifier made its decision.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.domain import (
    Classification,
    ClassificationSource,
    Complexity,
    Modality,
    Task,
    TaskType,
)

from .protocol import ClassifierProtocol

# ---------------------------------------------------------------------------
# Pattern tables
# ---------------------------------------------------------------------------

# Code fences: ```…``` or ~~~…~~~
_CODE_FENCE_RE = re.compile(r"```[\s\S]*?```|~~~[\s\S]*?~~~", re.MULTILINE)

# Common programming language keywords (case-insensitive word boundaries)
_LANG_KEYWORDS: tuple[str, ...] = (
    r"\bdef\b", r"\bclass\b", r"\bimport\b", r"\breturn\b",
    r"\bfunction\b", r"\bconst\b", r"\blet\b", r"\bvar\b",
    r"\bif\b.*\{", r"\bfor\b.*\{", r"\bwhile\b.*\{",
    r"\bpublic\b", r"\bprivate\b", r"\bstatic\b", r"\bvoid\b",
    r"\bint\b\s+\w+", r"\bString\b", r"\bSystem\.out",
    r"#include", r"println!", r"fn\s+\w+",
    r"->",  # type hints / arrow functions
)
_LANG_RE = re.compile("|".join(_LANG_KEYWORDS), re.IGNORECASE)

# Verbs/phrases strongly associated with CODE tasks
_CODE_VERB_RE = re.compile(
    r"\b(debug|fix|refactor|optimise|optimize|compile|implement|code|program"
    r"|write\s+a?\s*(?:python|java|javascript|typescript|c\+\+|rust|go|ruby|php|swift|kotlin)\s+(?:function|class|script|program|code)"
    r"|write\s+(?:code|function|method|class|script|program)"
    r"|NullPointerException|TypeError|SyntaxError|NameError|IndexError|KeyError"
    r"|stacktrace|stack\s*trace|traceback|segfault|core\s*dump"
    r"|unit\s*test|test\s*case|pytest|jest|mocha"
    r"|API\s+endpoint|REST\s+API|GraphQL|CRUD"
    r"|SQL\s+query|SELECT\s+.*\s+FROM|INSERT\s+INTO"
    r")\b",
    re.IGNORECASE,
)

# Verbs/phrases for TEXT sub-types
_SUMMARIZE_RE = re.compile(
    r"\b(summarize|summarise|summary|tldr|tl;dr|condense|brief|shorten|recap)\b",
    re.IGNORECASE,
)
# Imperative explain: "Explain X", "Describe Y", "Define Z" — user is asking
# for an explanation, not posing a quick factual question.
_EXPLAIN_IMPERATIVE_RE = re.compile(
    r"\b(explain|describe|tell\s+me\s+about|define|definition|meaning\s+of|concept|overview)\b",
    re.IGNORECASE,
)
# Interrogative "what/how" forms — these are ambiguous: could be QA or explain.
# If the sentence ends with '?' and no imperative verb, treat as QA.
_EXPLAIN_INTERROGATIVE_RE = re.compile(
    r"\b(what\s+is|what\s+are|how\s+does|how\s+do)\b",
    re.IGNORECASE,
)
_TRANSLATE_RE = re.compile(
    r"\b(translate|translation|convert\s+(?:to|into)\s+(?:english|spanish|french|german|hindi|chinese|japanese|korean|arabic))\b",
    re.IGNORECASE,
)
_QA_RE = re.compile(
    r"^(what|who|where|when|why|how|is|are|can|could|would|does|do|did)\b.*\?$",
    re.IGNORECASE | re.MULTILINE,
)
_GENERATE_TEXT_RE = re.compile(
    r"\b(write|compose|draft|create|generate)\s+(?:a\s+)?(?:blog|article|essay|email|letter|report|story|poem|paragraph|post|tweet|message|document)",
    re.IGNORECASE,
)

# Code-related task type patterns
_DEBUG_RE = re.compile(
    r"\b(debug|fix|error|bug|issue|problem|broken|crash|exception|fault|traceback|stacktrace|failing|failed)\b",
    re.IGNORECASE,
)
_REFACTOR_RE = re.compile(
    r"\b(refactor|restructure|reorganize|reorganise|clean\s*up|improve\s+code|simplify\s+code|redesign)\b",
    re.IGNORECASE,
)
_CODE_EXPLAIN_RE = re.compile(
    r"\b(explain\s+(?:this|the)\s+code|what\s+does\s+this\s+code|how\s+does\s+this\s+(?:code|function|method|class))\b",
    re.IGNORECASE,
)
_CODE_GENERATE_RE = re.compile(
    r"\b(write|create|generate|implement|build|make|code|develop)\s+(?:a\s+)?(?:function|class|method|script|program|module|component|API|endpoint|app|application|service|tool|util|helper|handler|middleware|decorator|test)",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Complexity heuristics
# ---------------------------------------------------------------------------

# Thresholds (character count in input_text)
_COMPLEXITY_SHORT = 100      # below → likely SIMPLE
_COMPLEXITY_MEDIUM = 500     # below → likely MEDIUM
# above → likely COMPLEX

# Additional complexity boosters
_COMPLEX_INDICATORS = re.compile(
    r"\b(architect|design\s+pattern|microservice|distributed|concurrent|async|multithreaded"
    r"|database\s+schema|migration|deployment|infrastructure|scalab|performance\s+optim"
    r"|security\s+vulnerabilit|cryptograph|machine\s+learning|neural\s+network"
    r"|algorithm\s+complex|dynamic\s+programming|graph\s+traversal)\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Classifier
# ---------------------------------------------------------------------------


@dataclass
class RuleBasedClassifier(ClassifierProtocol):
    """Deterministic classifier using keyword/pattern matching.

    Confidence is a heuristic estimate, not a calibrated probability. It
    reflects how many positive signals the classifier found and is clamped to
    [0.3, 0.95]. The classifier never claims 1.0 confidence.
    """

    # Allow callers to override the confidence floor/ceiling for testing.
    min_confidence: float = 0.30
    max_confidence: float = 0.95

    def classify(self, task: Task) -> Classification:
        text = task.input_text
        signals: list[str] = []

        # --- Modality detection ---
        modality, mod_signals = self._detect_modality(text, task.modality_hint)
        signals.extend(mod_signals)

        # --- Task type detection ---
        task_type, type_signals = self._detect_task_type(text, modality)
        signals.extend(type_signals)

        # --- Complexity ---
        complexity, comp_signals = self._detect_complexity(text, modality)
        signals.extend(comp_signals)

        # --- Confidence ---
        confidence = self._compute_confidence(text, signals)

        return Classification(
            modality=modality,
            task_type=task_type,
            complexity=complexity,
            confidence=confidence,
            source=ClassificationSource.RULE_BASED,
            signals=tuple(signals),
        )

    # -- private helpers --------------------------------------------------

    def _detect_modality(
        self, text: str, hint: Modality | None
    ) -> tuple[Modality, list[str]]:
        signals: list[str] = []
        code_score = 0

        # Code fence is strong evidence
        if _CODE_FENCE_RE.search(text):
            code_score += 3
            signals.append("code_fence_detected")

        # Language keywords
        lang_hits = _LANG_RE.findall(text)
        if lang_hits:
            code_score += min(len(lang_hits), 3)
            signals.append(f"language_keywords_found({len(lang_hits)})")

        # Code-related verbs
        if _CODE_VERB_RE.search(text):
            code_score += 2
            signals.append("code_verb_detected")

        # Hint
        if hint == Modality.CODE:
            code_score += 1
            signals.append("modality_hint_code")
        elif hint == Modality.TEXT:
            code_score -= 1
            signals.append("modality_hint_text")

        if code_score >= 2:
            return Modality.CODE, signals
        return Modality.TEXT, signals

    def _detect_task_type(
        self, text: str, modality: Modality
    ) -> tuple[TaskType, list[str]]:
        signals: list[str] = []

        if modality is Modality.CODE:
            # Code sub-types (order matters: more specific first)
            if _DEBUG_RE.search(text):
                signals.append("debug_pattern")
                return TaskType.DEBUGGING, signals
            if _REFACTOR_RE.search(text):
                signals.append("refactor_pattern")
                return TaskType.REFACTORING, signals
            if _CODE_EXPLAIN_RE.search(text):
                signals.append("code_explain_pattern")
                return TaskType.CODE_EXPLANATION, signals
            # Default code task is generation
            if _CODE_GENERATE_RE.search(text):
                signals.append("code_generate_pattern")
            else:
                signals.append("default_code_generation")
            return TaskType.CODE_GENERATION, signals

        # Text sub-types (order matters: more specific patterns first)
        if _SUMMARIZE_RE.search(text):
            signals.append("summarize_pattern")
            return TaskType.SUMMARIZATION, signals
        if _TRANSLATE_RE.search(text):
            signals.append("translate_pattern")
            return TaskType.TRANSLATION, signals
        # Imperative explain verbs always win ("explain X", "describe Y").
        if _EXPLAIN_IMPERATIVE_RE.search(text):
            signals.append("explain_pattern")
            return TaskType.EXPLANATION, signals
        # Direct questions (ending with ?) — treat as QA.
        if _QA_RE.search(text):
            signals.append("question_pattern")
            return TaskType.QUESTION_ANSWERING, signals
        # Interrogative what/how without '?' — treat as explanation.
        if _EXPLAIN_INTERROGATIVE_RE.search(text):
            signals.append("explain_pattern")
            return TaskType.EXPLANATION, signals
        if _GENERATE_TEXT_RE.search(text):
            signals.append("text_generate_pattern")
            return TaskType.TEXT_GENERATION, signals

        signals.append("default_text_generation")
        return TaskType.TEXT_GENERATION, signals

    def _detect_complexity(
        self, text: str, modality: Modality
    ) -> tuple[Complexity, list[str]]:
        signals: list[str] = []
        length = len(text)

        if _COMPLEX_INDICATORS.search(text):
            signals.append("complex_topic_indicator")
            return Complexity.COMPLEX, signals

        if length < _COMPLEXITY_SHORT:
            signals.append(f"short_input({length}_chars)")
            return Complexity.SIMPLE, signals
        if length < _COMPLEXITY_MEDIUM:
            signals.append(f"medium_input({length}_chars)")
            return Complexity.MEDIUM, signals

        signals.append(f"long_input({length}_chars)")
        return Complexity.COMPLEX, signals

    def _compute_confidence(self, text: str, signals: list[str]) -> float:
        """Heuristic confidence based on the number and quality of signals."""
        if not text.strip():
            return self.min_confidence

        # Base confidence from number of classification signals
        signal_count = len(signals)
        raw = 0.5 + (signal_count * 0.07)

        # Bonus for text length (very short inputs are less certain)
        if len(text) > 50:
            raw += 0.05
        if len(text) > 200:
            raw += 0.05

        return round(min(max(raw, self.min_confidence), self.max_confidence), 2)
