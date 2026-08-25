package com.modelmesh.data.models

/**
 * What the phone sends up.
 *
 * `userIntent` and `attachments` stay separate all the way to the wire: the
 * backend treats the typed instruction as the directive channel and the file
 * contents as untrusted material (Rule 6). Merging them here would defeat that
 * before the request ever left the device.
 */
data class TaskSubmission(
    val type: InputType,
    val userIntent: String,
    val attachments: List<Attachment> = emptyList(),
    val localMetadata: LocalMetadata = LocalMetadata(),
    val strategy: ExecutionStrategy = ExecutionStrategy.BALANCED,
    val budget: TaskBudget? = null,
    val preferences: TaskPreferences = TaskPreferences(),
    val sessionId: String? = null,
)

/**
 * One file, already preprocessed on device where possible.
 *
 * `base64` is only populated for modalities a cloud model consumes directly
 * (images). For a PDF or an audio note, `detectedText` from ML Kit is sent
 * instead — the phone did the extraction, so the upload is text, not megabytes.
 */
data class Attachment(
    val id: String,
    val mimeType: String,
    val base64: String? = null,
    val displayName: String = id,
    val sizeBytes: Long = 0,
    val pageCount: Int? = null,
    val imageWidth: Int? = null,
    val imageHeight: Int? = null,
    val audioDurationSeconds: Double? = null,
    /** On-device OCR / document-scanner output. */
    val detectedText: String? = null,
    val preprocessedAt: String? = null,
) {
    val isImage: Boolean get() = mimeType.startsWith("image/")
    val hasOnDeviceText: Boolean get() = !detectedText.isNullOrBlank()
}

/**
 * On-device work and hardware facts, passed as routing hints. The backend is
 * free to ignore them; it never has to trust them for correctness.
 */
data class LocalMetadata(
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

data class TaskBudget(
    val maxTokens: Int? = null,
    val maxLatencyMs: Int? = null,
    val minQuality: Double? = null,
)

data class TaskPreferences(
    val preferLocalModels: Boolean = false,
    val explainPlan: Boolean = true,
    val streamTrace: Boolean = true,
)

/** The 202 response: enough to open the trace screen immediately. */
data class TaskAccepted(
    val taskId: String,
    val status: TaskStatus,
    val websocketRoom: String,
    val estimatedMs: Long,
    val executionMode: String?,
    val createdAt: String?,
)
