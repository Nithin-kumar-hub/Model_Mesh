package com.modelmesh.data.local

import com.modelmesh.data.models.ExecutionStrategy
import com.modelmesh.data.models.TaskAccepted
import com.modelmesh.data.models.TaskListItem
import com.modelmesh.data.models.TaskOutput
import com.modelmesh.data.models.TaskSnapshot
import com.modelmesh.data.models.TaskStatus
import com.modelmesh.data.models.TaskSubmission
import com.modelmesh.data.models.TelemetryView
import java.time.Instant

/**
 * The only place that knows both the row layout and the domain model.
 *
 * Keeping the mapping here rather than in the repository means a column rename is
 * one compile error in one file, and the repository reads as pure policy.
 */

/** Longest instruction excerpt kept for the history list. */
private const val PREVIEW_CHARS = 120

/**
 * Prefix for a row written before the backend has issued a task id. Such a row
 * cannot be reconciled with the server, so [com.modelmesh.data.repository.TaskRepositoryImpl]
 * removes it as soon as the submission resolves — and purges any left behind by a
 * process death — instead of leaving an un-openable task in the history.
 */
const val LOCAL_TASK_ID_PREFIX = "local-"

val TaskEntity.isLocalOnly: Boolean get() = taskId.startsWith(LOCAL_TASK_ID_PREFIX)

fun TaskEntity.toDomain(): TaskSnapshot = TaskSnapshot(
    taskId = taskId,
    status = TaskStatus.fromWire(status),
    strategy = ExecutionStrategy.fromWire(strategy),
    taskType = taskType,
    createdAt = createdAt,
    completedAt = completedAt,
    errorCode = errorCode,
    output = outputText?.let {
        TaskOutput(
            text = it,
            format = outputFormat,
            confidence = outputConfidence,
            partial = outputPartial,
        )
    },
    plan = planJson,
    subtasks = subtasksJson ?: emptyList(),
    verification = verificationJson,
    telemetry = telemetryJson ?: TelemetryView.EMPTY,
)

fun TaskEntity.toListItem(): TaskListItem = TaskListItem(
    taskId = taskId,
    status = TaskStatus.fromWire(status),
    strategy = ExecutionStrategy.fromWire(strategy),
    taskType = taskType,
    inputPreview = inputPreview,
    confidence = confidence,
    actualTokens = actualTokens,
    savedTokens = savedTokens,
    totalMs = totalMs,
    createdAt = createdAt,
)

fun TaskSnapshot.toEntity(inputPreview: String? = null): TaskEntity = TaskEntity(
    taskId = taskId,
    status = status.wire,
    strategy = strategy.wire,
    taskType = taskType,
    inputPreview = inputPreview,
    createdAt = createdAt,
    completedAt = completedAt,
    errorCode = errorCode,
    outputText = output?.text,
    outputFormat = output?.format ?: "markdown",
    outputConfidence = output?.confidence,
    outputPartial = output?.partial ?: false,
    telemetryJson = telemetry,
    planJson = plan,
    subtasksJson = subtasks,
    verificationJson = verification,
    savedTokens = telemetry.savedTokens,
    actualTokens = telemetry.actualTokens,
    totalMs = telemetry.totalMs,
    confidence = output?.confidence,
    localCreatedAt = sortKeyFor(createdAt),
)

/**
 * The row written the moment the backend accepts a submission, so the trace screen
 * can be opened from cache and a killed process still knows the task exists.
 *
 * [TaskAccepted] carries no strategy — the 202 response does not echo it — so the
 * caller passes the strategy it submitted.
 */
fun TaskAccepted.toInitialEntity(
    strategy: ExecutionStrategy,
    inputPreview: String? = null,
): TaskEntity = TaskEntity(
    taskId = taskId,
    status = status.wire,
    strategy = strategy.wire,
    inputPreview = inputPreview,
    createdAt = createdAt,
    localCreatedAt = sortKeyFor(createdAt),
)

/**
 * A row for a submission that has not been acknowledged yet.
 *
 * Only the typed instruction is previewed. Extracted document text never reaches
 * this field — Rule 6 holds in storage as well as on the wire.
 */
fun TaskSubmission.toPendingEntity(localTaskId: String): TaskEntity = TaskEntity(
    taskId = localTaskId,
    status = TaskStatus.RECEIVED.wire,
    strategy = strategy.wire,
    inputPreview = userIntent.take(PREVIEW_CHARS).ifBlank { null },
)

/** A history row synced from `GET /tasks` for a task this device has never seen. */
fun TaskListItem.toEntity(): TaskEntity = TaskEntity(
    taskId = taskId,
    status = status.wire,
    strategy = strategy.wire,
    taskType = taskType,
    inputPreview = inputPreview,
    createdAt = createdAt,
    confidence = confidence,
    actualTokens = actualTokens,
    savedTokens = savedTokens,
    totalMs = totalMs,
    localCreatedAt = sortKeyFor(createdAt),
)

/**
 * Fold a history row into what is already cached.
 *
 * The list endpoint carries no output, plan, or subtasks, so a blind upsert would
 * erase a full snapshot this device already fetched.
 */
fun TaskEntity.withListItem(item: TaskListItem): TaskEntity = copy(
    status = item.status.wire,
    strategy = item.strategy.wire,
    taskType = item.taskType ?: taskType,
    inputPreview = item.inputPreview ?: inputPreview,
    createdAt = item.createdAt ?: createdAt,
    confidence = item.confidence ?: confidence,
    actualTokens = item.actualTokens ?: actualTokens,
    savedTokens = item.savedTokens ?: savedTokens,
    totalMs = item.totalMs ?: totalMs,
)

/**
 * Sort key for the history list.
 *
 * Derived from the server timestamp when there is one so repeated refreshes never
 * reorder the list; wall-clock time is only the fallback for a row the backend has
 * not acknowledged yet.
 */
private fun sortKeyFor(createdAt: String?): Long =
    createdAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
        ?: System.currentTimeMillis()
