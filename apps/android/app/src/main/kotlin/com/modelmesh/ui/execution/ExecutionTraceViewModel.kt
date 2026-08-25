package com.modelmesh.ui.execution

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.modelmesh.data.models.ExecutionTimeline
import com.modelmesh.data.models.TaskSnapshot
import com.modelmesh.data.models.TaskStatus
import com.modelmesh.data.models.TraceConnection
import com.modelmesh.data.models.TraceEventName
import com.modelmesh.domain.usecases.ObserveTaskUseCase
import com.modelmesh.domain.usecases.ObserveTraceUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

/**
 * What the execution screen renders. Both sources are kept: the trace [timeline]
 * is the live view, while [snapshot] is the durable record from the repository. If
 * the socket falls back to polling — or drops entirely — the snapshot still tells us
 * the task reached a terminal state, so "Done / View result" never depends on the
 * socket staying healthy.
 */
data class ExecutionUiState(
    val taskId: String,
    val timeline: ExecutionTimeline? = null,
    val connection: TraceConnection = TraceConnection.CONNECTING,
    val snapshot: TaskSnapshot? = null,
) {
    /** Terminal per either source — whichever notices first. */
    val isFinished: Boolean
        get() = timeline?.isFinished == true || snapshot?.isTerminal == true

    /** A run that ended in failure, from either source. */
    val failed: Boolean
        get() = timeline?.failed == true || snapshot?.status == TaskStatus.FAILED

    /** The backend is re-planning around failures right now (Rule 2 in motion). */
    val replanning: Boolean
        get() = !isFinished && timeline?.events?.lastOrNull()?.name == TraceEventName.REPLANNING
}

/**
 * Streams one task's execution. It reads the taskId from [SavedStateHandle] (the
 * only thing the nav route carries) so it survives process death, then merges the
 * trace stream with the task snapshot. It holds no folded state of its own — the
 * folding lives in [ExecutionTimeline].
 */
@HiltViewModel
class ExecutionTraceViewModel @Inject constructor(
    observeTrace: ObserveTraceUseCase,
    observeTask: ObserveTaskUseCase,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val taskId: String =
        checkNotNull(savedStateHandle.get<String>(ARG_TASK_ID)) { "taskId is required to observe a task" }

    val uiState: StateFlow<ExecutionUiState> =
        combine(
            observeTrace(taskId),
            observeTask(taskId),
        ) { update, snapshot ->
            ExecutionUiState(
                taskId = taskId,
                timeline = update.timeline,
                connection = update.connection,
                snapshot = snapshot,
            )
        }.stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS),
            initialValue = ExecutionUiState(taskId),
        )

    companion object {
        const val ARG_TASK_ID = "taskId"
        private const val STOP_TIMEOUT_MS = 5_000L
    }
}
