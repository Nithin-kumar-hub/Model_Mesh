package com.modelmesh.domain.usecases

import com.modelmesh.data.models.TimelineUpdate
import com.modelmesh.domain.repository.TaskRepository
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

/**
 * The live execution trace, folded into a timeline.
 *
 * Emits the replayed history first, so a screen opened late still draws the whole
 * pipeline instead of starting mid-run.
 */
class ObserveTraceUseCase @Inject constructor(
    private val repository: TaskRepository,
) {
    operator fun invoke(taskId: String): Flow<TimelineUpdate> = repository.observeTimeline(taskId)
}
