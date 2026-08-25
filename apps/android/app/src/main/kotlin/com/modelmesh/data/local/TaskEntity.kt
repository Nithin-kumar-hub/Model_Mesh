package com.modelmesh.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.modelmesh.data.models.PlanSummary
import com.modelmesh.data.models.SubtaskView
import com.modelmesh.data.models.TelemetryView
import com.modelmesh.data.models.VerificationView

/**
 * One row per task — enough to rebuild the history list, re-open the trace screen
 * after the process was killed, and recover a run that never reached a terminal
 * status, all with the radio off.
 *
 * The four `*Json` properties are stored as JSON TEXT columns by [Converters];
 * the suffix names the storage form, the type names the value. Nullability
 * mirrors the backend exactly: a field the server omits is stored as null rather
 * than as a fabricated default.
 */
@Entity(tableName = "tasks")
data class TaskEntity(
    @PrimaryKey val taskId: String,
    /** `TaskStatus.wire`. */
    val status: String,
    /** `ExecutionStrategy.wire`. */
    val strategy: String,
    val taskType: String? = null,
    /** First 120 chars of the typed instruction — never extracted file text (Rule 6). */
    val inputPreview: String? = null,
    val createdAt: String? = null,
    val completedAt: String? = null,
    val errorCode: String? = null,
    val outputText: String? = null,
    val outputFormat: String = "markdown",
    val outputConfidence: Double? = null,
    val outputPartial: Boolean = false,
    val telemetryJson: TelemetryView? = null,
    val planJson: PlanSummary? = null,
    val subtasksJson: List<SubtaskView>? = null,
    val verificationJson: VerificationView? = null,
    // Denormalized so the history list renders without deserializing telemetry
    // for every row.
    val savedTokens: Int? = null,
    val actualTokens: Int? = null,
    val totalMs: Long? = null,
    val confidence: Double? = null,
    /**
     * Sort key for the history list. Derived from the server's `createdAt` when
     * there is one, so a refresh never reshuffles the list, and only falls back
     * to wall-clock time for a row the backend has not acknowledged yet.
     */
    val localCreatedAt: Long = System.currentTimeMillis(),
)
