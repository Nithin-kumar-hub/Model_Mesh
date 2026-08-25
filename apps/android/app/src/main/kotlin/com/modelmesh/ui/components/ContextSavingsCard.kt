package com.modelmesh.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.modelmesh.data.models.ContextSavings
import com.modelmesh.ui.theme.executionColors

/**
 * Rule 1, as the single most important number in the product: the master context is
 * sliced so each subtask sees only what it needs, instead of every model getting the
 * whole thing. A two-bar comparison — the naive "everything to everyone" baseline
 * against what ModelMesh actually sent — reads faster than any sentence.
 */
@Composable
fun ContextSavingsCard(savings: ContextSavings, modifier: Modifier = Modifier) {
    val naive = savings.naiveContextTokens.coerceAtLeast(0)
    val sliced = savings.slicedContextTokens.coerceAtLeast(0)
    val slicedFraction = if (naive > 0) (sliced.toFloat() / naive).coerceIn(0f, 1f) else 0f

    ElevatedCard(modifier = modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "Context savings",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 8.dp)) {
                Text(
                    text = "${savings.reductionPercent}%",
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                    color = executionColors.savings,
                )
                Text(
                    text = "less context per subtask",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 8.dp, bottom = 6.dp),
                )
            }

            ComparisonBar(
                label = "Everything to every subtask",
                value = "${formatTokens(naive)} tok",
                fraction = 1f,
                color = MaterialTheme.colorScheme.surfaceVariant,
                labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 14.dp),
            )
            ComparisonBar(
                label = "ModelMesh — sliced per subtask",
                value = "${formatTokens(sliced)} tok",
                fraction = slicedFraction,
                color = executionColors.savings,
                labelColor = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(top = 10.dp),
            )

            Text(
                text = "Master context: ${formatTokens(savings.masterContextTokens)} tokens, built once and sliced — never resent whole.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 12.dp),
            )
        }
    }
}

@Composable
private fun ComparisonBar(
    label: String,
    value: String,
    fraction: Float,
    color: Color,
    labelColor: Color,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween,
        ) {
            Text(text = label, style = MaterialTheme.typography.labelMedium, color = labelColor)
            Text(text = value, style = MaterialTheme.typography.labelMedium, color = labelColor)
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp)
                .height(14.dp)
                .clip(RoundedCornerShape(7.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            // Guard the zero case: a hairline is still visible so an all-sliced-away
            // subtask does not look like missing data.
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction.coerceAtLeast(0.02f))
                    .height(14.dp)
                    .clip(RoundedCornerShape(7.dp))
                    .background(color),
            )
        }
    }
}
