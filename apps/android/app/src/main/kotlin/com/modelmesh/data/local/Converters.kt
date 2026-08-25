package com.modelmesh.data.local

import androidx.room.TypeConverter
import com.modelmesh.data.models.AgentRole
import com.modelmesh.data.models.ExecutionStrategy
import com.modelmesh.data.models.PlanSummary
import com.modelmesh.data.models.ProviderUsageView
import com.modelmesh.data.models.SubtaskStatus
import com.modelmesh.data.models.SubtaskView
import com.modelmesh.data.models.TelemetryView
import com.modelmesh.data.models.VerificationView
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * JSON storage for the four composite columns of [TaskEntity].
 *
 * The domain models in `data/models/` carry no `@Serializable` annotation — they
 * are plain data classes shared with the UI and are frozen — so each one gets a
 * `Stored*` mirror here. The mirrors are field-for-field copies with enums flattened
 * to their wire strings, which is also what makes a row written by an older build
 * readable by a newer one.
 *
 * Nothing in the compiler checks that a mirror still matches its domain type, so
 * `ConvertersTest` round-trips a fully-populated instance of each. If a frozen model
 * gains a field, that test is what fails.
 *
 * Decoding is deliberately forgiving: this is a cache, and a row that cannot be
 * parsed should degrade to "we don't have it locally" rather than crash a screen.
 */
class Converters {

    // ── Telemetry ─────────────────────────────────────────────────────────────

    @TypeConverter
    fun fromTelemetry(value: TelemetryView?): String? =
        value?.let { json.encodeToString(StoredTelemetry.serializer(), it.toStored()) }

    @TypeConverter
    fun toTelemetry(value: String?): TelemetryView? =
        value?.decodeOrNull(StoredTelemetry.serializer())?.toDomain()

    // ── Plan ──────────────────────────────────────────────────────────────────

    @TypeConverter
    fun fromPlan(value: PlanSummary?): String? =
        value?.let { json.encodeToString(StoredPlan.serializer(), it.toStored()) }

    @TypeConverter
    fun toPlan(value: String?): PlanSummary? =
        value?.decodeOrNull(StoredPlan.serializer())?.toDomain()

    // ── Subtasks ──────────────────────────────────────────────────────────────

    @TypeConverter
    fun fromSubtasks(value: List<SubtaskView>?): String? =
        value?.let { list -> json.encodeToString(storedSubtaskList, list.map { it.toStored() }) }

    @TypeConverter
    fun toSubtasks(value: String?): List<SubtaskView>? =
        value?.decodeOrNull(storedSubtaskList)?.map { it.toDomain() }

    // ── Verification ──────────────────────────────────────────────────────────

    @TypeConverter
    fun fromVerification(value: VerificationView?): String? =
        value?.let { json.encodeToString(StoredVerification.serializer(), it.toStored()) }

    @TypeConverter
    fun toVerification(value: String?): VerificationView? =
        value?.decodeOrNull(StoredVerification.serializer())?.toDomain()

    private fun <T> String.decodeOrNull(serializer: KSerializer<T>): T? =
        runCatching { json.decodeFromString(serializer, this) }.getOrNull()

    private companion object {
        val json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }

        val storedSubtaskList: KSerializer<List<StoredSubtask>> = ListSerializer(StoredSubtask.serializer())
    }
}

// ── Stored mirrors ────────────────────────────────────────────────────────────

@Serializable
internal data class StoredTelemetry(
    val totalMs: Long? = null,
    val estimatedTokens: Int? = null,
    val actualTokens: Int? = null,
    val savedTokens: Int? = null,
    val savingsPercent: Double = 0.0,
    val failovers: Int = 0,
    val cacheHits: Int = 0,
    val providerBreakdown: List<StoredProviderUsage> = emptyList(),
)

@Serializable
internal data class StoredProviderUsage(
    val provider: String,
    val model: String,
    val subtask: String? = null,
    val inputTokens: Int = 0,
    val outputTokens: Int = 0,
    val latencyMs: Int = 0,
)

