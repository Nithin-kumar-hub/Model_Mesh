package com.modelmesh.domain.usecases

import com.modelmesh.data.models.TaskListItem
import com.modelmesh.domain.repository.TaskRepository
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

/** Task history, newest first. Readable with the radio off. */
class GetTaskHistoryUseCase @Inject constructor(
    private val repository: TaskRepository,
) {
    operator fun invoke(limit: Int = TaskRepository.DEFAULT_HISTORY_LIMIT): Flow<List<TaskListItem>> =
        repository.observeHistory(limit)
}
