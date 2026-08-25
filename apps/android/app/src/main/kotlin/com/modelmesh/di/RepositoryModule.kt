package com.modelmesh.di

import com.modelmesh.data.preprocess.OnDevicePreprocessor
import com.modelmesh.data.repository.TaskRepositoryImpl
import com.modelmesh.domain.preprocess.AttachmentPreprocessor
import com.modelmesh.domain.repository.TaskRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * The two ports the domain layer declares, bound to their implementations. Nothing
 * above the data layer knows that Room, Retrofit, or ML Kit exist.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun taskRepository(impl: TaskRepositoryImpl): TaskRepository

    @Binds
    @Singleton
    abstract fun attachmentPreprocessor(impl: OnDevicePreprocessor): AttachmentPreprocessor
}
