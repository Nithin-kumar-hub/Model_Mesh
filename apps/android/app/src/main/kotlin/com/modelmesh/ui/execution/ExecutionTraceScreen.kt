@file:OptIn(ExperimentalMaterial3Api::class)

package com.modelmesh.ui.execution

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.modelmesh.data.models.ExecutionTimeline
import com.modelmesh.data.models.TraceConnection
import com.modelmesh.ui.components.ContextSavingsCard
import com.modelmesh.ui.components.ExecutionStageCard
import com.modelmesh.ui.components.PlanDagView
import com.modelmesh.ui.components.SubtaskProgressCard
import com.modelmesh.ui.components.TelemetryCard
import com.modelmesh.ui.components.TraceTimeline
import com.modelmesh.ui.components.formatDuration
import com.modelmesh.ui.theme.executionColors

/**
 * Watches a task run. The screen is honest in three ways the spec insists on:
 *  - it names the transport (Live vs. Polling), so a stalled socket can't masquerade
 *    as a finished task;
 *  - it surfaces re-planning and downgrades instead of smoothing them over;
 *  - it shows failed and skipped subtasks as first-class rows, never hidden.
 *
 * "View result" appears the moment either the trace or the snapshot reports terminal.
 */
@Composable
fun ExecutionTraceScreen(
    onBack: () -> Unit,
    onViewResult: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ExecutionTraceViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    var showRawTrace by rememberSaveable { mutableStateOf(false) }

    // Follow the run while it's live; stop fighting the user once it's finished.
    val eventCount = uiState.timeline?.events?.size ?: 0
    LaunchedEffect(eventCount, uiState.isFinished) {
        if (!uiState.isFinished && eventCount > 0) {
            val total = listState.layoutInfo.totalItemsCount
            if (total > 0) listState.animateScrollToItem(total - 1)
        }
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("Execution") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = { ConnectionPill(uiState.connection) },
            )
        },
    ) { innerPadding ->
        val timeline = uiState.timeline
        if (timeline == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Text(
                        text = "Connecting to the run…",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
            }
            return@Scaffold
        }

        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item(key = "status") {
                StatusHeader(
                    timeline = timeline,
                    isFinished = uiState.isFinished,
                    failed = uiState.failed,
                )
            }

            if (uiState.replanning) {
                item(key = "replanning") { ReplanningBanner() }
            }

            item(key = "pipeline-header") { SectionLabel("Pipeline") }
            items(timeline.stages, key = { it.stage.name }) { stage ->
                ExecutionStageCard(stage = stage)
            }

            timeline.plan?.let { plan ->
                item(key = "plan-header") { SectionLabel("Plan") }
                item(key = "plan") { PlanDagView(plan = plan) }
            }

            timeline.contextSavings?.let { savings ->
                item(key = "savings") { ContextSavingsCard(savings = savings) }
            }

            val subtasks = timeline.subtasks
            if (subtasks.isNotEmpty()) {
                item(key = "subtasks-header") { SectionLabel("Subtasks") }
                items(subtasks, key = { "sub-${it.id}" }) { subtask ->
                    SubtaskProgressCard(subtask = subtask)
                }
            }

            timeline.outcome?.let { outcome ->
                item(key = "outcome-header") { SectionLabel("Result so far") }
                item(key = "outcome") { TelemetryCard(outcome = outcome) }
            }

            item(key = "raw-toggle") {
                TextButton(onClick = { showRawTrace = !showRawTrace }) {
                    Text(if (showRawTrace) "Hide raw trace" else "Show raw trace")
                }
            }
            if (showRawTrace) {
                item(key = "raw-trace") {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                    ) {
                        TraceTimeline(
                            events = timeline.events,
                            modifier = Modifier.padding(12.dp),
                        )
                    }
                }
            }

            if (uiState.isFinished) {
                item(key = "view-result") {
                    OutlinedButton(
                        onClick = { onViewResult(uiState.taskId) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (uiState.failed) "View what completed" else "View result")
                    }
                }
            }

            item(key = "tail") { Spacer(Modifier.height(8.dp)) }
        }
    }
}

@Composable
private fun StatusHeader(timeline: ExecutionTimeline, isFinished: Boolean, failed: Boolean) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = when {
                    failed -> "Finished with failures"
                    isFinished -> "Done"
                    else -> "Running"
                },
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                color = if (failed) executionColors.failed else MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = formatDuration(timeline.elapsedMs),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (!isFinished) {
            LinearProgressIndicator(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
            )
        }
    }
}

@Composable
private fun ReplanningBanner() {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = executionColors.skippedContainer,
        contentColor = executionColors.onSkippedContainer,
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = executionColors.skipped,
            )
            Text(
                text = "Re-planning around a failed subtask…",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(start = 12.dp),
            )
        }
    }
}

@Composable
private fun ConnectionPill(connection: TraceConnection) {
    val (dot, text) = when (connection) {
        TraceConnection.LIVE -> executionColors.done to MaterialTheme.colorScheme.onSurface
        TraceConnection.POLLING -> executionColors.skipped to MaterialTheme.colorScheme.onSurface
        TraceConnection.CLOSED -> MaterialTheme.colorScheme.outline to MaterialTheme.colorScheme.onSurfaceVariant
        else -> executionColors.running to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Row(
        modifier = Modifier.padding(end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(dot),
        )
        Text(
            text = connection.label,
            style = MaterialTheme.typography.labelMedium,
            color = text,
            modifier = Modifier.padding(start = 6.dp),
        )
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(top = 4.dp),
    )
}
