@file:OptIn(ExperimentalMaterial3Api::class)

package com.modelmesh.ui.result

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.modelmesh.data.models.TaskOutput
import com.modelmesh.data.models.TaskSnapshot
import com.modelmesh.data.models.TaskStatus
import com.modelmesh.data.models.VerificationView
import com.modelmesh.ui.components.ErrorBanner
import com.modelmesh.ui.components.PlanDagView
import com.modelmesh.ui.components.SubtaskProgressCard
import com.modelmesh.ui.components.TelemetryCard
import com.modelmesh.ui.components.formatConfidence
import com.modelmesh.ui.theme.CodeTextStyle
import com.modelmesh.ui.theme.executionColors

/**
 * The settled result. It refuses to overclaim: a partial or failed run says so at the
 * top, telemetry is captioned as covering only what completed (Rule 4 honesty), and
 * every subtask — including failed and skipped ones — is listed. The user can copy the
 * output and leave a 1–5 rating that feeds calibration.
 */
@Composable
fun ResultScreen(
    onBack: () -> Unit,
    onStartNew: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ResultViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("Result") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    TextButton(onClick = onStartNew) { Text("New task") }
                },
            )
        },
    ) { innerPadding ->
        val snapshot = uiState.snapshot
        when {
            snapshot == null && uiState.loading -> LoadingState(innerPadding)

            snapshot == null && uiState.error != null -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
                    .padding(16.dp),
            ) {
                ErrorBanner(failure = uiState.error!!, onRetry = viewModel::refresh)
            }

            snapshot != null -> ResultContent(
                snapshot = snapshot,
                uiState = uiState,
                innerPadding = innerPadding,
                onRatingChange = viewModel::onRatingChange,
                onCommentChange = viewModel::onCommentChange,
                onSubmitRating = viewModel::submitRating,
            )
        }
    }
}

@Composable
private fun LoadingState(innerPadding: androidx.compose.foundation.layout.PaddingValues) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(innerPadding),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator()
    }
}

@Composable
private fun ResultContent(
    snapshot: TaskSnapshot,
    uiState: ResultUiState,
    innerPadding: androidx.compose.foundation.layout.PaddingValues,
    onRatingChange: (Int) -> Unit,
    onCommentChange: (String) -> Unit,
    onSubmitRating: () -> Unit,
) {
    val output = snapshot.output
    val unfinished = snapshot.unfinished
    val failedNoOutput = snapshot.status == TaskStatus.FAILED && output == null
    val isPartial = output?.partial == true || unfinished.isNotEmpty()

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(innerPadding)
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when {
            failedNoOutput -> item(key = "failed") {
                StatusBanner(
                    background = executionColors.failedContainer,
                    foreground = executionColors.onFailedContainer,
                    title = "This task failed",
                    body = if (unfinished.isNotEmpty()) {
                        "${unfinished.size} subtask(s) didn't complete. The breakdown below shows what happened."
                    } else {
                        "No output was produced. The breakdown below shows what happened."
                    },
                )
            }

            isPartial -> item(key = "partial") {
                StatusBanner(
                    background = executionColors.skippedContainer,
                    foreground = executionColors.onSkippedContainer,
                    title = "Partial result",
                    body = "Some subtasks didn't complete. The output and the numbers below cover only what finished.",
                )
            }
        }

        if (output != null) {
            item(key = "output") { OutputCard(output = output) }
        }

        snapshot.verification?.let { verification ->
            item(key = "verification") { VerificationCard(verification = verification) }
        }

        item(key = "telemetry-header") { SectionLabel("Telemetry") }
        item(key = "telemetry") {
            TelemetryCard(
                telemetry = snapshot.telemetry,
                partial = isPartial,
                failedCount = unfinished.size,
            )
        }

        snapshot.plan?.let { plan ->
            item(key = "plan-header") { SectionLabel("Plan") }
            item(key = "plan") { PlanDagView(plan = plan) }
        }

        if (snapshot.subtasks.isNotEmpty()) {
            item(key = "subtasks-header") { SectionLabel("Subtask breakdown") }
            items(snapshot.subtasks, key = { "sub-${it.id}" }) { subtask ->
                SubtaskProgressCard(subtask = subtask)
            }
        }

        item(key = "feedback") {
            FeedbackCard(
                rating = uiState.feedbackRating,
                comment = uiState.feedbackComment,
                submitting = uiState.feedbackSubmitting,
                submitted = uiState.feedbackSubmitted,
                error = uiState.feedbackError,
                onRatingChange = onRatingChange,
                onCommentChange = onCommentChange,
                onSubmit = onSubmitRating,
            )
        }

        item(key = "tail") { Spacer(Modifier.height(8.dp)) }
    }
}

