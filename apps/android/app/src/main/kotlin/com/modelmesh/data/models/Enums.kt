package com.modelmesh.data.models

/** Execution strategy — the same three the backend plans for. */
enum class ExecutionStrategy(val wire: String, val label: String, val blurb: String) {
    DRAFT("draft", "Draft", "Cheapest capable models, compressed context, no verification"),
    BALANCED("balanced", "Balanced", "Best quality per token, parallel where it helps"),
    PREMIUM("premium", "Premium", "Highest-quality models, full context, always verified"),
    ;

    companion object {
        fun fromWire(value: String?): ExecutionStrategy =
            entries.firstOrNull { it.wire == value?.lowercase() } ?: BALANCED
    }
}

/** Task lifecycle, mirroring the backend's `TaskStatus`. */
enum class TaskStatus(val wire: String, val label: String) {
    RECEIVED("received", "Received"),
    CLASSIFYING("classifying", "Understanding the task"),
    ENHANCING("enhancing", "Enhancing the task"),
    DECOMPOSING("decomposing", "Splitting into subtasks"),
    PLANNING("planning", "Choosing a plan"),
    EXECUTING("executing", "Running subtasks"),
    AGGREGATING("aggregating", "Merging results"),
    VERIFYING("verifying", "Verifying"),
    COMPLETED("completed", "Completed"),
    FAILED("failed", "Failed"),
    ;

    val isTerminal: Boolean get() = this == COMPLETED || this == FAILED

    companion object {
        fun fromWire(value: String?): TaskStatus =
            entries.firstOrNull { it.wire == value?.lowercase() } ?: RECEIVED
    }
}

/** Input modality. `MULTIPART` is text plus one or more files. */
enum class InputType(val wire: String) {
    TEXT("text"),
    CODE("code"),
    IMAGE("image"),
    PDF("pdf"),
    AUDIO("audio"),
    VIDEO("video"),
    QR("qr"),
    MULTIPART("multipart"),
    ;

    companion object {
        fun fromWire(value: String?): InputType =
            entries.firstOrNull { it.wire == value?.lowercase() } ?: TEXT
    }
}

/**
 * Agent roles, for display only. Routing is capability-based and lives entirely
 * on the backend (Rule 3) — the app never asks for a model.
 */
enum class AgentRole(val wire: String, val label: String) {
    CLASSIFIER("classifier", "Classifier"),
    ENHANCER("enhancer", "Enhancer"),
    DECOMPOSER("decomposer", "Decomposer"),
    RESEARCHER("researcher", "Researcher"),
    CODER("coder", "Bug hunter"),
    CODE_REVIEWER("code_reviewer", "Code reviewer"),
    SECURITY_ANALYZER("security_analyzer", "Security analyst"),
    PERFORMANCE_ANALYZER("performance_analyzer", "Performance analyst"),
    ARCHITECT("architect", "Architect"),
    SUMMARIZER("summarizer", "Summarizer"),
    VISION_ANALYZER("vision_analyzer", "Vision analyst"),
    AUDIO_TRANSCRIBER("audio_transcriber", "Transcriber"),
    SYNTHESIZER("synthesizer", "Synthesizer"),
    VERIFIER("verifier", "Verifier"),
    CRITIC("critic", "Critic"),
    UNKNOWN("unknown", "Agent"),
    ;

    companion object {
        fun fromWire(value: String?): AgentRole =
            entries.firstOrNull { it.wire == value?.lowercase() } ?: UNKNOWN
    }
}

/** Per-subtask status as reported by `GET /tasks/:id`. */
enum class SubtaskStatus(val wire: String, val label: String) {
    PENDING("pending", "Waiting"),
    RUNNING("running", "Running"),
    COMPLETED("completed", "Done"),
    FAILED("failed", "Failed"),
    SKIPPED("skipped", "Skipped"),
    ;

    companion object {
        fun fromWire(value: String?): SubtaskStatus =
            entries.firstOrNull { it.wire == value?.lowercase() } ?: PENDING
    }
}
