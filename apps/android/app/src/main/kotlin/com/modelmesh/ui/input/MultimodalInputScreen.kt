@file:OptIn(ExperimentalMaterial3Api::class)

package com.modelmesh.ui.input

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.modelmesh.data.models.ExecutionStrategy
import com.modelmesh.data.models.TaskListItem
import com.modelmesh.ui.components.AttachmentPreview
import com.modelmesh.ui.components.ErrorBanner

/**
 * The entry screen: compose an instruction, optionally attach material, pick a
 * strategy, submit. Two deliberate design commitments live here.
 *
 * Rule 6 (intent vs. material): the instruction field and the attachment list are
 * visually and structurally distinct. This screen never copies extracted document
 * text into the instruction — attachments travel as [PreparedAttachment]s and the
 * separation is preserved all the way to [SubmitTaskUseCase].
 *
 * Rule 3 (capability routing): the "prefer on-device models" control is phrased as a
 * preference, not a guarantee — the backend routes on capability and may override it.
 */
@Composable
fun MultimodalInputScreen(
    onNavigateToExecution: (String) -> Unit,
    onNavigateToResult: (String) -> Unit,
    modifier: Modifier = Modifier,
    sharedContent: SharedContent? = null,
    onSharedContentConsumed: () -> Unit = {},
    viewModel: MultimodalInputViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    var showCamera by rememberSaveable { mutableStateOf(false) }

    // One-shot navigation: consume the signal so returning here doesn't re-fire it.
    LaunchedEffect(uiState.accepted) {
        val accepted = uiState.accepted ?: return@LaunchedEffect
        onNavigateToExecution(accepted.taskId)
        viewModel.onAcceptedConsumed()
    }

    // Seed from an Android share exactly once. Rule 6 is enforced at the split:
    // shared text prefills the instruction (only when the field is empty, so it never
    // clobbers something the user typed); a shared file is routed through the same
    // on-device preprocessing as any attachment and is never merged into the text.
    LaunchedEffect(sharedContent) {
        val shared = sharedContent ?: return@LaunchedEffect
        shared.text?.takeIf { it.isNotBlank() && uiState.userIntent.isBlank() }?.let {
            viewModel.onIntentChange(it)
        }
        shared.streamUri?.takeIf { it.isNotBlank() }?.let { uri ->
            viewModel.onAttachmentPicked(
                uri = uri,
                mimeType = shared.mimeType ?: "application/octet-stream",
                displayName = shared.displayName ?: "shared-file",
            )
        }
        onSharedContentConsumed()
    }

    val documentPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri: Uri? ->
        if (uri != null) {
            val (name, mime) = context.resolveFileMeta(uri)
            viewModel.onAttachmentPicked(uri.toString(), mime, name)
        }
    }

    if (showCamera) {
        CameraCapture(
            onImageCaptured = { capturedUri ->
                showCamera = false
                viewModel.onAttachmentPicked(capturedUri, "image/jpeg", "camera-capture.jpg")
            },
            onCancel = { showCamera = false },
            modifier = modifier,
        )
        return
    }

    Scaffold(
        modifier = modifier,
        topBar = { TopAppBar(title = { Text("New task") }) },
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .padding(innerPadding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (uiState.unfinished.isNotEmpty()) {
                item(key = "resume") {
                    ResumeBanner(
                        unfinished = uiState.unfinished,
                        onResume = { onNavigateToExecution(it.taskId) },
                    )
                }
            }

            item(key = "instruction") {
                InstructionField(
                    value = uiState.userIntent,
                    onValueChange = viewModel::onIntentChange,
                )
            }

            item(key = "attachments-header") {
                AttachmentsHeader(
                    onPickFile = {
                        documentPicker.launch(
                            arrayOf("image/*", "application/pdf", "text/*", "audio/*"),
                        )
                    },
                    onOpenCamera = { showCamera = true },
                )
            }

            items(uiState.attachments, key = { it.attachment.id }) { prepared ->
                AttachmentPreview(
                    prepared = prepared,
                    onRemove = { viewModel.onRemoveAttachment(prepared.attachment.id) },
                )
            }

            if (uiState.preprocessing.isNotEmpty()) {
                items(uiState.preprocessing.toList(), key = { "prep-$it" }) { name ->
                    PreprocessingRow(name = name)
                }
            }

            item(key = "strategy") {
                StrategySelector(
                    selected = uiState.strategy,
                    onSelect = viewModel::onStrategyChange,
                )
            }

            item(key = "prefer-local") {
                PreferLocalToggle(
                    checked = uiState.preferences.preferLocalModels,
                    onCheckedChange = viewModel::onPreferLocalModelsChange,
                )
            }

            uiState.error?.let { failure ->
                item(key = "error") {
                    ErrorBanner(failure = failure, onEditInput = viewModel::dismissError)
                }
            }

            item(key = "submit") {
                Button(
                    onClick = viewModel::submit,
                    enabled = uiState.canSubmit,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (uiState.submitting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                        Spacer(Modifier.size(8.dp))
                        Text("Submitting…")
                    } else {
                        Text("Run task")
                    }
                }
            }

            if (uiState.history.isNotEmpty()) {
                item(key = "history-header") {
                    Text(
                        text = "Recent tasks",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
                items(uiState.history, key = { "hist-${it.taskId}" }) { item ->
                    RecentTaskRow(item = item, onClick = { onNavigateToResult(item.taskId) })
                }
            }

            item(key = "tail") { Spacer(Modifier.height(8.dp)) }
        }
    }
}

@Composable
private fun InstructionField(value: String, onValueChange: (String) -> Unit) {
    Column {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .fillMaxWidth()
                .height(150.dp),
            label = { Text("Your instruction") },
            placeholder = { Text("What do you want done?") },
            supportingText = {
                Text("Attached files are treated as material to work on — never as instructions.")
            },
        )
    }
}

