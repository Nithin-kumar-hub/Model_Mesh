package com.modelmesh.data.models

/**
 * The trace, folded into something a screen can draw.
 *
 * The backend emits a flat event stream; the execution screen needs two views of
 * it — a pipeline of stages, and a live row per subtask. This type derives both
 * from the events so the ViewModel holds no duplicated bookkeeping.
 */
data class ExecutionTimeline(
    val taskId: String,
    val events: List<TraceEvent> = emptyList(),
) {
    val stages: List<StageProgress> get() = PipelineStage.entries.map { stage -> stage.progress(events) }

    val subtasks: List<SubtaskProgress>
        get() {
            val byId = LinkedHashMap<String, SubtaskProgress>()
            for (event in events) {
                val id = event.subtaskId ?: continue
                val existing = byId[id]
                    ?: SubtaskProgress(id = id, role = event.role ?: AgentRole.UNKNOWN)
                byId[id] = existing.apply(event)
            }
            return byId.values.toList()
        }

    val elapsedMs: Long get() = events.lastOrNull()?.offsetMs ?: 0

    val isFinished: Boolean
        get() = events.any { it.name == TraceEventName.COMPLETED || it.name == TraceEventName.FAILED }

    val failed: Boolean get() = events.any { it.name == TraceEventName.FAILED }

    /** Non-null once the plan is chosen; drives the "what is about to happen" card. */
    val plan: PlanPreview?
        get() = events.lastOrNull { it.name == TraceEventName.PLAN_SELECTED }?.let { event ->
            PlanPreview(
                strategy = ExecutionStrategy.fromWire(event.string("strategy")),
                requestedStrategy = ExecutionStrategy.fromWire(event.string("requestedStrategy")),
                downgraded = event.boolean("downgraded") == true,
                estimatedTokens = event.int("estimatedTokens") ?: 0,
                estimatedLatencyMs = event.int("estimatedLatencyMs") ?: 0,
                reliabilityScore = event.double("reliabilityScore") ?: 0.0,
                parallelGroups = parallelGroups(event),
                reasoning = event.string("reasoning").orEmpty(),
            )
        }

    /** Rule 1, as a number the user can see. */
    val contextSavings: ContextSavings?
        get() = events.lastOrNull { it.name == TraceEventName.DECOMPOSED }?.let { event ->
            ContextSavings(
                masterContextTokens = event.int("masterContextTokens") ?: 0,
                slicedContextTokens = event.int("slicedContextTokens") ?: 0,
                naiveContextTokens = event.int("naiveContextTokens") ?: 0,
                reductionPercent = event.int("contextReductionPercent") ?: 0,
            )
        }

    val outcome: RunOutcome?
        get() = events.lastOrNull { it.name == TraceEventName.COMPLETED }?.let { event ->
            RunOutcome(
                totalTokens = event.int("totalTokens") ?: 0,
                savedTokens = event.int("savedTokens") ?: 0,
                savingsPercent = event.double("savingsPercent") ?: 0.0,
                totalMs = event.long("ms") ?: 0,
                confidence = event.double("confidence") ?: 0.0,
                partial = event.boolean("partial") == true,
                failedSubtasks = event.strings("failedSubtasks"),
                replans = event.int("replans") ?: 0,
                cacheHits = event.int("cacheHits") ?: 0,
                failovers = event.int("failovers") ?: 0,
            )
        }

    fun withEvent(event: TraceEvent): ExecutionTimeline {
        // The socket replays history on join and may reconnect mid-run, so an
        // event can legitimately arrive twice.
        val duplicate = events.any {
            it.name == event.name && it.offsetMs == event.offsetMs && it.subtaskId == event.subtaskId
        }
        return if (duplicate) this else copy(events = events + event)
    }

    fun withEvents(incoming: List<TraceEvent>): ExecutionTimeline =
        incoming.fold(this) { timeline, event -> timeline.withEvent(event) }

    private fun parallelGroups(event: TraceEvent): List<List<String>> =
        when (val groups = event.payload["parallelGroups"]) {
            is List<*> -> groups.mapNotNull { group ->
                (group as? List<*>)?.mapNotNull { it?.toString() }
            }
            else -> emptyList()
        }
}

data class PlanPreview(
    val strategy: ExecutionStrategy,
    val requestedStrategy: ExecutionStrategy,
    val downgraded: Boolean,
    val estimatedTokens: Int,
    val estimatedLatencyMs: Int,
    val reliabilityScore: Double,
    val parallelGroups: List<List<String>>,
    val reasoning: String,
)

data class ContextSavings(
    val masterContextTokens: Int,
    val slicedContextTokens: Int,
    val naiveContextTokens: Int,
    val reductionPercent: Int,
)

data class RunOutcome(
    val totalTokens: Int,
    val savedTokens: Int,
    val savingsPercent: Double,
    val totalMs: Long,
    val confidence: Double,
    val partial: Boolean,
    val failedSubtasks: List<String>,
    val replans: Int,
    val cacheHits: Int,
    val failovers: Int,
)

