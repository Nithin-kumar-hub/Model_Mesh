package com.modelmesh.domain.usecases

import com.modelmesh.data.models.TaskSnapshot
import com.modelmesh.domain.repository.TaskRepository
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

/** The task as currently known — cached first, then refreshed. */
class ObserveTaskUseCase @Inject constructor(
    private val repository: TaskRepository,
) {
    operator fun invoke(taskId: String): Flow<TaskSnapshot?> = repository.observeTask(taskId)
}
