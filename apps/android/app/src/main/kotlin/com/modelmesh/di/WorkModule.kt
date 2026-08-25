package com.modelmesh.di

import android.content.Context
import androidx.work.WorkManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object WorkModule {

    /**
     * `getInstance` triggers WorkManager's on-demand initialization, which reads
     * `ModelMeshApplication.workManagerConfiguration` — the frozen manifest removes
     * the default initializer so the Hilt worker factory is the one that is used.
     */
    @Provides
    @Singleton
    fun workManager(@ApplicationContext context: Context): WorkManager = WorkManager.getInstance(context)
}