/** Coarse pipeline stages, each backed by the events that prove it happened. */
enum class PipelineStage(
    val label: String,
    private val startedBy: Set<TraceEventName>,
    private val finishedBy: Set<TraceEventName>,
) {
    UNDERSTAND(
        "Understand",
        setOf(TraceEventName.TASK_RECEIVED, TraceEventName.CLASSIFYING),
        setOf(TraceEventName.CLASSIFIED),
    ),
    ENHANCE(
        "Enhance",
        setOf(TraceEventName.ENHANCING),
        setOf(TraceEventName.ENHANCED),
    ),
    OPTIMIZE(
        "Optimize tokens",
        setOf(TraceEventName.OPTIMIZING),
        setOf(TraceEventName.OPTIMIZED),
    ),
    DECOMPOSE(
        "Split into a DAG",
        setOf(TraceEventName.DECOMPOSING),
        setOf(TraceEventName.DECOMPOSED),
    ),
    PLAN(
        "Plan",
        setOf(TraceEventName.PLANNING),
        setOf(TraceEventName.PLAN_SELECTED),
    ),
    EXECUTE(
        "Execute",
        setOf(TraceEventName.SUBTASK_STARTED),
        setOf(TraceEventName.AGGREGATING),
    ),
    AGGREGATE(
        "Aggregate",
        setOf(TraceEventName.AGGREGATING),
        setOf(TraceEventName.VERIFYING, TraceEventName.COMPLETED),
    ),
    VERIFY(
        "Verify",
        setOf(TraceEventName.VERIFYING),
        setOf(TraceEventName.VERIFIED),
    ),
    ;

    fun progress(events: List<TraceEvent>): StageProgress {
        val started = events.firstOrNull { it.name in startedBy }
        val finished = events.firstOrNull { it.name in finishedBy }
        val terminal = events.firstOrNull { it.name == TraceEventName.FAILED }

        val state = when {
            finished != null -> StageState.DONE
            started != null && terminal != null -> StageState.FAILED
            started != null -> StageState.RUNNING
            else -> StageState.PENDING
        }

        return StageProgress(
            stage = this,
            state = state,
            startedAtMs = started?.offsetMs,
            finishedAtMs = finished?.offsetMs,
            detail = (finished ?: started)?.summary.orEmpty(),
        )
    }
}

enum class StageState { PENDING, RUNNING, DONE, FAILED }

data class StageProgress(
    val stage: PipelineStage,
    val state: StageState,
    val startedAtMs: Long?,
    val finishedAtMs: Long?,
    val detail: String,
) {
    val durationMs: Long?
        get() = if (startedAtMs != null && finishedAtMs != null) finishedAtMs - startedAtMs else null
}

/** Live per-subtask state, folded from that subtask's events. */
data class SubtaskProgress(
    val id: String,
    val role: AgentRole,
    val status: SubtaskStatus = SubtaskStatus.PENDING,
    val provider: String? = null,
    val model: String? = null,
    val tokens: Int = 0,
    val latencyMs: Int = 0,
    val confidence: Double? = null,
    val attempts: Int = 0,
    val failovers: Int = 0,
    val fromCache: Boolean = false,
    val error: String? = null,
    val skipReason: String? = null,
    val startedAtMs: Long? = null,
    val finishedAtMs: Long? = null,
) {
    fun apply(event: TraceEvent): SubtaskProgress = when (event.name) {
        TraceEventName.SUBTASK_STARTED -> copy(
            role = event.role ?: role,
            status = SubtaskStatus.RUNNING,
            provider = event.string("provider") ?: provider,
            model = event.string("model") ?: model,
            attempts = event.int("attempt") ?: (attempts + 1),
            startedAtMs = startedAtMs ?: event.offsetMs,
            error = null,
        )

        TraceEventName.SUBTASK_DONE -> copy(
            role = event.role ?: role,
            status = SubtaskStatus.COMPLETED,
            provider = event.string("provider") ?: provider,
            model = event.string("chosenModel") ?: event.string("model") ?: model,
            tokens = event.int("tokens") ?: tokens,
            latencyMs = event.int("ms") ?: latencyMs,
            confidence = event.double("confidence") ?: confidence,
            failovers = event.int("failovers") ?: failovers,
            fromCache = event.boolean("fromCache") ?: fromCache,
            finishedAtMs = event.offsetMs,
        )

        // A failure that is still retrying leaves the row running, so the UI
        // does not flicker to red and back for a recovered subtask.
        TraceEventName.SUBTASK_FAILED -> copy(
            status = if (event.boolean("retrying") == true) SubtaskStatus.RUNNING else SubtaskStatus.FAILED,
            error = event.string("error"),
            failovers = if (event.boolean("retrying") == true) failovers + 1 else failovers,
            finishedAtMs = if (event.boolean("retrying") == true) null else event.offsetMs,
        )

        TraceEventName.SUBTASK_SKIPPED -> copy(
            status = SubtaskStatus.SKIPPED,
            skipReason = event.string("reason"),
            finishedAtMs = event.offsetMs,
        )

        TraceEventName.CACHE_HIT -> copy(fromCache = true)

        else -> this
    }
}
