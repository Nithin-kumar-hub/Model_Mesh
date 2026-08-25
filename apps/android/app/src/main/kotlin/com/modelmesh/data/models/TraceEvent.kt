package com.modelmesh.data.models

/**
 * One event from the execution trace. Names match the backend's
 * `TraceEventName` exactly — every stage boundary emits one, which is what the
 * trace screen renders.
 */
enum class TraceEventName(val wire: String) {
    TASK_RECEIVED("task_received"),
    CLASSIFYING("classifying"),
    CLASSIFIED("classified"),
    ENHANCING("enhancing"),
    ENHANCED("enhanced"),
    OPTIMIZING("optimizing"),
    OPTIMIZED("optimized"),
    DECOMPOSING("decomposing"),
    DECOMPOSED("decomposed"),
    PLANNING("planning"),
    PLAN_SELECTED("plan_selected"),
    SUBTASK_STARTED("subtask_started"),
    SUBTASK_PROGRESS("subtask_progress"),
    SUBTASK_FAILED("subtask_failed"),
    SUBTASK_DONE("subtask_done"),
    SUBTASK_SKIPPED("subtask_skipped"),
    REPLANNING("replanning"),
    AGGREGATING("aggregating"),
    VERIFYING("verifying"),
    VERIFIED("verified"),
    CACHE_HIT("cache_hit"),
    COMPLETED("completed"),
    FAILED("failed"),
    UNKNOWN("unknown"),
    ;

    companion object {
        fun fromWire(value: String?): TraceEventName =
            entries.firstOrNull { it.wire == value?.lowercase() } ?: UNKNOWN
    }
}

/**
 * A trace event with its payload left as a loose map.
 *
 * The payload shape varies per event and the backend is free to add fields; a
 * strongly-typed sealed hierarchy would break the app on every backend addition,
 * so accessors read what they need and tolerate what they don't recognize.
 */
data class TraceEvent(
    val name: TraceEventName,
    val taskId: String,
    /** Milliseconds since the task was received. */
    val offsetMs: Long,
    val payload: Map<String, Any?> = emptyMap(),
    val rawName: String = name.wire,
) {
    fun string(key: String): String? = payload[key]?.let { if (it is String) it else it.toString() }
    fun int(key: String): Int? = number(key)?.toInt()
    fun long(key: String): Long? = number(key)?.toLong()
    fun double(key: String): Double? = number(key)
    fun boolean(key: String): Boolean? = payload[key] as? Boolean

    fun strings(key: String): List<String> = when (val value = payload[key]) {
        is List<*> -> value.mapNotNull { it?.toString() }
        else -> emptyList()
    }

    private fun number(key: String): Double? = when (val value = payload[key]) {
        is Number -> value.toDouble()
        is String -> value.toDoubleOrNull()
        else -> null
    }

    val subtaskId: String? get() = string("subtaskId")
    val role: AgentRole? get() = string("role")?.let(AgentRole::fromWire)

    /** A one-line human summary, used by the trace screen and the timeline. */
    val summary: String
        get() = when (name) {
            TraceEventName.TASK_RECEIVED -> "Task accepted (${string("strategy") ?: "balanced"})"
            TraceEventName.CLASSIFYING -> "Understanding the request"
            TraceEventName.CLASSIFIED ->
                "Recognized as ${string("taskType") ?: "a task"} " +
                    "(${percent(double("confidence"))} confident, ${string("classifiedBy") ?: "rule"})"
            TraceEventName.ENHANCING -> "Enhancing the task specification"
            TraceEventName.ENHANCED -> "Goal: ${string("goal")?.take(90) ?: "restated"}"
            TraceEventName.OPTIMIZING -> "Optimizing tokens"
            TraceEventName.OPTIMIZED -> "Master context ${int("tokensAfter") ?: 0} tokens (${int("tokensSaved") ?: 0} saved)"
            TraceEventName.DECOMPOSING -> "Splitting the task"
            TraceEventName.DECOMPOSED ->
                "${int("subtaskCount") ?: 0} subtasks; context per subtask cut " +
                    "${int("contextReductionPercent") ?: 0}% vs sending everything to each"
            TraceEventName.PLANNING -> "Generating ${int("planCount") ?: 3} candidate plans"
            TraceEventName.PLAN_SELECTED ->
                "Chose the ${string("strategy") ?: "balanced"} plan " +
                    "(~${int("estimatedTokens") ?: 0} tokens)"
            TraceEventName.SUBTASK_STARTED ->
                "${roleLabel()} started on ${string("model") ?: "a capable model"}"
            TraceEventName.SUBTASK_PROGRESS -> "${roleLabel()} streaming"
            TraceEventName.SUBTASK_DONE ->
                "${roleLabel()} finished — ${int("tokens") ?: 0} tokens, ${int("ms") ?: 0}ms"
            TraceEventName.SUBTASK_FAILED ->
                "${roleLabel()} hit ${string("error") ?: "an error"}" +
                    if (boolean("retrying") == true) " — retrying" else " — giving up"
            TraceEventName.SUBTASK_SKIPPED -> "${roleLabel()} skipped (${string("reason") ?: "unavailable"})"
            TraceEventName.REPLANNING -> "Re-planning around ${strings("failedSubtasks").size} failure(s)"
            TraceEventName.AGGREGATING ->
                int("conflictsFound")?.let { "Merging results — $it conflict(s) found" }
                    ?: "Merging ${int("resultCount") ?: 0} results"
            TraceEventName.VERIFYING -> "Verifying (${string("reason") ?: "low confidence"})"
            TraceEventName.VERIFIED ->
                "Verification ${if (boolean("verified") == true) "passed" else "raised issues"}" +
                    " (${int("issues") ?: 0})"
            TraceEventName.CACHE_HIT -> "${roleLabel()} served from cache"
            TraceEventName.COMPLETED ->
                "Done in ${int("ms") ?: 0}ms — ${int("savedTokens") ?: 0} tokens saved " +
                    "(${double("savingsPercent")?.let { "%.1f".format(it) } ?: "0"}%)"
            TraceEventName.FAILED -> "Failed: ${string("error") ?: "unknown"}"
            TraceEventName.UNKNOWN -> rawName
        }

    private fun roleLabel(): String = role?.label ?: subtaskId ?: "Subtask"

    private fun percent(value: Double?): String =
        value?.let { "${(it * 100).toInt()}%" } ?: "—"
}
