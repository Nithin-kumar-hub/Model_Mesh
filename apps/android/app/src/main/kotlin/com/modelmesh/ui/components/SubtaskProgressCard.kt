package com.modelmesh.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.modelmesh.data.models.AgentRole
import com.modelmesh.data.models.SubtaskProgress
import com.modelmesh.data.models.SubtaskStatus
import com.modelmesh.data.models.SubtaskView
import com.modelmesh.ui.theme.executionColors

/**
 * One subtask row. Two overloads feed a single renderer: the live [SubtaskProgress]
 * from the trace, and the settled [SubtaskView] from the snapshot. Both always
 * render whatever status they carry — a failed or skipped subtask is shown, never
 * hidden (truthful telemetry, HANDOFF §7).
 */
@Composable
fun SubtaskProgressCard(subtask: SubtaskProgress, modifier: Modifier = Modifier) {
    SubtaskCardCore(
        modifier = modifier,
        role = subtask.role,
        status = subtask.status,
        provider = subtask.provider,
        model = subtask.model,
        tokens = subtask.tokens,
        latencyMs = subtask.latencyMs.takeIf { it > 0 },
        confidence = subtask.confidence,
        failovers = subtask.failovers,
        fromCache = subtask.fromCache,
        errorText = subtask.error,
        skipReason = subtask.skipReason,
        dependencies = emptyList(),
    )
}

@Composable
fun SubtaskProgressCard(subtask: SubtaskView, modifier: Modifier = Modifier) {
    SubtaskCardCore(
        modifier = modifier,
        role = subtask.role,
        status = subtask.status,
        provider = subtask.provider,
        model = subtask.model,
        tokens = subtask.tokens,
        latencyMs = subtask.latencyMs,
        confidence = subtask.confidence,
        failovers = subtask.failovers,
        fromCache = subtask.fromCache,
        // The snapshot carries an error *code*; there is no free-text message here.
        errorText = subtask.errorCode,
        skipReason = null,
        dependencies = subtask.dependencies,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SubtaskCardCore(
    role: AgentRole,
    status: SubtaskStatus,
    provider: String?,
    model: String?,
    tokens: Int,
    latencyMs: Int?,
    confidence: Double?,
    failovers: Int,
    fromCache: Boolean,
    errorText: String?,
    skipReason: String?,
    dependencies: List<String>,
    modifier: Modifier = Modifier,
) {
    OutlinedCard(modifier = modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = role.label,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                TaskStatusChip(status)
            }

            provider?.let {
                Text(
                    text = if (model != null) "$it · $model" else it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }

            FlowRow(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (tokens > 0) MetaChip("${formatTokens(tokens)} tok")
                latencyMs?.let { MetaChip(formatDuration(it)) }
                confidence?.let { MetaChip("conf ${formatConfidence(it)}") }
                if (fromCache) MetaChip("cached", accent = executionColors.savings)
                if (failovers > 0) {
                    MetaChip(
                        text = "↻ $failovers failover${if (failovers == 1) "" else "s"}",
                        accent = executionColors.running,
                    )
                }
                if (dependencies.isNotEmpty()) {
                    MetaChip("after ${dependencies.size} dep${if (dependencies.size == 1) "" else "s"}")
                }
            }

            if (status == SubtaskStatus.FAILED && !errorText.isNullOrBlank()) {
                StatusLine(label = "Error", detail = errorText, color = executionColors.failed)
            }
            if (status == SubtaskStatus.SKIPPED) {
                StatusLine(
                    label = "Skipped",
                    detail = skipReason?.takeIf { it.isNotBlank() }
                        ?: "an upstream dependency did not complete",
                    color = executionColors.skipped,
                )
            }
        }
    }
}

@Composable
private fun MetaChip(
    text: String,
    accent: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
    Surface(
        shape = RoundedCornerShape(6.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = accent,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun StatusLine(label: String, detail: String, color: androidx.compose.ui.graphics.Color) {
    Text(
        text = "$label: $detail",
        style = MaterialTheme.typography.bodySmall,
        color = color,
        modifier = Modifier.padding(top = 6.dp),
    )
}
