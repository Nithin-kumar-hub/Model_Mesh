package com.modelmesh.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

/**
 * The task cache. One table: the app's offline story is entirely "what do we
 * already know about these tasks", so a second table would only duplicate it.
 */
@Database(entities = [TaskEntity::class], version = 1, exportSchema = true)
@TypeConverters(Converters::class)
abstract class ModelMeshDatabase : RoomDatabase() {

    abstract fun taskDao(): TaskDao

    companion object {
        const val DATABASE_NAME = "modelmesh.db"
    }
}
