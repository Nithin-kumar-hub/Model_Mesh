package com.modelmesh.ui.input

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.modelmesh.data.models.ExecutionStrategy
import com.modelmesh.data.models.TaskAccepted
import com.modelmesh.data.models.TaskBudget
import com.modelmesh.data.models.TaskListItem
import com.modelmesh.data.models.TaskPreferences
import com.modelmesh.domain.preprocess.PreparedAttachment
import com.modelmesh.domain.usecases.GetTaskHistoryUseCase
import com.modelmesh.domain.usecases.PreprocessAttachmentUseCase
import com.modelmesh.domain.usecases.RecoverUnfinishedTasksUseCase
import com.modelmesh.domain.usecases.SubmitTaskUseCase
import com.modelmesh.util.AppResult
import com.modelmesh.util.ErrorCode
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
 * Input-screen state. `accepted` is a one-shot navigation signal — the screen
 * navigates and then calls [MultimodalInputViewModel.onAcceptedConsumed].
 */
data class InputUiState(
    val userIntent: String = "",
    val attachments: List<PreparedAttachment> = emptyList(),
    val strategy: ExecutionStrategy = ExecutionStrategy.BALANCED,
    val preferences: TaskPreferences = TaskPreferences(),
    val budget: TaskBudget? = null,
    val preprocessing: Set<String> = emptySet(),
    val submitting: Boolean = false,
    val error: AppResult.Failure? = null,
    val accepted: TaskAccepted? = null,
    val history: List<TaskListItem> = emptyList(),
    val unfinished: List<TaskListItem> = emptyList(),
) {
    /** Mirrors the backend's own rule: need either an instruction or at least one file. */
    val canSubmit: Boolean
        get() = !submitting && (userIntent.isNotBlank() || attachments.isNotEmpty())
}

/**
 * Owns input-screen state and the submit flow. It never builds a [TaskSubmission];
 * assembling the request — and keeping the instruction separate from extracted
 * document text (Rule 6) — is [SubmitTaskUseCase]'s job. This ViewModel only hands
 * over the pieces the screen collected.
 */
@HiltViewModel
class MultimodalInputViewModel @Inject constructor(
    private val submitTask: SubmitTaskUseCase,
    private val preprocessAttachment: PreprocessAttachmentUseCase,
    private val getHistory: GetTaskHistoryUseCase,
    private val recoverUnfinished: RecoverUnfinishedTasksUseCase,
) : ViewModel() {

    private val _uiState = MutableStateFlow(InputUiState())
    val uiState: StateFlow<InputUiState> = _uiState.asStateFlow()

    init {
        getHistory()
            .onEach { items -> _uiState.update { it.copy(history = items) } }
            .launchIn(viewModelScope)

        refreshUnfinished()
    }

    fun onIntentChange(value: String) {
        _uiState.update { it.copy(userIntent = value) }
    }

    fun onStrategyChange(strategy: ExecutionStrategy) {
        _uiState.update { it.copy(strategy = strategy) }
    }

    fun onPreferLocalModelsChange(prefer: Boolean) {
        _uiState.update { it.copy(preferences = it.preferences.copy(preferLocalModels = prefer)) }
    }

    /**
     * Run on-device extraction over a picked/captured file, then add it. The
     * attachment count and per-file size limits are enforced here so the user gets
     * an instant message instead of a rejected upload (HANDOFF §6).
     */
    fun onAttachmentPicked(uri: String, mimeType: String, displayName: String) {
        val state = _uiState.value
        if (state.attachments.size + state.preprocessing.size >= MAX_ATTACHMENTS) {
            _uiState.update {
                it.copy(error = AppResult.Failure(ErrorCode.INVALID_INPUT, "You can attach up to $MAX_ATTACHMENTS files."))
            }
            return
        }

        _uiState.update { it.copy(preprocessing = it.preprocessing + displayName, error = null) }
        viewModelScope.launch {
            when (val result = preprocessAttachment(uri, mimeType, displayName)) {
                is AppResult.Success -> {
                    val prepared = result.data
                    if (prepared.attachment.sizeBytes > MAX_FILE_BYTES) {
                        _uiState.update {
                            it.copy(
                                preprocessing = it.preprocessing - displayName,
                                error = AppResult.Failure(
                                    ErrorCode.FILE_TOO_LARGE,
                                    "$displayName is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB.",
                                ),
                            )
                        }
                    } else {
                        _uiState.update {
                            it.copy(
                                attachments = it.attachments + prepared,
                                preprocessing = it.preprocessing - displayName,
                            )
                        }
                    }
                }

                is AppResult.Failure -> _uiState.update {
                    it.copy(preprocessing = it.preprocessing - displayName, error = result)
                }
            }
        }
    }

    fun onRemoveAttachment(id: String) {
        _uiState.update { it.copy(attachments = it.attachments.filterNot { a -> a.attachment.id == id }) }
    }

    fun submit() {
        val state = _uiState.value
        if (!state.canSubmit) return

        _uiState.update { it.copy(submitting = true, error = null) }
        viewModelScope.launch {
            val result = submitTask(
                userIntent = state.userIntent,
                attachments = state.attachments,
                strategy = state.strategy,
                budget = state.budget,
                preferences = state.preferences,
            )
            when (result) {
                is AppResult.Success -> _uiState.update { it.copy(submitting = false, accepted = result.data) }
                is AppResult.Failure -> _uiState.update { it.copy(submitting = false, error = result) }
            }
        }
    }

    fun onAcceptedConsumed() {
        _uiState.update { it.copy(accepted = null) }
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null) }
    }

    private fun refreshUnfinished() {
        viewModelScope.launch {
            val unfinished = recoverUnfinished()
            _uiState.update { it.copy(unfinished = unfinished) }
        }
    }

    private companion object {
        const val MAX_ATTACHMENTS = 10
        const val MAX_FILE_BYTES = 20L * 1024 * 1024
    }
}
