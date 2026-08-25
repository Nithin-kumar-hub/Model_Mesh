package com.modelmesh.ui.result

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.modelmesh.data.models.TaskSnapshot
import com.modelmesh.domain.usecases.GetTaskUseCase
import com.modelmesh.domain.usecases.ObserveTaskUseCase
import com.modelmesh.domain.usecases.SubmitFeedbackUseCase
import com.modelmesh.util.AppResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Result-screen state. Feedback is tracked separately from the snapshot so a
 * submit-in-flight or a rating the user has picked survives a fresh snapshot arriving.
 */
data class ResultUiState(
    val taskId: String,
    val snapshot: TaskSnapshot? = null,
    val loading: Boolean = true,
    val error: AppResult.Failure? = null,
    val feedbackRating: Int? = null,
    val feedbackComment: String = "",
    val feedbackSubmitting: Boolean = false,
    val feedbackSubmitted: Boolean = false,
    val feedbackError: AppResult.Failure? = null,
)

/**
 * Loads one finished task's result. It both observes the durable snapshot (so a task
 * opened from history renders immediately from cache) and fetches once on open (so a
 * task not yet cached is pulled). A refresh failure never blanks out a snapshot that
 * was already shown — the error only surfaces when there is nothing to display.
 */
@HiltViewModel
class ResultViewModel @Inject constructor(
    private val observeTask: ObserveTaskUseCase,
    private val getTask: GetTaskUseCase,
    private val submitFeedback: SubmitFeedbackUseCase,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val taskId: String =
        checkNotNull(savedStateHandle.get<String>(ARG_TASK_ID)) { "taskId is required to load a result" }

    private val _uiState = MutableStateFlow(ResultUiState(taskId))
    val uiState: StateFlow<ResultUiState> = _uiState.asStateFlow()

    init {
        observeTask(taskId)
            .onEach { snapshot ->
                _uiState.update {
                    if (snapshot != null) {
                        it.copy(snapshot = snapshot, loading = false, error = null)
                    } else {
                        it
                    }
                }
            }
            .launchIn(viewModelScope)

        refresh()
    }

    fun refresh() {
        _uiState.update { it.copy(loading = it.snapshot == null, error = null) }
        viewModelScope.launch {
            when (val result = getTask(taskId)) {
                is AppResult.Success ->
                    _uiState.update { it.copy(snapshot = result.data, loading = false, error = null) }

                is AppResult.Failure ->
                    _uiState.update {
                        if (it.snapshot == null) it.copy(error = result, loading = false) else it.copy(loading = false)
                    }
            }
        }
    }

    fun onRatingChange(rating: Int) {
        _uiState.update { it.copy(feedbackRating = rating, feedbackError = null) }
    }

    fun onCommentChange(comment: String) {
        _uiState.update { it.copy(feedbackComment = comment) }
    }

    fun submitRating() {
        val rating = _uiState.value.feedbackRating ?: return
        if (_uiState.value.feedbackSubmitting) return

        _uiState.update { it.copy(feedbackSubmitting = true, feedbackError = null) }
        viewModelScope.launch {
            val comment = _uiState.value.feedbackComment.trim().ifBlank { null }
            when (val result = submitFeedback(taskId, rating, comment)) {
                is AppResult.Success ->
                    _uiState.update { it.copy(feedbackSubmitting = false, feedbackSubmitted = true) }

                is AppResult.Failure ->
                    _uiState.update { it.copy(feedbackSubmitting = false, feedbackError = result) }
            }
        }
    }

    companion object {
        const val ARG_TASK_ID = "taskId"
    }
}
