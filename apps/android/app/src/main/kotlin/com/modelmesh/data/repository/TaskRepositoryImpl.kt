package com.modelmesh.data.repository

import android.util.Log
import com.modelmesh.data.api.ModelMeshApi
import com.modelmesh.data.api.TraceEventMapper
import com.modelmesh.data.api.TraceSocketClient
import com.modelmesh.data.api.dto.ErrorEnvelopeDto
import com.modelmesh.data.api.dto.FeedbackRequestDto
import com.modelmesh.data.api.dto.toDomain
import com.modelmesh.data.api.dto.toDto
import com.modelmesh.data.local.LOCAL_TASK_ID_PREFIX
import com.modelmesh.data.local.TaskDao
import com.modelmesh.data.local.isLocalOnly
import com.modelmesh.data.local.toDomain
import com.modelmesh.data.local.toEntity
import com.modelmesh.data.local.toInitialEntity
import com.modelmesh.data.local.toListItem
import com.modelmesh.data.local.toPendingEntity
import com.modelmesh.data.local.withListItem
import com.modelmesh.data.models.ExecutionTimeline
import com.modelmesh.data.models.ProviderHealth
import com.modelmesh.data.models.TaskAccepted
import com.modelmesh.data.models.TaskListItem
import com.modelmesh.data.models.TaskSnapshot
import com.modelmesh.data.models.TaskStatus
import com.modelmesh.data.models.TaskSubmission
import com.modelmesh.data.models.TimelineUpdate
import com.modelmesh.data.models.TraceConnection
import com.modelmesh.data.models.TraceEvent
import com.modelmesh.domain.preprocess.AttachmentPreprocessor
import com.modelmesh.domain.preprocess.mergedWith
import com.modelmesh.domain.repository.TaskRepository
import com.modelmesh.util.AppResult
import com.modelmesh.util.ErrorCode
import com.modelmesh.util.map
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.channels.ProducerScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.scan
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import retrofit2.Response
import java.io.IOException
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The one implementation of [TaskRepository].
 *
 * Offline-first is not a feature bolted on here, it is the read path: every
 * `observe*` flow is a Room flow, and the network read is a side effect that
 * updates Room and therefore re-emits. A screen renders with the radio off and
 * updates when the backend answers, and neither case needs special handling
 * upstream.
 */
