package com.modelmesh.data.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.modelmesh.domain.repository.TaskRepository
import com.modelmesh.util.AppResult
import com.modelmesh.util.ErrorCode
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.concurrent.TimeUnit

/**
 * Catches up tasks the app never saw finish.
 *
 * A task killed with the app keeps running on the backend; without this worker the
 * row stays on "executing" until the user happens to open it again. Only
 * non-terminal tasks are refreshed, newest first, and only a handful per run — the
 * backend's read rate limit is 60/min and a phone should not spend it on
 * housekeeping.
 */
@HiltWorker
class TaskSyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
    private val repository: TaskRepository,
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        val pending = repository.unfinishedTasks().take(MAX_TASKS_PER_RUN)
        if (pending.isEmpty()) return Result.success()

        var offline = false
        for (task in pending) {
            val result = repository.refreshTask(task.taskId)
            if (result is AppResult.Failure && result.code == ErrorCode.OFFLINE) {
                // The network went away mid-run; retrying the whole batch later is
                // cheaper than hammering the remaining ids now.
                offline = true
                break
            }
        }

        return if (offline) Result.retry() else Result.success()
    }

    companion object {
        const val UNIQUE_WORK_NAME = "task-sync"

        private const val MAX_TASKS_PER_RUN = 10
        private const val INTERVAL_MINUTES = 15L

        /**
         * `KEEP` so an app restart does not reset the interval — the existing
         * schedule is already correct.
         */
        fun schedule(workManager: WorkManager) {
            val request = PeriodicWorkRequestBuilder<TaskSyncWorker>(INTERVAL_MINUTES, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()

            workManager.enqueueUniquePeriodicWork(
                UNIQUE_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }
    }
}
