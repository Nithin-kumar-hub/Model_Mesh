package com.modelmesh.domain.usecases

import com.modelmesh.domain.preprocess.AttachmentPreprocessor
import com.modelmesh.domain.preprocess.AttachmentSource
import com.modelmesh.domain.preprocess.PreparedAttachment
import com.modelmesh.util.AppResult
import javax.inject.Inject

/**
 * Run on-device extraction over one picked or captured file.
 *
 * Called as soon as the file is chosen, not at submit time, so the input screen can
 * show what the phone found locally before anything is uploaded.
 */
class PreprocessAttachmentUseCase @Inject constructor(
    private val preprocessor: AttachmentPreprocessor,
) {
    suspend operator fun invoke(
        uri: String,
        mimeType: String,
        displayName: String,
    ): AppResult<PreparedAttachment> =
        preprocessor.prepare(AttachmentSource(uri = uri, mimeType = mimeType, displayName = displayName))
}
