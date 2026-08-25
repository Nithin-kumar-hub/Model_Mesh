package com.modelmesh.di

import android.content.Context
import androidx.room.Room
import com.modelmesh.data.local.ModelMeshDatabase
import com.modelmesh.data.local.TaskDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun database(@ApplicationContext context: Context): ModelMeshDatabase =
        Room.databaseBuilder(context, ModelMeshDatabase::class.java, ModelMeshDatabase.DATABASE_NAME)
            // Acceptable while the schema is at version 1 and the database is a
            // cache of server state: the worst case is one refetch. A real
            // migration is required before any locally-authored data lands here.
            .fallbackToDestructiveMigration()
            .build()

    @Provides
    fun taskDao(database: ModelMeshDatabase): TaskDao = database.taskDao()
}
