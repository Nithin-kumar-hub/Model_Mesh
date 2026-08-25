package com.modelmesh.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.modelmesh.data.models.StageState
import com.modelmesh.data.models.SubtaskStatus
import com.modelmesh.data.models.TaskStatus
import com.modelmesh.ui.theme.executionColors

/**
 * How a single execution state should look: its accent (for dots and indicators),
 * a container/onContainer pair (for filled chips), and the label to show. This is
 * the one place state → color is decided, so the trace screen, the subtask cards,
 * and the result screen never disagree about what "failed" looks like.
 */
data class StatusVisual(
    val label: String,
    val accent: Color,
    val container: Color,
    val onContainer: Color,
)

@Composable
@ReadOnlyComposable
fun statusVisual(status: SubtaskStatus): StatusVisual {
    val c = executionColors
    return when (status) {
        SubtaskStatus.PENDING -> StatusVisual(status.label, c.pending, c.pendingContainer, c.onPendingContainer)
        SubtaskStatus.RUNNING -> StatusVisual(status.label, c.running, c.runningContainer, c.onRunningContainer)
        SubtaskStatus.COMPLETED -> StatusVisual(status.label, c.done, c.doneContainer, c.onDoneContainer)
        SubtaskStatus.FAILED -> StatusVisual(status.label, c.failed, c.failedContainer, c.onFailedContainer)
        SubtaskStatus.SKIPPED -> StatusVisual(status.label, c.skipped, c.skippedContainer, c.onSkippedContainer)
    }
}

@Composable
@ReadOnlyComposable
fun statusVisual(state: StageState): StatusVisual {
    val c = executionColors
    return when (state) {
        StageState.PENDING -> StatusVisual("Waiting", c.pending, c.pendingContainer, c.onPendingContainer)
        StageState.RUNNING -> StatusVisual("Running", c.running, c.runningContainer, c.onRunningContainer)
        StageState.DONE -> StatusVisual("Done", c.done, c.doneContainer, c.onDoneContainer)
        StageState.FAILED -> StatusVisual("Failed", c.failed, c.failedContainer, c.onFailedContainer)
    }
}

@Composable
@ReadOnlyComposable
fun statusVisual(status: TaskStatus): StatusVisual {
    val c = executionColors
    return when (status) {
        TaskStatus.COMPLETED -> StatusVisual(status.label, c.done, c.doneContainer, c.onDoneContainer)
        TaskStatus.FAILED -> StatusVisual(status.label, c.failed, c.failedContainer, c.onFailedContainer)
        TaskStatus.RECEIVED -> StatusVisual(status.label, c.pending, c.pendingContainer, c.onPendingContainer)
        // Every intermediate lifecycle state is work in progress.
        else -> StatusVisual(status.label, c.running, c.runningContainer, c.onRunningContainer)
    }
}

/** A filled pill: an accent dot plus the state label, in the state's own colors. */
@Composable
private fun StatusChip(visual: StatusVisual, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = visual.container,
        contentColor = visual.onContainer,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AccentDot(color = visual.accent)
            Text(
                text = visual.label,
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(start = 6.dp),
            )
        }
    }
}

@Composable
private fun AccentDot(color: Color) {
    Box(
        modifier = Modifier
            .size(8.dp)
            .clip(CircleShape)
            .background(color),
    )
}

@Composable
fun TaskStatusChip(status: SubtaskStatus, modifier: Modifier = Modifier) =
    StatusChip(statusVisual(status), modifier)

@Composable
fun TaskStatusChip(state: StageState, modifier: Modifier = Modifier) =
    StatusChip(statusVisual(state), modifier)

@Composable
fun TaskStatusChip(status: TaskStatus, modifier: Modifier = Modifier) =
    StatusChip(statusVisual(status), modifier)
