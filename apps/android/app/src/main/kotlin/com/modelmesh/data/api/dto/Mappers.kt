package com.modelmesh.data.api.dto

import com.modelmesh.data.models.AgentRole
import com.modelmesh.data.models.Attachment
import com.modelmesh.data.models.ExecutionStrategy
import com.modelmesh.data.models.LocalMetadata
import com.modelmesh.data.models.PlanSummary
import com.modelmesh.data.models.ProviderHealth
import com.modelmesh.data.models.ProviderUsageView
import com.modelmesh.data.models.SubtaskStatus
import com.modelmesh.data.models.SubtaskView
import com.modelmesh.data.models.TaskAccepted
import com.modelmesh.data.models.TaskListItem
import com.modelmesh.data.models.TaskOutput
import com.modelmesh.data.models.TaskSnapshot
import com.modelmesh.data.models.TaskStatus
import com.modelmesh.data.models.TaskSubmission
import com.modelmesh.data.models.TelemetryView
import com.modelmesh.data.models.VerificationView

/**
 * DTO ↔ domain translation. Kept in one file so a backend field rename shows up
 * as a single compile error rather than as silently-null UI.
 */

fun TaskSubmission.toDto(): SubmitTaskRequestDto = SubmitTaskRequestDto(
    input = TaskInputDto(
        type = type.wire,
        // The typed instruction is the only thing in the directive channel.
        text = userIntent.takeIf { it.isNotBlank() },
        files = attachments.takeIf { it.isNotEmpty() }?.map { it.toDto() },
        localMetadata = localMetadata.toDto(),
    ),
    strategy = strategy.wire,
    budget = budget?.let { BudgetDto(it.maxTokens, it.maxLatencyMs, it.minQuality) },
    preferences = PreferencesDto(
        preferLocalModels = preferences.preferLocalModels,
        explainPlan = preferences.explainPlan,
        streamTrace = preferences.streamTrace,
    ),
    sessionId = sessionId,
)

fun Attachment.toDto(): FileDto = FileDto(
    id = id,
    mimeType = mimeType,
    // Only modalities a cloud model consumes directly carry bytes; everything
    // else travels as the text the phone already extracted.
    base64 = base64,
    metadata = FileMetadataDto(
        pageCount = pageCount,
        sizeBytes = sizeBytes.takeIf { it > 0 },
        imageWidth = imageWidth,
        imageHeight = imageHeight,
        audioDurationSeconds = audioDurationSeconds,
        preprocessedAt = preprocessedAt,
        detectedText = detectedText?.takeIf { it.isNotBlank() },
    ),
)

fun LocalMetadata.toDto(): LocalMetadataDto = LocalMetadataDto(
    detectedText = detectedText?.takeIf { it.isNotBlank() },
    detectedLanguage = detectedLanguage,
    barcodeData = barcodeData,
    imageWidth = imageWidth,
    imageHeight = imageHeight,
    audioDurationSeconds = audioDurationSeconds,
    deviceModel = deviceModel,
    hasNPU = hasNPU,
    hasGPU = hasGPU,
    batteryLevel = batteryLevel,
    isOnWifi = isOnWifi,
)

fun SubmitTaskResponseDto.toDomain(): TaskAccepted = TaskAccepted(
    taskId = taskId,
    status = TaskStatus.fromWire(status),
    websocketRoom = websocketRoom ?: taskId,
    estimatedMs = estimatedMs ?: 0,
    executionMode = executionMode,
    createdAt = createdAt,
)

fun TaskResponseDto.toDomain(): TaskSnapshot = TaskSnapshot(
    taskId = taskId,
    status = TaskStatus.fromWire(status),
    strategy = ExecutionStrategy.fromWire(strategy),
    taskType = taskType,
    createdAt = createdAt,
    completedAt = completedAt,
    errorCode = error?.code,
    output = result?.let {
        TaskOutput(
            text = it.output,
            format = it.format ?: "markdown",
            confidence = it.confidence,
            partial = it.partial,
        )
    },
    plan = plan?.toDomain(),
    subtasks = subtasks.map { it.toDomain() },
    verification = verification?.let {
        VerificationView(it.verified, it.confidence, it.issues, it.verifiedBy)
    },
    telemetry = telemetry?.toDomain() ?: TelemetryView.EMPTY,
)

fun PlanDto.toDomain(): PlanSummary = PlanSummary(
    id = id,
    strategy = ExecutionStrategy.fromWire(strategy),
    subtaskCount = subtaskCount,
    parallelGroups = parallelGroups,
    estimatedTokens = estimatedTokens,
    estimatedLatencyMs = estimatedLatencyMs,
    estimatedCost = estimatedCost,
    reliabilityScore = reliabilityScore,
    reasoning = reasoning.orEmpty(),
)

fun SubtaskDto.toDomain(): SubtaskView = SubtaskView(
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

fun TelemetryDto.toDomain(): TelemetryView = TelemetryView(
    totalMs = totalMs,
    estimatedTokens = estimatedTokens,
    actualTokens = actualTokens,
    savedTokens = savedTokens,
    savingsPercent = savingsPercent,
    failovers = failovers,
    cacheHits = cacheHits,
    providerBreakdown = providerBreakdown.map {
        ProviderUsageView(
            provider = it.provider ?: "unknown",
            model = it.model ?: "unknown",
            subtask = it.subtask,
            inputTokens = it.inputTokens,
            outputTokens = it.outputTokens,
            latencyMs = it.latencyMs,
        )
    },
)

fun TaskListItemDto.toDomain(): TaskListItem = TaskListItem(
    taskId = taskId,
    status = TaskStatus.fromWire(status),
    strategy = ExecutionStrategy.fromWire(strategy),
    taskType = taskType,
    inputPreview = inputPreview,
    confidence = confidence,
    actualTokens = actualTokens,
    savedTokens = savedTokens,
    totalMs = totalMs,
    createdAt = createdAt,
)

fun ProviderStatusDto.toDomain(): ProviderHealth = ProviderHealth(
    provider = provider,
    status = status ?: "unknown",
    activeKeys = activeKeys,
    rateLimitedKeys = rateLimitedKeys,
    avgLatencyMs = avgLatencyMs,
    healthScore = healthScore,
    quotaConsumedToday = quotaConsumedToday,
    models = models,
)
