package com.modelmesh.domain.usecases

import com.modelmesh.domain.repository.TaskRepository
import com.modelmesh.util.AppResult
import javax.inject.Inject

/**
 * Rate a finished task. The backend feeds this into the calibration loop (Rule 4),
 * so it is a real signal rather than a vanity control.
 */
class SubmitFeedbackUseCase @Inject constructor(
    private val repository: TaskRepository,
) {
    suspend operator fun invoke(taskId: String, rating: Int, comment: String? = null): AppResult<Unit> =
        repository.submitFeedback(taskId, rating, comment)
}
