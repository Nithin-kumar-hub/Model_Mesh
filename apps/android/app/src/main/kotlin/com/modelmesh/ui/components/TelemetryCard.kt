package com.modelmesh.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.modelmesh.data.models.RunOutcome
import com.modelmesh.data.models.TelemetryView
import com.modelmesh.ui.theme.executionColors

/**
 * Token accounting. Two overloads share one renderer: the settled [TelemetryView]
 * from the snapshot, and the live [RunOutcome] from the trace.
 *
 * When a run is `partial`, the savings number is explicitly labelled as covering
 * only the subtasks that completed — the backend computes it that way, and the UI
 * must not imply the whole task's worth of savings was realized.
 */
@Composable
fun TelemetryCard(
    telemetry: TelemetryView,
    modifier: Modifier = Modifier,
    partial: Boolean = false,
    failedCount: Int = 0,
) {
    TelemetryCardCore(
        modifier = modifier,
        actualTokens = telemetry.actualTokens,
        savedTokens = telemetry.savedTokens,
        savingsPercent = telemetry.savingsPercent,
        totalMs = telemetry.totalMs,
        failovers = telemetry.failovers,
        cacheHits = telemetry.cacheHits,
        modelsUsed = telemetry.modelsUsed,
        partial = partial,
        failedCount = failedCount,
    )
}

@Composable
fun TelemetryCard(outcome: RunOutcome, modifier: Modifier = Modifier) {
    TelemetryCardCore(
        modifier = modifier,
        actualTokens = outcome.totalTokens,
        savedTokens = outcome.savedTokens,
        savingsPercent = outcome.savingsPercent,
        totalMs = outcome.totalMs,
        failovers = outcome.failovers,
        cacheHits = outcome.cacheHits,
        modelsUsed = emptyList(),
        partial = outcome.partial,
        failedCount = outcome.failedSubtasks.size,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TelemetryCardCore(
    actualTokens: Int?,
    savedTokens: Int?,
    savingsPercent: Double,
    totalMs: Long?,
    failovers: Int,
    cacheHits: Int,
    modelsUsed: List<String>,
    partial: Boolean,
    failedCount: Int,
    modifier: Modifier = Modifier,
) {
    val hasTokenData = (actualTokens ?: 0) > 0
    ElevatedCard(modifier = modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "Telemetry",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )

            if (hasTokenData) {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp),
                    shape = RoundedCornerShape(12.dp),
                    color = executionColors.savingsContainer,
                    contentColor = executionColors.onSavingsContainer,
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = formatPercent(savingsPercent),
                            style = MaterialTheme.typography.displaySmall,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            text = "${formatTokens(savedTokens)} tokens saved vs. sending everything to every model",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        if (partial) {
                            Text(
                                text = "Partial run — this covers only the subtasks that completed.",
                                style = MaterialTheme.typography.labelMedium,
                                modifier = Modifier.padding(top = 6.dp),
                            )
                        }
                    }
                }
            } else {
                Text(
                    text = "No token accounting reported yet.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }

            FlowRow(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (hasTokenData) Stat("Tokens used", formatTokens(actualTokens))
                Stat("Time", formatDuration(totalMs))
                Stat("Failovers", failovers.toString())
                Stat("Cache hits", cacheHits.toString())
                if (failedCount > 0) {
                    Stat("Failed subtasks", failedCount.toString(), valueColor = executionColors.failed)
                }
            }

            if (modelsUsed.isNotEmpty()) {
                Text(
                    text = "Models used (${modelsUsed.size})",
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(top = 14.dp, bottom = 6.dp),
                )
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    modelsUsed.forEach { ModelChip(it) }
                }
            }
        }
    }
}

@Composable
private fun Stat(
    label: String,
    value: String,
    valueColor: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface,
) {
    Column {
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = valueColor,
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ModelChip(text: String) {
    Surface(
        shape = RoundedCornerShape(6.dp),
        color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
    ) {
        Text(
            text = text,
            style = com.modelmesh.ui.theme.CodeTextStyle,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}