@Composable
private fun AttachmentsHeader(onPickFile: () -> Unit, onOpenCamera: () -> Unit) {
    Column {
        Text(
            text = "Attached material",
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            text = "Read on your device and kept separate from your instruction.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(onClick = onPickFile, modifier = Modifier.weight(1f)) {
                Icon(Icons.Filled.UploadFile, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text("Add file")
            }
            OutlinedButton(onClick = onOpenCamera, modifier = Modifier.weight(1f)) {
                Icon(Icons.Filled.PhotoCamera, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text("Camera")
            }
        }
    }
}

@Composable
private fun PreprocessingRow(name: String) {
    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
            Text(
                text = "Reading $name on device…",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(start = 12.dp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun StrategySelector(selected: ExecutionStrategy, onSelect: (ExecutionStrategy) -> Unit) {
    val strategies = ExecutionStrategy.entries
    Column {
        Text(
            text = "Strategy",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
            strategies.forEachIndexed { index, strategy ->
                SegmentedButton(
                    selected = selected == strategy,
                    onClick = { onSelect(strategy) },
                    shape = SegmentedButtonDefaults.itemShape(index, strategies.size),
                ) {
                    Text(strategy.label)
                }
            }
        }
        Text(
            text = selected.blurb,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

@Composable
private fun PreferLocalToggle(checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "Prefer on-device models",
                    style = MaterialTheme.typography.bodyLarge,
                )
                // Rule 3: this is a hint, not a guarantee. Routing is capability-based
                // on the backend and may send work elsewhere when it must.
                Text(
                    text = "A hint for the planner. It routes on capability and may override this.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = checked, onCheckedChange = onCheckedChange)
        }
    }
}

@Composable
private fun ResumeBanner(unfinished: List<TaskListItem>, onResume: (TaskListItem) -> Unit) {
    val top = unfinished.first()
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
    ) {
        Row(
            modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = if (unfinished.size == 1) {
                        "A task is still running"
                    } else {
                        "${unfinished.size} tasks are still running"
                    },
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                top.inputPreview?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            TextButton(onClick = { onResume(top) }) {
                Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(4.dp))
                Text("Resume")
            }
        }
    }
}

@Composable
private fun RecentTaskRow(item: TaskListItem, onClick: () -> Unit) {
    OutlinedCard(modifier = Modifier.fillMaxWidth(), onClick = onClick) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = item.inputPreview?.takeIf { it.isNotBlank() }
                        ?: item.taskType?.takeIf { it.isNotBlank() }
                        ?: "Task ${item.taskId.take(8)}",
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "${item.status.label} · ${item.strategy.label}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Box(modifier = Modifier.size(4.dp))
        }
    }
}

/**
 * Resolve a display name and MIME type for a picked content URI. Presentation-only:
 * it collects the pieces [MultimodalInputViewModel.onAttachmentPicked] needs and never
 * reads the file's bytes into the instruction (Rule 6).
 */
private fun Context.resolveFileMeta(uri: Uri): Pair<String, String> {
    val mime = contentResolver.getType(uri) ?: "application/octet-stream"
    var name = uri.lastPathSegment ?: "attachment"
    runCatching {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) cursor.getString(index)?.let { name = it }
            }
        }
    }
    return name to mime
}
