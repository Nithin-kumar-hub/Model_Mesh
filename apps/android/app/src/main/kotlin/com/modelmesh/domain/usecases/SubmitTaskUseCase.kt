package com.modelmesh.domain.usecases

import com.modelmesh.data.models.ExecutionStrategy
import com.modelmesh.data.models.InputType
import com.modelmesh.data.models.LocalMetadata
import com.modelmesh.data.models.TaskAccepted
import com.modelmesh.data.models.TaskBudget
import com.modelmesh.data.models.TaskPreferences
import com.modelmesh.data.models.TaskSubmission
import com.modelmesh.domain.preprocess.PreparedAttachment
import com.modelmesh.domain.preprocess.mergedWith
import com.modelmesh.domain.repository.TaskRepository
import com.modelmesh.util.AppResult
import javax.inject.Inject

/**
 * Builds the submission from the pieces a screen actually has, then hands it to
 * the repository.
 *
 * This lives in the domain layer for one reason: assembling the request is where
 * Rule 6 could be broken. The typed instruction goes in `userIntent`; extracted
 * document text goes in the attachment and in `localMetadata`. They are never
 * concatenated, so a hostile PDF cannot reach the directive channel by being
 * pasted into it here.
 */
class SubmitTaskUseCase @Inject constructor(
    private val repository: TaskRepository,
) {

    suspend operator fun invoke(
        userIntent: String,
        attachments: List<PreparedAttachment> = emptyList(),
        strategy: ExecutionStrategy = ExecutionStrategy.BALANCED,
        budget: TaskBudget? = null,
        preferences: TaskPreferences = TaskPreferences(),
        sessionId: String? = null,
    ): AppResult<TaskAccepted> {
        val findings = attachments.fold(LocalMetadata()) { acc, prepared -> acc.mergedWith(prepared.findings) }

        return repository.submit(
            TaskSubmission(
                type = inputTypeFor(userIntent, attachments),
                userIntent = userIntent.trim(),
                attachments = attachments.map { it.attachment },
                localMetadata = findings,
                strategy = strategy,
                budget = budget,
                preferences = preferences,
                sessionId = sessionId,
            ),
        )
    }

    /**
     * The backend derives modalities from the files themselves and ignores
     * `multipart` when doing so, so a mixed submission is honestly labelled
     * `multipart` without losing the vision or document hint.
     */
    private fun inputTypeFor(userIntent: String, attachments: List<PreparedAttachment>): InputType {
        if (attachments.isEmpty()) return InputType.TEXT

        val single = attachments.singleOrNull()
        if (single != null && userIntent.isBlank()) {
            val mime = single.attachment.mimeType
            if (single.findings.barcodeData != null) return InputType.QR
            return when {
                mime.startsWith("image/") -> InputType.IMAGE
                mime == "application/pdf" -> InputType.PDF
                mime.startsWith("audio/") -> InputType.AUDIO
                mime.startsWith("video/") -> InputType.VIDEO
                else -> InputType.TEXT
            }
        }

        return InputType.MULTIPART
    }
}
