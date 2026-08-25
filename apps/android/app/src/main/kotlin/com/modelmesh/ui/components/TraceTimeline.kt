package com.modelmesh.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.modelmesh.data.models.TraceEvent
import com.modelmesh.data.models.TraceEventName
import com.modelmesh.ui.theme.CodeTextStyle
import com.modelmesh.ui.theme.executionColors

/**
 * The raw event stream as a vertical timeline, using each event's own `summary` and
 * `offsetMs`. This is the audit view, not the primary one — the caller keeps it
 * behind a "show raw trace" toggle. Rendered as a plain (non-scrolling) column so it
 * nests inside the screen's scroll container without fighting it.
 */
@Composable
fun TraceTimeline(events: List<TraceEvent>, modifier: Modifier = Modifier) {
    if (events.isEmpty()) {
        Text(
            text = "No trace events yet.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = modifier.padding(8.dp),
        )
        return
    }
    Column(modifier = modifier.fillMaxWidth()) {
        events.forEachIndexed { index, event ->
            TraceRow(
                event = event,
                isFirst = index == 0,
                isLast = index == events.lastIndex,
            )
        }
    }
}

@Composable
private fun TraceRow(event: TraceEvent, isFirst: Boolean, isLast: Boolean) {
    Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Gutter(color = dotColor(event.name), isFirst = isFirst, isLast = isLast)
        Column(modifier = Modifier.padding(start = 12.dp, top = 2.dp, bottom = 10.dp)) {
            Text(
                text = "+${formatDuration(event.offsetMs)}",
                style = CodeTextStyle,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = event.summary,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun Gutter(color: Color, isFirst: Boolean, isLast: Boolean) {
    Column(
        modifier = Modifier.width(16.dp).fillMaxHeight(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Top connector (hidden on the first row).
        Box(
            modifier = Modifier
                .width(2.dp)
                .height(4.dp)
                .background(if (isFirst) Color.Transparent else MaterialTheme.colorScheme.outlineVariant),
        )
        Box(
            modifier = Modifier
                .size(9.dp)
                .clip(CircleShape)
                .background(color),
        )
        // Bottom connector (hidden on the last row), stretched to fill the row.
        if (!isLast) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .width(2.dp)
                    .background(MaterialTheme.colorScheme.outlineVariant),
            )
        } else {
            Spacer(Modifier.weight(1f))
        }
    }
}

@Composable
private fun dotColor(name: TraceEventName): Color = when (name) {
    TraceEventName.FAILED, TraceEventName.SUBTASK_FAILED -> executionColors.failed
    TraceEventName.SUBTASK_SKIPPED -> executionColors.skipped
    TraceEventName.COMPLETED, TraceEventName.VERIFIED, TraceEventName.SUBTASK_DONE -> executionColors.done
    TraceEventName.CACHE_HIT -> executionColors.savings
    else -> executionColors.running
}
