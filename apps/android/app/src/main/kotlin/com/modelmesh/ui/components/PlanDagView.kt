package com.modelmesh.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.modelmesh.data.models.PlanPreview
import com.modelmesh.data.models.PlanSummary
import com.modelmesh.ui.theme.CodeTextStyle
import com.modelmesh.ui.theme.executionColors

/** One meta stat shown in the plan header. */
private data class PlanMeta(val label: String, val value: String)

/**
 * The plan drawn as a DAG — a stack of parallel batches, in execution order — not a
 * flat checklist. This is Rule 2 made visible: nodes in the same row ran
 * concurrently; each row waited on the one above it. Deliberately not a general
 * graph layout; ordered batches are exactly what `parallelGroups` encodes.
 */
@Composable
fun PlanDagView(plan: PlanPreview, modifier: Modifier = Modifier) {
    val downgrade = if (plan.downgraded || plan.requestedStrategy != plan.strategy) {
        "Requested ${plan.requestedStrategy.label}; the planner chose ${plan.strategy.label} instead."
    } else {
        null
    }
    PlanDagCore(
        modifier = modifier,
        strategyLabel = plan.strategy.label,
        downgradeNote = downgrade,
        meta = listOfNotNull(
            plan.estimatedTokens.takeIf { it > 0 }?.let { PlanMeta("Est. tokens", formatTokens(it)) },
            plan.estimatedLatencyMs.takeIf { it > 0 }?.let { PlanMeta("Est. time", formatDuration(it)) },
            plan.reliabilityScore.takeIf { it > 0 }?.let { PlanMeta("Reliability", formatConfidence(it)) },
        ),
        parallelGroups = plan.parallelGroups,
        reasoning = plan.reasoning,
    )
}

@Composable
fun PlanDagView(plan: PlanSummary, modifier: Modifier = Modifier) {
    PlanDagCore(
        modifier = modifier,
        strategyLabel = plan.strategy.label,
        downgradeNote = null,
        meta = listOfNotNull(
            PlanMeta("Subtasks", plan.subtaskCount.toString()),
            plan.widestBatch.takeIf { it > 0 }?.let { PlanMeta("Widest batch", it.toString()) },
            plan.estimatedTokens?.takeIf { it > 0 }?.let { PlanMeta("Est. tokens", formatTokens(it)) },
            plan.reliabilityScore?.takeIf { it > 0 }?.let { PlanMeta("Reliability", formatConfidence(it)) },
        ),
        parallelGroups = plan.parallelGroups,
        reasoning = plan.reasoning,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PlanDagCore(
    strategyLabel: String,
    downgradeNote: String?,
    meta: List<PlanMeta>,
    parallelGroups: List<List<String>>,
    reasoning: String,
    modifier: Modifier = Modifier,
) {
    OutlinedCard(modifier = modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Plan",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Surface(
                    shape = RoundedCornerShape(50),
                    color = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                ) {
                    Text(
                        text = strategyLabel,
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
            }

            if (downgradeNote != null) {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 10.dp),
                    shape = RoundedCornerShape(8.dp),
                    color = executionColors.skippedContainer,
                    contentColor = executionColors.onSkippedContainer,
                ) {
                    Text(
                        text = downgradeNote,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(10.dp),
                    )
                }
            }

            if (meta.isNotEmpty()) {
                FlowRow(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(20.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    meta.forEach { m ->
                        Column {
                            Text(
                                text = m.value,
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = m.label,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            if (parallelGroups.isEmpty()) {
                Text(
                    text = "The plan's batches are not available yet.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 12.dp),
                )
            } else {
                Column(modifier = Modifier.padding(top = 12.dp)) {
                    parallelGroups.forEachIndexed { index, group ->
                        if (index > 0) BatchConnector()
                        ParallelBatch(index = index + 1, nodes = group)
                    }
                }
            }

            if (reasoning.isNotBlank()) {
                Text(
                    text = reasoning,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ParallelBatch(index: Int, nodes: List<String>) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            Text(
                text = if (nodes.size > 1) "Batch $index — ${nodes.size} run concurrently" else "Batch $index",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            FlowRow(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                nodes.forEach { node -> DagNode(node) }
            }
        }
    }
}

@Composable
private fun DagNode(id: String) {
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
    ) {
        Text(
            text = id,
            style = CodeTextStyle,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
        )
    }
}

/** A short vertical line + "then", showing the next batch waited on this one. */
@Composable
private fun BatchConnector() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .padding(start = 20.dp)
                .width(2.dp)
                .height(14.dp)
                .clip(RoundedCornerShape(1.dp))
                .background(MaterialTheme.colorScheme.outlineVariant),
        )
        Text(
            text = "then",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 10.dp),
        )
    }
}
