package com.modelmesh.data.preprocess

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Base64
import android.util.Log
import com.google.android.gms.tasks.Task
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.modelmesh.data.models.Attachment
import com.modelmesh.data.models.LocalMetadata
import com.modelmesh.domain.preprocess.AttachmentPreprocessor
import com.modelmesh.domain.preprocess.AttachmentSource
import com.modelmesh.domain.preprocess.PreparedAttachment
import com.modelmesh.util.AppResult
import com.modelmesh.util.ErrorCode
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * On-device extraction, run before anything leaves the phone.
 *
 * This is where the product's phone-native claim is either true or it isn't. A
 * scanned PDF is rendered and OCR'd locally and travels as a few KB of text
 * instead of a few MB of pixels; a photo travels as bytes only because a vision
 * model consumes bytes directly.
 *
 * Extracted text lands in [Attachment.detectedText] — never in the user's
 * instruction. Rule 6 is a property of this file as much as of the backend.
 */
@Singleton
class OnDevicePreprocessor @Inject constructor(
    @ApplicationContext private val context: Context,
    private val deviceCapabilities: DeviceCapabilities,
) : AttachmentPreprocessor {

    // ML Kit clients are cheap to hold and expensive to build; this class is a
    // singleton for the process lifetime, so they are created once on first use.
    private val textRecognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
    private val barcodeScanner by lazy { BarcodeScanning.getClient() }
    private val languageIdentifier by lazy { LanguageIdentification.getClient() }

    override suspend fun deviceHints(): LocalMetadata = withContext(Dispatchers.IO) {
        deviceCapabilities.snapshot()
    }

    override suspend fun prepare(source: AttachmentSource): AppResult<PreparedAttachment> =
        withContext(Dispatchers.IO) {
            runCatching {
                val uri = Uri.parse(source.uri)
                val mime = source.mimeType.lowercase()
                when {
                    mime.startsWith("image/") -> prepareImage(uri, source)
                    mime == MIME_PDF -> preparePdf(uri, source)
                    mime.startsWith("audio/") || mime.startsWith("video/") -> prepareMedia(uri, source)
                    mime.startsWith("text/") -> prepareText(uri, source)
                    else -> prepareUnknown(uri, source)
                }
            }.getOrElse { error ->
                // Cancellation is not a preprocessing failure: swallowing it would
                // break structured concurrency for the screen that cancelled us.
                if (error is CancellationException) throw error
                // A file that cannot be read at all is the only hard failure here;
                // never throw otherwise, because the backend can often still handle
                // a file whose on-device pass found nothing.
                Log.w(TAG, "Preprocessing failed for ${source.displayName}", error)
                AppResult.Failure(
                    code = ErrorCode.INTERNAL,
                    message = error.message ?: "On-device preprocessing failed",
                    cause = error,
                )
            }
        }

    // ── Image ─────────────────────────────────────────────────────────────────

    /**
     * OCR, then barcode, then bytes. The image is the one modality where base64
     * is worth its size: a vision model reads the pixels directly.
     */
    private suspend fun prepareImage(uri: Uri, source: AttachmentSource): AppResult<PreparedAttachment> {
        val sizeBytes = sizeOf(uri)
        if (sizeBytes > MAX_FILE_BYTES) return tooLarge(source, sizeBytes)

        val bounds = safely("image bounds") { imageBounds(uri) }
        val image = safely("input image") { InputImage.fromFilePath(context, uri) }

        val ocrText = image?.let { safely("ocr") { textRecognizer.process(it).awaitResult().text } }
            ?.takeIf { it.isNotBlank() }
        val barcode = image?.let {
            safely("barcode") {
                barcodeScanner.process(it).awaitResult().firstNotNullOfOrNull { code -> code.rawValue }
            }
        }?.takeIf { it.isNotBlank() }

        val bytes = readBytes(uri)

        return AppResult.Success(
            PreparedAttachment(
                attachment = attachment(
                    source = source,
                    base64 = bytes?.let { Base64.encodeToString(it, Base64.NO_WRAP) },
                    sizeBytes = bytes?.size?.toLong() ?: sizeBytes,
                    detectedText = ocrText?.capText(),
                    imageWidth = bounds?.first,
                    imageHeight = bounds?.second,
                ),
                findings = LocalMetadata(
                    detectedLanguage = ocrText?.let { languageOf(it) },
                    barcodeData = barcode?.take(MAX_BARCODE_CHARS),
                ),
                sourceUri = source.uri,
            ),
        )
    }

    // ── PDF ───────────────────────────────────────────────────────────────────

    /**
     * `PdfRenderer` is part of the platform (API 21+), so this path is fully
     * offline and needs no Play services: render each page, OCR the bitmap, send
     * the text. **No base64 for a PDF** — that is the entire point.
     */
    private suspend fun preparePdf(uri: Uri, source: AttachmentSource): AppResult<PreparedAttachment> {
        val extraction = safely("pdf render") { extractPdfText(uri) }

        return AppResult.Success(
            PreparedAttachment(
                attachment = attachment(
                    source = source,
                    base64 = null,
                    sizeBytes = sizeOf(uri),
                    detectedText = extraction?.text?.takeIf { it.isNotBlank() }?.capText(),
                    pageCount = extraction?.totalPages,
                ),
                findings = LocalMetadata(
                    detectedLanguage = extraction?.text?.takeIf { it.isNotBlank() }?.let { languageOf(it) },
                ),
                sourceUri = source.uri,
            ),
        )
    }

    private data class PdfExtraction(val text: String, val totalPages: Int, val renderedPages: Int)

    private suspend fun extractPdfText(uri: Uri): PdfExtraction {
        val descriptor = context.contentResolver.openFileDescriptor(uri, "r")
            ?: error("Cannot open ${uri.lastPathSegment ?: "document"}")

        return descriptor.use { fd ->
            PdfRenderer(fd).use { renderer ->
                val totalPages = renderer.pageCount
                val rendered = minOf(totalPages, MAX_PDF_PAGES)
                val blocks = ArrayList<String>(rendered)

                for (index in 0 until rendered) {
                    val pageText = renderer.openPage(index).use { page ->
                        // Rendering above 1:1 measurably improves OCR on small type;
                        // the bitmap is recycled immediately so peak memory stays
                        // one page, not the document.
                        val bitmap = Bitmap.createBitmap(
                            page.width * PDF_RENDER_SCALE,
                            page.height * PDF_RENDER_SCALE,
                            Bitmap.Config.ARGB_8888,
                        )
                        try {
                            // PdfRenderer composites onto transparency; OCR needs
                            // a white sheet or the glyphs vanish.
                            Canvas(bitmap).drawColor(Color.WHITE)
                            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            textRecognizer.process(InputImage.fromBitmap(bitmap, 0)).awaitResult().text
                        } finally {
                            bitmap.recycle()
                        }
                    }

                    blocks += "--- Page ${index + 1} ---\n${pageText.trim()}"
                }

                if (totalPages > rendered) {
                    // A truncated read must be visible in the text itself, or a
                    // model would answer confidently about pages it never saw.
                    blocks += "--- Extraction stopped after $rendered of $totalPages pages (on-device page cap) ---"
                }

                PdfExtraction(
                    text = blocks.joinToString("\n\n"),
                    totalPages = totalPages,
                    renderedPages = rendered,
                )
            }
        }
    }

    // ── Audio / video ─────────────────────────────────────────────────────────

    /**
     * There is no offline ML Kit transcription, so nothing is extracted here — only
     * the duration, which is a real fact the platform reports.
     *
     * No base64 either: the backend forwards inline bytes for `image/*` only
     * (`apps/api/src/core/pipeline.ts` `collectImages`), so uploading a voice note
     * would spend the user's data on bytes nothing reads. See
     * `.claude/IMPLEMENTATION-NOTES.md`.
     */
    private fun prepareMedia(uri: Uri, source: AttachmentSource): AppResult<PreparedAttachment> {
        val durationSeconds = safelyBlocking("media duration") { durationSecondsOf(uri) }

        return AppResult.Success(
            PreparedAttachment(
                attachment = attachment(
                    source = source,
                    base64 = null,
                    sizeBytes = sizeOf(uri),
                    detectedText = null,
                    audioDurationSeconds = durationSeconds,
                ),
                findings = LocalMetadata(audioDurationSeconds = durationSeconds),
                sourceUri = source.uri,
            ),
        )
    }

    private fun durationSecondsOf(uri: Uri): Double? {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, uri)
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull()
                ?.let { it / 1000.0 }
        } finally {
            retriever.release()
        }
    }

    // ── Text ──────────────────────────────────────────────────────────────────

    private suspend fun prepareText(uri: Uri, source: AttachmentSource): AppResult<PreparedAttachment> {
        val text = readBytes(uri)?.toString(Charsets.UTF_8)?.takeIf { it.isNotBlank() }

        return AppResult.Success(
            PreparedAttachment(
                attachment = attachment(
                    source = source,
                    base64 = null,
                    sizeBytes = sizeOf(uri),
                    detectedText = text?.capText(),
                ),
                findings = LocalMetadata(detectedLanguage = text?.let { languageOf(it) }),
                sourceUri = source.uri,
            ),
        )
    }

    // ── Anything else ─────────────────────────────────────────────────────────

    /**
     * Returned unchanged. The backend rejects an unknown MIME type as
     * `UNSUPPORTED_MODALITY` unless it carries `detectedText` — that is the
     * documented contract, not a bug to route around here.
     */
    private fun prepareUnknown(uri: Uri, source: AttachmentSource): AppResult<PreparedAttachment> =
        AppResult.Success(
            PreparedAttachment(
                attachment = attachment(source = source, base64 = null, sizeBytes = sizeOf(uri)),
                sourceUri = source.uri,
            ),
        )

    // ── Shared helpers ────────────────────────────────────────────────────────

    private fun attachment(
        source: AttachmentSource,
        base64: String?,
        sizeBytes: Long,
        detectedText: String? = null,
        pageCount: Int? = null,
        imageWidth: Int? = null,
        imageHeight: Int? = null,
        audioDurationSeconds: Double? = null,
    ): Attachment = Attachment(
        id = UUID.randomUUID().toString(),
        mimeType = source.mimeType,
        base64 = base64,
        displayName = source.displayName,
        sizeBytes = sizeBytes,
        pageCount = pageCount,
        imageWidth = imageWidth,
        imageHeight = imageHeight,
        audioDurationSeconds = audioDurationSeconds,
        detectedText = detectedText,
        preprocessedAt = Instant.now().toString(),
    )

    private fun tooLarge(source: AttachmentSource, sizeBytes: Long): AppResult.Failure =
        AppResult.Failure(
            code = ErrorCode.FILE_TOO_LARGE,
            message = "${source.displayName} is ${sizeBytes / (1024 * 1024)} MB; the limit is " +
                "${MAX_FILE_BYTES / (1024 * 1024)} MB",
        )

    private fun sizeOf(uri: Uri): Long =
        runCatching { context.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize } }
            .getOrNull()
            ?.coerceAtLeast(0L)
            ?: 0L

    private fun readBytes(uri: Uri): ByteArray? =
        safelyBlocking("read bytes") {
            context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
        }

    private fun imageBounds(uri: Uri): Pair<Int, Int>? {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
        return if (options.outWidth > 0 && options.outHeight > 0) {
            options.outWidth to options.outHeight
        } else {
            null
        }
    }

    /** Only a confident identification is reported; `und` means "do not claim". */
    private suspend fun languageOf(text: String): String? =
        safely("language id") {
            languageIdentifier.identifyLanguage(text.take(LANGUAGE_SAMPLE_CHARS)).awaitResult()
        }?.takeIf { it != UNDETERMINED_LANGUAGE }

    /**
     * The backend caps `metadata.detectedText` at 500 000 chars. Truncating here
     * with a visible marker beats a 400 the user cannot act on.
     */
    private fun String.capText(): String =
        if (length <= MAX_DETECTED_TEXT_CHARS) {
            this
        } else {
            take(MAX_DETECTED_TEXT_CHARS) + "\n\n--- Extracted text truncated at $MAX_DETECTED_TEXT_CHARS characters ---"
        }

    private suspend fun <T> safely(label: String, block: suspend () -> T): T? =
        try {
            block()
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (error: Throwable) {
            Log.w(TAG, "On-device step '$label' failed: ${error.message}")
            null
        }

    private fun <T> safelyBlocking(label: String, block: () -> T): T? =
        runCatching { block() }
            .onFailure { Log.w(TAG, "On-device step '$label' failed: ${it.message}") }
            .getOrNull()

    /**
     * `kotlinx-coroutines-play-services` (which supplies `Task.await()`) is not a
     * dependency and `app/build.gradle.kts` is frozen, so the bridge is written by
     * hand. Cancelling the collector cancels the wait.
     */
    private suspend fun <T> Task<T>.awaitResult(): T = suspendCancellableCoroutine { continuation ->
        addOnSuccessListener { result -> continuation.resume(result) }
        addOnFailureListener { error -> continuation.resumeWithException(error) }
        addOnCanceledListener { continuation.cancel() }
    }

    private companion object {
        const val TAG = "OnDevicePreprocessor"
        const val MIME_PDF = "application/pdf"

        /** Mirrors the backend's `MAX_FILE_BYTES` default (20 MB). */
        const val MAX_FILE_BYTES = 20L * 1024 * 1024

        /** Backend cap on `metadata.detectedText`. */
        const val MAX_DETECTED_TEXT_CHARS = 500_000

        /** Backend cap on `localMetadata.barcodeData`. */
        const val MAX_BARCODE_CHARS = 8_000

        const val MAX_PDF_PAGES = 20
        const val PDF_RENDER_SCALE = 2
        const val LANGUAGE_SAMPLE_CHARS = 200
        const val UNDETERMINED_LANGUAGE = "und"
    }
}
