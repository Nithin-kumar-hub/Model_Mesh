package com.modelmesh.domain.usecases

import com.modelmesh.data.models.TaskSnapshot
import com.modelmesh.domain.repository.TaskRepository
import com.modelmesh.util.AppResult
import javax.inject.Inject

/**
 * One forced read of the task. Used when a screen opens on an already-finished
 * task, and by a retry button after a failed fetch.
 */
class GetTaskUseCase @Inject constructor(
    private val repository: TaskRepository,
) {
    suspend operator fun invoke(taskId: String): AppResult<TaskSnapshot> = repository.refreshTask(taskId)
}
