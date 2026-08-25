package com.modelmesh.data.api.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Wire shapes for `POST /tasks` (docs/04-API-SPEC.md).
 *
 * Nulls are omitted by the configured Json instance, so an absent budget or
 * preference block is genuinely absent rather than a null the backend's strict
 * Zod schema would reject.
 */
@Serializable
data class SubmitTaskRequestDto(
    val input: TaskInputDto,
    val strategy: String? = null,
    val budget: BudgetDto? = null,
    val preferences: PreferencesDto? = null,
    val sessionId: String? = null,
)

@Serializable
data class TaskInputDto(
    val type: String,
    val text: String? = null,
    val files: List<FileDto>? = null,
    val localMetadata: LocalMetadataDto? = null,
)

@Serializable
data class FileDto(
    val id: String,
    val mimeType: String,
    val base64: String? = null,
    val url: String? = null,
    val metadata: FileMetadataDto? = null,
)

@Serializable
data class FileMetadataDto(
    val pageCount: Int? = null,
    val sizeBytes: Long? = null,
    val imageWidth: Int? = null,
    val imageHeight: Int? = null,
    val audioDurationSeconds: Double? = null,
    val preprocessedAt: String? = null,
    /** On-device OCR text — how a PDF becomes a few KB instead of a few MB. */
    val detectedText: String? = null,
)

@Serializable
data class LocalMetadataDto(
    val detectedText: String? = null,
    val detectedLanguage: String? = null,
    val barcodeData: String? = null,
    val imageWidth: Int? = null,
    val imageHeight: Int? = null,
    val audioDurationSeconds: Double? = null,
    val deviceModel: String? = null,
    val hasNPU: Boolean? = null,
    val hasGPU: Boolean? = null,
    val batteryLevel: Int? = null,
    val isOnWifi: Boolean? = null,
)

@Serializable
data class BudgetDto(
    val maxTokens: Int? = null,
    val maxLatencyMs: Int? = null,
    val minQuality: Double? = null,
)

@Serializable
data class PreferencesDto(
    val preferLocalModels: Boolean? = null,
    val explainPlan: Boolean? = null,
    val streamTrace: Boolean? = null,
)

@Serializable
data class FeedbackRequestDto(
    val rating: Int,
    val comment: String? = null,
    val actualQuality: Double? = null,
)

@Serializable
data class AddKeyRequestDto(
    val provider: String,
    val key: String,
    val priority: Int? = null,
    val label: String? = null,
    @SerialName("quotaLimit") val quotaLimit: Long? = null,
)