@Composable
private fun OutputCard(output: TaskOutput) {
    val clipboard = LocalClipboardManager.current
    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "Output",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { clipboard.setText(AnnotatedString(output.text)) }) {
                    Icon(Icons.Filled.ContentCopy, contentDescription = "Copy output")
                }
            }
            Text(
                text = "${output.format} · confidence ${formatConfidence(output.confidence)}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = output.text.ifBlank { "No text output." },
                style = if (output.format.equals("code", ignoreCase = true)) {
                    CodeTextStyle
                } else {
                    MaterialTheme.typography.bodyMedium
                },
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(top = 10.dp),
            )
        }
    }
}

@Composable
private fun VerificationCard(verification: VerificationView) {
    val accent = if (verification.verified) executionColors.done else executionColors.skipped
    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = if (verification.verified) "Verified" else "Not fully verified",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = accent,
            )
            Text(
                text = "Confidence ${formatConfidence(verification.confidence)}" +
                    (verification.verifiedBy?.let { " · by $it" } ?: ""),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (verification.issues.isNotEmpty()) {
                Text(
                    text = "Open issues",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 8.dp),
                )
                verification.issues.forEach { issue ->
                    Text(
                        text = "• $issue",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun FeedbackCard(
    rating: Int?,
    comment: String,
    submitting: Boolean,
    submitted: Boolean,
    error: com.modelmesh.util.AppResult.Failure?,
    onRatingChange: (Int) -> Unit,
    onCommentChange: (String) -> Unit,
    onSubmit: () -> Unit,
) {
    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "How did this go?",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = "Your rating tunes future routing and confidence estimates.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (submitted) {
                Text(
                    text = "Thanks — feedback recorded.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = executionColors.done,
                    modifier = Modifier.padding(top = 12.dp),
                )
                return@Column
            }

            Row(modifier = Modifier.padding(top = 8.dp)) {
                (1..5).forEach { star ->
                    val filled = rating != null && star <= rating
                    IconButton(onClick = { onRatingChange(star) }) {
                        Icon(
                            imageVector = if (filled) Icons.Filled.Star else Icons.Filled.StarBorder,
                            contentDescription = "Rate $star",
                            tint = if (filled) executionColors.savings else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            OutlinedTextField(
                value = comment,
                onValueChange = onCommentChange,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Comment (optional)") },
                singleLine = false,
            )

            error?.let {
                Text(
                    text = it.message,
                    style = MaterialTheme.typography.bodySmall,
                    color = executionColors.failed,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }

            Button(
                onClick = onSubmit,
                enabled = rating != null && !submitting,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
            ) {
                if (submitting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                    Spacer(Modifier.size(8.dp))
                    Text("Sending…")
                } else {
                    Text("Send feedback")
                }
            }
        }
    }
}

@Composable
private fun StatusBanner(
    background: androidx.compose.ui.graphics.Color,
    foreground: androidx.compose.ui.graphics.Color,
    title: String,
    body: String,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = background,
        contentColor = foreground,
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(text = body, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
        }
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
