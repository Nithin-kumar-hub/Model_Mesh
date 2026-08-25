package com.modelmesh.domain.repository

import com.modelmesh.data.models.ProviderHealth
import com.modelmesh.data.models.TaskAccepted
import com.modelmesh.data.models.TaskListItem
import com.modelmesh.data.models.TaskSnapshot
import com.modelmesh.data.models.TaskSubmission
import com.modelmesh.data.models.TimelineUpdate
import com.modelmesh.util.AppResult
import kotlinx.coroutines.flow.Flow

/**
 * The single boundary between the UI and everything that talks to a network, a
 * database, or the camera.
 *
 * Every `observe*` flow is offline-first: it emits whatever Room already holds —
 * immediately, even with the radio off — and then emits again once the backend has
 * been reached. A screen therefore never has to distinguish "loading" from "no
 * data"; it renders what it has and updates.
 */
interface TaskRepository {

    /**
     * Submit a task. The implementation attaches device hints, writes the accepted
     * task to Room before returning, and leaves `userIntent` and attachment
     * content in separate fields all the way to the wire (Rule 6).
     */
    suspend fun submit(submission: TaskSubmission): AppResult<TaskAccepted>

    /**
     * The task as currently known. Emits the cached snapshot first, then refreshed
     * ones. Emits `null` only when the task is unknown both locally and remotely.
     */
    fun observeTask(taskId: String): Flow<TaskSnapshot?>

    /** Force one read of `GET /tasks/:taskId` and persist the result. */
    suspend fun refreshTask(taskId: String): AppResult<TaskSnapshot>

    /**
     * The execution trace: Socket.io `trace_history` replay followed by live
     * `trace` events, folded into an [com.modelmesh.data.models.ExecutionTimeline].
     * Falls back to polling `GET /tasks/:taskId/trace` when the socket cannot
     * connect, and reports that in [TimelineUpdate.connection] rather than
     * silently going quiet.
     */
    fun observeTimeline(taskId: String): Flow<TimelineUpdate>

    /** Task history, newest first. Cache-first, then synced. */
    fun observeHistory(limit: Int = DEFAULT_HISTORY_LIMIT): Flow<List<TaskListItem>>

    /**
     * Locally-known tasks that never reached a terminal status — an app killed
     * mid-run leaves these behind, and the user gets them back instead of a task
     * that silently vanished.
     */
    suspend fun unfinishedTasks(): List<TaskListItem>

    suspend fun submitFeedback(taskId: String, rating: Int, comment: String? = null): AppResult<Unit>

    suspend fun providerHealth(): AppResult<List<ProviderHealth>>

    companion object {
        const val DEFAULT_HISTORY_LIMIT = 50
    }
}
