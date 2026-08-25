package com.modelmesh.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.modelmesh.util.AppResult
import com.modelmesh.util.ErrorCode

/**
 * A failure the user can act on. The action is chosen from the [ErrorCode]: a
 * transient/transport error offers retry; an input problem offers a way back to the
 * input to fix it. Codes with no user action (auth, not-found) show the message
 * alone rather than a button that would do nothing.
 */
@Composable
fun ErrorBanner(
    failure: AppResult.Failure,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
    onEditInput: (() -> Unit)? = null,
) {
    val retryable = failure.code in RETRYABLE
    val editable = failure.code in EDITABLE

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        shape = MaterialTheme.shapes.medium,
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(imageVector = Icons.Filled.ErrorOutline, contentDescription = null)
                Text(
                    text = headline(failure.code),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            Text(
                text = failure.message,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 6.dp),
            )
            if ((retryable && onRetry != null) || (editable && onEditInput != null)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp),
                    horizontalArrangement = Arrangement.End,
                ) {
                    if (editable && onEditInput != null) {
                        TextButton(
                            onClick = onEditInput,
                            colors = ButtonDefaults.textButtonColors(
                                contentColor = MaterialTheme.colorScheme.onErrorContainer,
                            ),
                        ) { Text("Edit input") }
                    }
                    if (retryable && onRetry != null) {
                        Button(
                            onClick = onRetry,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.error,
                                contentColor = MaterialTheme.colorScheme.onError,
                            ),
                        ) { Text("Retry") }
                    }
                }
            }
        }
    }
}

private val RETRYABLE = setOf(
    ErrorCode.OFFLINE,
    ErrorCode.TIMEOUT,
    ErrorCode.RATE_LIMITED,
    ErrorCode.NO_PROVIDERS_AVAILABLE,
    ErrorCode.INTERNAL,
)

private val EDITABLE = setOf(
    ErrorCode.INVALID_INPUT,
    ErrorCode.PROMPT_INJECTION,
    ErrorCode.UNSUPPORTED_MODALITY,
    ErrorCode.FILE_TOO_LARGE,
)

private fun headline(code: ErrorCode): String = when (code) {
    ErrorCode.INVALID_INPUT -> "Check your input"
    ErrorCode.UNSUPPORTED_MODALITY -> "Unsupported file type"
    ErrorCode.FILE_TOO_LARGE -> "File too large"
    ErrorCode.PROMPT_INJECTION -> "That input was blocked"
    ErrorCode.TASK_NOT_FOUND -> "Task not found"
    ErrorCode.UNAUTHORIZED -> "Not authorized"
    ErrorCode.RATE_LIMITED -> "Rate limited"
    ErrorCode.NO_PROVIDERS_AVAILABLE -> "No providers available"
    ErrorCode.TIMEOUT -> "Timed out"
    ErrorCode.OFFLINE -> "You're offline"
    ErrorCode.INTERNAL -> "Something went wrong"
}
