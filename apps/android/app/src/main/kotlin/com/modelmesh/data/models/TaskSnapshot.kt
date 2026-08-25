package com.modelmesh.data.models

/** The full task view returned by `GET /tasks/:taskId`. */
data class TaskSnapshot(
    val taskId: String,
    val status: TaskStatus,
    val strategy: ExecutionStrategy,
    val taskType: String?,
    val createdAt: String?,
    val completedAt: String?,
    val errorCode: String?,
    val output: TaskOutput?,
    val plan: PlanSummary?,
    val subtasks: List<SubtaskView>,
    val verification: VerificationView?,
    val telemetry: TelemetryView,
) {
    val isTerminal: Boolean get() = status.isTerminal

    /** Subtasks that produced nothing — reported as-is, never hidden. */
    val unfinished: List<SubtaskView>
        get() = subtasks.filter { it.status == SubtaskStatus.FAILED || it.status == SubtaskStatus.SKIPPED }
}

data class TaskOutput(
    val text: String,
    val format: String,
    val confidence: Double?,
    val partial: Boolean,
)

data class PlanSummary(
    val id: String?,
    val strategy: ExecutionStrategy,
    val subtaskCount: Int,
    /** Batches that ran concurrently, in execution order. */
    val parallelGroups: List<List<String>>,
    val estimatedTokens: Int?,
    val estimatedLatencyMs: Int?,
    val estimatedCost: Double?,
    val reliabilityScore: Double?,
    val reasoning: String,
) {
    val widestBatch: Int get() = parallelGroups.maxOfOrNull { it.size } ?: 0
}

data class SubtaskView(
    val id: String,
    val role: AgentRole,
    val status: SubtaskStatus,
    val provider: String?,
    val model: String?,
    val dependencies: List<String>,
    val confidence: Double?,
    val tokens: Int,
    val latencyMs: Int?,
    val failovers: Int,
    val fromCache: Boolean,
    val errorCode: String?,
)

data class VerificationView(
    val verified: Boolean,
    val confidence: Double,
    val issues: List<String>,
    val verifiedBy: String?,
)

/**
 * Token accounting. `savedTokens` is measured against the naive baseline —
 * the same roles, each handed the whole master context — counting only the
 * subtasks that actually produced a result.
 */
data class TelemetryView(
    val totalMs: Long?,
    val estimatedTokens: Int?,
    val actualTokens: Int?,
    val savedTokens: Int?,
    val savingsPercent: Double,
    val failovers: Int,
    val cacheHits: Int,
    val providerBreakdown: List<ProviderUsageView>,
) {
    val hasTokenData: Boolean get() = (actualTokens ?: 0) > 0

    /** Distinct models the plan actually used — the mesh, made visible. */
    val modelsUsed: List<String>
        get() = providerBreakdown.map { "${it.provider}/${it.model}" }.distinct()

    companion object {
        val EMPTY = TelemetryView(
            totalMs = null,
            estimatedTokens = null,
            actualTokens = null,
            savedTokens = null,
            savingsPercent = 0.0,
            failovers = 0,
            cacheHits = 0,
            providerBreakdown = emptyList(),
        )
    }
}

data class ProviderUsageView(
    val provider: String,
    val model: String,
    val subtask: String?,
    val inputTokens: Int,
    val outputTokens: Int,
    val latencyMs: Int,
) {
    val totalTokens: Int get() = inputTokens + outputTokens
}

/** One row in the history list (`GET /tasks`). */
data class TaskListItem(
    val taskId: String,
    val status: TaskStatus,
    val strategy: ExecutionStrategy,
    val taskType: String?,
    val inputPreview: String?,
    val confidence: Double?,
    val actualTokens: Int?,
    val savedTokens: Int?,
    val totalMs: Long?,
    val createdAt: String?,
)

/** One provider's key-pool health (`GET /providers/status`). */
data class ProviderHealth(
    val provider: String,
    val status: String,
    val activeKeys: Int,
    val rateLimitedKeys: Int,
    val avgLatencyMs: Int,
    val healthScore: Double,
    val quotaConsumedToday: Long,
    val models: List<String>,
)
