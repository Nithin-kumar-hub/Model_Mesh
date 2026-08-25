package com.modelmesh.data.local

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/**
 * Every read the app performs goes through Room first, which is what makes the
 * repository's `observe*` flows emit before the network is touched.
 */
@Dao
interface TaskDao {

    @Upsert
    suspend fun upsert(entity: TaskEntity)

    @Upsert
    suspend fun upsertAll(entities: List<TaskEntity>)

    @Query("SELECT * FROM tasks WHERE taskId = :taskId")
    fun observeTask(taskId: String): Flow<TaskEntity?>

    @Query("SELECT * FROM tasks WHERE taskId = :taskId")
    suspend fun getTask(taskId: String): TaskEntity?

    @Query("SELECT * FROM tasks ORDER BY localCreatedAt DESC LIMIT :limit")
    fun observeHistory(limit: Int): Flow<List<TaskEntity>>

    /** Tasks the app never saw finish — an app killed mid-run leaves these behind. */
    @Query(
        """
        SELECT * FROM tasks
        WHERE status NOT IN ('completed','failed')
        ORDER BY localCreatedAt DESC
        """,
    )
    suspend fun getUnfinished(): List<TaskEntity>

    @Query("DELETE FROM tasks WHERE taskId = :taskId")
    suspend fun delete(taskId: String)
}