@Singleton
class TaskRepositoryImpl @Inject constructor(
    private val api: ModelMeshApi,
    private val socketClient: TraceSocketClient,
    private val dao: TaskDao,
    private val preprocessor: AttachmentPreprocessor,
    /** Shared with Retrofit, so an error envelope parses exactly as a body would. */
    private val json: Json,
) : TaskRepository {

    // ── Submit ────────────────────────────────────────────────────────────────

    override suspend fun submit(submission: TaskSubmission): AppResult<TaskAccepted> {
        // A row exists before the radio is touched, so the task is never invisible
        // while the request is in flight.
        val pendingId = LOCAL_TASK_ID_PREFIX + UUID.randomUUID()
        dao.upsert(submission.toPendingEntity(pendingId))

        // Hardware hints are attached here rather than in the use case: they are a
        // device fact, not part of the user's request. `mergedWith` keeps the
        // per-file findings on the left, so nothing extracted on device is lost.
        val hinted = submission.copy(
            localMetadata = submission.localMetadata.mergedWith(preprocessor.deviceHints()),
        )

        val result = apiCall { api.submitTask(hinted.toDto()) }.map { it.toDomain() }

        // The placeholder carries a local id the backend has never heard of, so it
        // is replaced by the real row rather than kept around as an un-openable task.
        dao.delete(pendingId)

        if (result is AppResult.Success) {
            dao.upsert(
                result.data.toInitialEntity(
                    strategy = submission.strategy,
                    inputPreview = submission.userIntent.take(PREVIEW_CHARS).ifBlank { null },
                ),
            )
        }

        return result
    }

    // ── Task snapshot ─────────────────────────────────────────────────────────

    override fun observeTask(taskId: String): Flow<TaskSnapshot?> =
        dao.observeTask(taskId)
            .map { it?.toDomain() }
            .withRefresh { refreshTask(taskId) }

    override suspend fun refreshTask(taskId: String): AppResult<TaskSnapshot> {
        val result = apiCall { api.getTask(taskId) }.map { it.toDomain() }

        if (result is AppResult.Success) {
            // The snapshot endpoint carries no input text, so the preview already
            // stored for this task is preserved instead of being nulled out.
            val preview = dao.getTask(taskId)?.inputPreview
            dao.upsert(result.data.toEntity(inputPreview = preview))
        }

        return result
    }

    // ── Execution trace ───────────────────────────────────────────────────────

    override fun observeTimeline(taskId: String): Flow<TimelineUpdate> =
        traceSignals(taskId).scan(
            TimelineUpdate(ExecutionTimeline(taskId), TraceConnection.CONNECTING),
        ) { update, signal -> update.reduce(signal) }

    /**
     * Socket.io first; polling only when the socket proves unusable.
     *
     * Both sources are folded by the same [reduce], so a timeline assembled from
     * `GET /tasks/:id/trace` is identical to one streamed live — and the transport
     * state is reported honestly, because a stalled trace and a finished task look
     * the same if you only render events.
     */
    private fun traceSignals(taskId: String): Flow<TraceSignal> = channelFlow {
        var pollJob: Job? = null
        var consecutiveErrors = 0

        fun ensurePolling() {
            if (pollJob?.isActive != true) pollJob = startPolling(taskId)
        }

        launch {
            try {
                socketClient.observe(taskId).collect { signal ->
                    when (signal) {
                        is TraceSocketClient.Signal.Connected -> {
                            consecutiveErrors = 0
                            // The socket is authoritative again; stop spending requests.
                            pollJob?.cancel()
                            pollJob = null
                        }

                        is TraceSocketClient.Signal.Error -> {
                            consecutiveErrors += 1
                            if (consecutiveErrors >= MAX_SOCKET_ERRORS) ensurePolling()
                        }

                        else -> Unit
                    }
                    send(TraceSignal.FromSocket(signal))
                }
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (error: Throwable) {
                // The transport itself failed (bad URL, no upgrade path). Polling is
                // the whole fallback from here on.
                Log.w(TAG, "Trace socket unusable for $taskId: ${error.message}")
                ensurePolling()
            }
        }

        // A live trace is a subscription: it ends when the consumer stops
        // collecting, not when the socket happens to go quiet — otherwise closing
        // this block would cancel the polling fallback it just started.
        awaitCancellation()
    }

    private fun ProducerScope<TraceSignal>.startPolling(taskId: String): Job = launch {
        send(TraceSignal.PollingStarted)

        while (isActive) {
            when (val result = apiCall { api.getTrace(taskId) }) {
                is AppResult.Success -> {
                    val events = result.data.events.map { TraceEventMapper.fromRest(taskId, it) }
                    send(TraceSignal.Polled(events))
                    // Nothing more will arrive for a finished task.
                    if (TaskStatus.fromWire(result.data.status).isTerminal) return@launch
                }

                is AppResult.Failure -> {
                    // A task the backend does not know will never appear; anything
                    // else is transient, so keep polling and let the timeline wait.
                    if (result.code == ErrorCode.TASK_NOT_FOUND) return@launch
                }
            }

            delay(POLL_INTERVAL_MS)
        }
    }

    private fun TimelineUpdate.reduce(signal: TraceSignal): TimelineUpdate = when (signal) {
        is TraceSignal.FromSocket -> when (val inner = signal.signal) {
            is TraceSocketClient.Signal.Connected ->
                copy(connection = TraceConnection.LIVE)

            is TraceSocketClient.Signal.History ->
                copy(
                    timeline = timeline.withEvents(inner.events),
                    connection = TraceConnection.LIVE,
                )

            is TraceSocketClient.Signal.Live ->
                copy(
                    timeline = timeline.withEvent(inner.event),
                    // Live events prove the socket works, whatever we fell back to.
                    connection = TraceConnection.LIVE,
                )

            // While polling, a socket error is expected and must not be reported as
            // "reconnecting" — the timeline really is being refreshed by polling.
            is TraceSocketClient.Signal.Disconnected, is TraceSocketClient.Signal.Error ->
                if (connection == TraceConnection.POLLING) this else copy(connection = TraceConnection.RECONNECTING)
        }

        is TraceSignal.Polled -> copy(
            timeline = timeline.withEvents(signal.events),
            connection = TraceConnection.POLLING,
        )

        TraceSignal.PollingStarted -> copy(connection = TraceConnection.POLLING)
    }

    // ── History + recovery ────────────────────────────────────────────────────

    override fun observeHistory(limit: Int): Flow<List<TaskListItem>> =
        dao.observeHistory(limit)
            .map { entities -> entities.map { it.toListItem() } }
            .withRefresh { syncHistory(limit) }

    private suspend fun syncHistory(limit: Int) {
        val result = apiCall { api.listTasks(limit) }
        if (result !is AppResult.Success) return

        // The list endpoint carries no output, plan, or subtasks, so each row is
        // folded into what is already cached rather than replacing it.
        val merged = result.data.tasks.map { dto ->
            val item = dto.toDomain()
            dao.getTask(item.taskId)?.withListItem(item) ?: item.toEntity()
        }
        dao.upsertAll(merged)
    }

    override suspend fun unfinishedTasks(): List<TaskListItem> {
        val (pending, tracked) = dao.getUnfinished().partition { it.isLocalOnly }

        // A submit that died before the backend answered left a row with an id no
        // server knows. It cannot be recovered, so it is not offered as recoverable.
        pending.forEach { dao.delete(it.taskId) }

        return tracked.map { it.toListItem() }
    }

    // ── Feedback + provider health ────────────────────────────────────────────

    override suspend fun submitFeedback(taskId: String, rating: Int, comment: String?): AppResult<Unit> =
        apiCall { api.submitFeedback(taskId, FeedbackRequestDto(rating = rating, comment = comment)) }
            .map { }

    override suspend fun providerHealth(): AppResult<List<ProviderHealth>> =
        apiCall { api.providerStatus() }.map { response -> response.providers.map { it.toDomain() } }

    // ── Plumbing ──────────────────────────────────────────────────────────────

    /**
     * Emit from cache, then refresh in the background. The refresh writes to Room,
     * and the DAO flow re-emits — so there is exactly one path into the UI.
     *
     * The refresh is launched in the collector's scope, which means it is cancelled
     * with the screen instead of outliving it.
     */
    private fun <T> Flow<T>.withRefresh(refresh: suspend () -> Unit): Flow<T> = channelFlow {
        launch { refresh() }
        this@withRefresh.collect { send(it) }
    }

    private suspend fun <T> apiCall(call: suspend () -> Response<T>): AppResult<T> = try {
        val response = call()
        val body = response.body()
        when {
            response.isSuccessful && body != null -> AppResult.Success(body)
            response.isSuccessful -> AppResult.Failure(ErrorCode.INTERNAL, "Empty response from the backend")
            else -> failureFrom(response)
        }
    } catch (cancellation: CancellationException) {
        throw cancellation
    } catch (offline: IOException) {
        AppResult.Failure(ErrorCode.OFFLINE, "Cannot reach the ModelMesh backend", offline)
    } catch (error: Throwable) {
        AppResult.Failure(ErrorCode.INTERNAL, error.message ?: "Unexpected failure", error)
    }

    /** The backend's `{"error": {code, message, details}}` envelope, or the status. */
    private fun <T> failureFrom(response: Response<T>): AppResult.Failure {
        val raw = runCatching { response.errorBody()?.string() }.getOrNull()
        val envelope = raw
            ?.takeIf { it.isNotBlank() }
            ?.let { runCatching { json.decodeFromString(ErrorEnvelopeDto.serializer(), it) }.getOrNull() }

        val wireCode = envelope?.error?.code ?: when (response.code()) {
            401 -> "UNAUTHORIZED"
            404 -> "TASK_NOT_FOUND"
            429 -> "RATE_LIMIT_GLOBAL"
            else -> null
        }

        return AppResult.Failure(
            code = ErrorCode.fromWire(wireCode),
            message = envelope?.error?.message ?: "Request failed (HTTP ${response.code()})",
        )
    }

    /** What the timeline folds: socket signals and polled replays, in one stream. */
    private sealed interface TraceSignal {
        data class FromSocket(val signal: TraceSocketClient.Signal) : TraceSignal

        data class Polled(val events: List<TraceEvent>) : TraceSignal

        data object PollingStarted : TraceSignal
    }

    private companion object {
        const val TAG = "TaskRepository"

        /** Longest instruction excerpt stored for the history list. */
        const val PREVIEW_CHARS = 120

        /** Socket.io retries internally; this many failures means it will not recover. */
        const val MAX_SOCKET_ERRORS = 3

        const val POLL_INTERVAL_MS = 3_000L
    }
}
