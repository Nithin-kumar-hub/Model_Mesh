package com.modelmesh.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.modelmesh.domain.preprocess.PreparedAttachment
import com.modelmesh.ui.theme.CodeTextStyle
import com.modelmesh.ui.theme.executionColors

/**
 * One preprocessed attachment. This is where the phone-native work becomes visible:
 * a thumbnail (images) or a type icon, the file name and size, and — crucially — the
 * on-device extraction result.
 *
 * It is also the Rule 6 boundary the user can see. Any extracted text is shown under
 * a "material" heading, clearly separated from the instruction field, and is never
 * merged into `userIntent`. This card only *displays* `detectedText`; it never
 * writes it anywhere.
 */
@Composable
fun AttachmentPreview(
    prepared: PreparedAttachment,
    modifier: Modifier = Modifier,
    onRemove: (() -> Unit)? = null,
) {
    val attachment = prepared.attachment
    OutlinedCard(modifier = modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Thumbnail(sourceUri = prepared.sourceUri, isImage = attachment.isImage)
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .padding(start = 12.dp),
                ) {
                    Text(
                        text = attachment.displayName,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "${attachment.mimeType} · ${formatBytes(attachment.sizeBytes)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = extractionSummary(prepared),
                        style = MaterialTheme.typography.labelMedium,
                        color = executionColors.savings,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
                if (onRemove != null) {
                    IconButton(onClick = onRemove) {
                        Icon(
                            imageVector = Icons.Filled.Close,
                            contentDescription = "Remove ${attachment.displayName}",
                        )
                    }
                }
            }

            // The extracted text is untrusted material, shown as such — visually
            // fenced off from the instruction the user typed (Rule 6).
            val detected = attachment.detectedText?.takeIf { it.isNotBlank() }
            if (detected != null) {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 10.dp),
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                ) {
                    Column(modifier = Modifier.padding(10.dp)) {
                        Text(
                            text = "Extracted material — not your instruction",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            text = detected.take(280) + if (detected.length > 280) "…" else "",
                            style = CodeTextStyle,
                            color = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Thumbnail(sourceUri: String?, isImage: Boolean) {
    val shape = RoundedCornerShape(8.dp)
    if (isImage && sourceUri != null) {
        AsyncImage(
            model = sourceUri,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .size(52.dp)
                .clip(shape),
        )
    } else {
        Surface(
            modifier = Modifier.size(52.dp),
            shape = shape,
            color = MaterialTheme.colorScheme.secondaryContainer,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = Icons.Filled.Description,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
        }
    }
}

/** The "we did this on the phone" line — text count, then barcode, then honest none. */
private fun extractionSummary(prepared: PreparedAttachment): String {
    val chars = prepared.extractedChars
    val barcode = prepared.findings.barcodeData
    return when {
        chars > 0 -> "${formatTokens(chars)} characters extracted on device"
        !barcode.isNullOrBlank() -> "Barcode read on device"
        else -> "No text found on device"
    }
}
