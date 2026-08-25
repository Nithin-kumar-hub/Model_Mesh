package com.modelmesh

import android.app.Application
import android.util.Log
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import androidx.work.WorkManager
import com.modelmesh.data.work.TaskSyncWorker
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

/**
 * Hilt's application component, and the one place background sync is scheduled.
 *
 * The frozen manifest removes `WorkManagerInitializer`, so WorkManager is
 * configured on demand through [Configuration.Provider] — that is what lets
 * [TaskSyncWorker] receive the repository by injection instead of constructing its
 * own stack.
 */
@HiltAndroidApp
class ModelMeshApplication : Application(), Configuration.Provider {

    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .setMinimumLoggingLevel(if (BuildConfig.DEBUG) Log.INFO else Log.WARN)
            .build()

    override fun onCreate() {
        // Field injection happens here, so `workerFactory` is only safe to read —
        // and WorkManager only safe to touch — after this call.
        super.onCreate()
        TaskSyncWorker.schedule(WorkManager.getInstance(this))
    }
}
