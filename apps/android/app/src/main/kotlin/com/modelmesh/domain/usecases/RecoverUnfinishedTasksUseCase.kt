package com.modelmesh.domain.usecases

import com.modelmesh.data.models.TaskListItem
import com.modelmesh.domain.repository.TaskRepository
import javax.inject.Inject

/**
 * Tasks that were submitted but never reached a terminal status locally.
 *
 * A task killed with the app still exists on the backend; re-reading it is how the
 * user gets the answer they already paid tokens for instead of a row stuck on
 * "executing" forever.
 */
class RecoverUnfinishedTasksUseCase @Inject constructor(
    private val repository: TaskRepository,
) {
    suspend operator fun invoke(): List<TaskListItem> = repository.unfinishedTasks()
}
