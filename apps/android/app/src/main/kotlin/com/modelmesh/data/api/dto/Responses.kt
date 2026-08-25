package com.modelmesh.data.api.dto

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** Response shapes. Every field the backend may omit is nullable with a default. */

@Serializable
data class SubmitTaskResponseDto(
    val taskId: String,
    val status: String? = null,
    val websocketRoom: String? = null,
    val estimatedMs: Long? = null,
    val executionMode: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class TaskResponseDto(
    val taskId: String,
    val status: String,
    val strategy: String? = null,
    val taskType: String? = null,
    val createdAt: String? = null,
    val completedAt: String? = null,
    val error: ErrorBodyDto? = null,
    val result: TaskResultDto? = null,
    val plan: PlanDto? = null,
    val subtasks: List<SubtaskDto> = emptyList(),
    val verification: VerificationDto? = null,
    val telemetry: TelemetryDto? = null,
)

@Serializable
data class TaskResultDto(
    val output: String,
    val format: String? = null,
    val confidence: Double? = null,
    val partial: Boolean = false,
)

@Serializable
data class PlanDto(
    val id: String? = null,
    val strategy: String? = null,
    val subtaskCount: Int = 0,
    val parallelGroups: List<List<String>> = emptyList(),
    val estimatedTokens: Int? = null,
    val estimatedLatencyMs: Int? = null,
    val estimatedCost: Double? = null,
    val reliabilityScore: Double? = null,
    val reasoning: String? = null,
)

@Serializable
data class SubtaskDto(
    val id: String,
    val role: String? = null,
    val status: String? = null,
    val provider: String? = null,
    val model: String? = null,
    val dependencies: List<String> = emptyList(),
    val confidence: Double? = null,
    val tokens: Int = 0,
    val latencyMs: Int? = null,
    val failovers: Int = 0,
    val fromCache: Boolean = false,
    val errorCode: String? = null,
)

@Serializable
data class VerificationDto(
    val verified: Boolean = false,
    val confidence: Double = 0.0,
    val issues: List<String> = emptyList(),
    val verifiedBy: String? = null,
)

@Serializable
data class TelemetryDto(
    val totalMs: Long? = null,
    val estimatedTokens: Int? = null,
    val actualTokens: Int? = null,
    val savedTokens: Int? = null,
    val savingsPercent: Double = 0.0,
    val failovers: Int = 0,
    val cacheHits: Int = 0,
    val providerBreakdown: List<ProviderUsageDto> = emptyList(),
)

@Serializable
data class ProviderUsageDto(
    val provider: String? = null,
    val model: String? = null,
    val subtask: String? = null,
    val inputTokens: Int = 0,
    val outputTokens: Int = 0,
    val latencyMs: Int = 0,
)

@Serializable
data class TraceResponseDto(
    val taskId: String,
    val status: String? = null,
    /** Each entry is `{ event, ts, ...payload }`; the payload varies per event. */
    val events: List<JsonObject> = emptyList(),
)

@Serializable
data class TaskListResponseDto(
    val tasks: List<TaskListItemDto> = emptyList(),
)

@Serializable
data class TaskListItemDto(
    val taskId: String,
    val status: String? = null,
    val strategy: String? = null,
    val taskType: String? = null,
    val inputPreview: String? = null,
    val confidence: Double? = null,
    val actualTokens: Int? = null,
    val savedTokens: Int? = null,
    val totalMs: Long? = null,
    val createdAt: String? = null,
)

@Serializable
data class ProvidersResponseDto(
    val providers: List<ProviderStatusDto> = emptyList(),
    val timestamp: String? = null,
)

@Serializable
data class ProviderStatusDto(
    val provider: String,
    val status: String? = null,
    val activeKeys: Int = 0,
    val rateLimitedKeys: Int = 0,
    val avgLatencyMs: Int = 0,
    val healthScore: Double = 0.0,
    val quotaConsumedToday: Long = 0,
    val models: List<String> = emptyList(),
)

@Serializable
data class FeedbackResponseDto(
    val taskId: String,
    val recorded: Boolean = false,
)

@Serializable
data class ErrorEnvelopeDto(
    val error: ErrorBodyDto,
)

@Serializable
data class ErrorBodyDto(
    val code: String,
    val message: String? = null,
    val details: JsonElement? = null,
)