@Serializable
internal data class StoredPlan(
    val id: String? = null,
    /** `ExecutionStrategy.wire`. */
    val strategy: String,
    val subtaskCount: Int = 0,
    val parallelGroups: List<List<String>> = emptyList(),
    val estimatedTokens: Int? = null,
    val estimatedLatencyMs: Int? = null,
    val estimatedCost: Double? = null,
    val reliabilityScore: Double? = null,
    val reasoning: String = "",
)

@Serializable
internal data class StoredSubtask(
    val id: String,
    /** `AgentRole.wire`. */
    val role: String,
    /** `SubtaskStatus.wire`. */
    val status: String,
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
internal data class StoredVerification(
    val verified: Boolean = false,
    val confidence: Double = 0.0,
    val issues: List<String> = emptyList(),
    val verifiedBy: String? = null,
)

// ── domain → stored ───────────────────────────────────────────────────────────

internal fun TelemetryView.toStored(): StoredTelemetry = StoredTelemetry(
    totalMs = totalMs,
    estimatedTokens = estimatedTokens,
    actualTokens = actualTokens,
    savedTokens = savedTokens,
    savingsPercent = savingsPercent,
    failovers = failovers,
    cacheHits = cacheHits,
    providerBreakdown = providerBreakdown.map { it.toStored() },
)

internal fun ProviderUsageView.toStored(): StoredProviderUsage = StoredProviderUsage(
    provider = provider,
    model = model,
    subtask = subtask,
    inputTokens = inputTokens,
    outputTokens = outputTokens,
    latencyMs = latencyMs,
)

internal fun PlanSummary.toStored(): StoredPlan = StoredPlan(
    id = id,
    strategy = strategy.wire,
    subtaskCount = subtaskCount,
    parallelGroups = parallelGroups,
    estimatedTokens = estimatedTokens,
    estimatedLatencyMs = estimatedLatencyMs,
    estimatedCost = estimatedCost,
    reliabilityScore = reliabilityScore,
    reasoning = reasoning,
)

internal fun SubtaskView.toStored(): StoredSubtask = StoredSubtask(
    id = id,
    role = role.wire,
    status = status.wire,
    provider = provider,
    model = model,
    dependencies = dependencies,
    confidence = confidence,
    tokens = tokens,
    latencyMs = latencyMs,
    failovers = failovers,
    fromCache = fromCache,
    errorCode = errorCode,
)

internal fun VerificationView.toStored(): StoredVerification = StoredVerification(
    verified = verified,
    confidence = confidence,
    issues = issues,
    verifiedBy = verifiedBy,
)

// ── stored → domain ───────────────────────────────────────────────────────────

internal fun StoredTelemetry.toDomain(): TelemetryView = TelemetryView(
    totalMs = totalMs,
    estimatedTokens = estimatedTokens,
    actualTokens = actualTokens,
    savedTokens = savedTokens,
    savingsPercent = savingsPercent,
    failovers = failovers,
    cacheHits = cacheHits,
    providerBreakdown = providerBreakdown.map { it.toDomain() },
)

internal fun StoredProviderUsage.toDomain(): ProviderUsageView = ProviderUsageView(
    provider = provider,
    model = model,
    subtask = subtask,
    inputTokens = inputTokens,
    outputTokens = outputTokens,
    latencyMs = latencyMs,
)

internal fun StoredPlan.toDomain(): PlanSummary = PlanSummary(
    id = id,
    strategy = ExecutionStrategy.fromWire(strategy),
    subtaskCount = subtaskCount,
    parallelGroups = parallelGroups,
    estimatedTokens = estimatedTokens,
    estimatedLatencyMs = estimatedLatencyMs,
    estimatedCost = estimatedCost,
    reliabilityScore = reliabilityScore,
    reasoning = reasoning,
)

internal fun StoredSubtask.toDomain(): SubtaskView = SubtaskView(
    id = id,
    role = AgentRole.fromWire(role),
    status = SubtaskStatus.fromWire(status),
    provider = provider,
    model = model,
    dependencies = dependencies,
    confidence = confidence,
    tokens = tokens,
    latencyMs = latencyMs,
    failovers = failovers,
    fromCache = fromCache,
    errorCode = errorCode,
)

internal fun StoredVerification.toDomain(): VerificationView = VerificationView(
    verified = verified,
    confidence = confidence,
    issues = issues,
    verifiedBy = verifiedBy,
)
