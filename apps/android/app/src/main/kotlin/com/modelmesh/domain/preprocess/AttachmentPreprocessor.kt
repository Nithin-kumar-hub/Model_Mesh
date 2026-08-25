package com.modelmesh.domain.preprocess

import com.modelmesh.data.models.Attachment
import com.modelmesh.data.models.LocalMetadata
import com.modelmesh.util.AppResult

/**
 * The on-device preprocessing port.
 *
 * The phone extracts what it can before anything leaves the device: OCR text from
 * an image, a barcode payload, a language hint, page counts. That is what turns a
 * 4 MB scan into a few KB of text on the wire, and it is the only reason the
 * document path works on a slow connection.
 *
 * Implemented by `data/preprocess/OnDevicePreprocessor` with ML Kit. Declared here
 * so the domain layer and the UI depend on the capability, not on ML Kit.
 */
interface AttachmentPreprocessor {

    /** Extract everything usable from one picked/captured file. */
    suspend fun prepare(source: AttachmentSource): AppResult<PreparedAttachment>

    /**
     * Hardware and connectivity facts sent as routing hints. Only what the
     * platform actually reports — never a guess dressed up as a capability.
     */
    suspend fun deviceHints(): LocalMetadata
}

/**
 * A file the user picked, identified by URI string so the domain layer stays free
 * of `android.net.Uri`.
 */
data class AttachmentSource(
    val uri: String,
    val mimeType: String,
    val displayName: String,
)

/**
 * One preprocessed file: the wire-ready attachment plus the on-device findings
 * that belong in the submission's `localMetadata` rather than on the file itself.
 */
data class PreparedAttachment(
    val attachment: Attachment,
    val findings: LocalMetadata = LocalMetadata(),
    /** Kept for previews and re-reads; never sent. */
    val sourceUri: String? = null,
) {
    /** Characters the phone extracted, for the "we did this locally" readout. */
    val extractedChars: Int get() = attachment.detectedText?.length ?: 0
}

/**
 * Merge on-device findings. Left wins on conflict, so per-file results collected
 * earlier are not clobbered by a later file that found nothing.
 */
fun LocalMetadata.mergedWith(other: LocalMetadata): LocalMetadata = LocalMetadata(
    detectedText = listOfNotNull(detectedText?.takeIf { it.isNotBlank() }, other.detectedText?.takeIf { it.isNotBlank() })
        .joinToString("\n\n")
        .takeIf { it.isNotBlank() },
    detectedLanguage = detectedLanguage ?: other.detectedLanguage,
    barcodeData = barcodeData ?: other.barcodeData,
    imageWidth = imageWidth ?: other.imageWidth,
    imageHeight = imageHeight ?: other.imageHeight,
    audioDurationSeconds = audioDurationSeconds ?: other.audioDurationSeconds,
    deviceModel = deviceModel ?: other.deviceModel,
    hasNPU = hasNPU ?: other.hasNPU,
    hasGPU = hasGPU ?: other.hasGPU,
    batteryLevel = batteryLevel ?: other.batteryLevel,
    isOnWifi = isOnWifi ?: other.isOnWifi,
)
