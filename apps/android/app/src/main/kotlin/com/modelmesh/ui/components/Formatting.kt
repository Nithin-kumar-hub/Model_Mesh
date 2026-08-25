package com.modelmesh.ui.components

import java.util.Locale

/*
 * Internal formatting helpers shared by the cards. Not UI components — just the
 * one place number/duration formatting is decided, so token counts and percentages
 * read the same everywhere. All formatting is forced to Locale.US so a grouped
 * token count never turns into a decimal in a comma-decimal locale.
 */

private val GROUPING = Locale.US

/** "—" when unknown, "840ms" under a second, "1.4s" otherwise. */
internal fun formatDuration(ms: Long?): String = when {
    ms == null -> "—"
    ms < 1_000 -> "${ms}ms"
    else -> String.format(GROUPING, "%.1fs", ms / 1000.0)
}

internal fun formatDuration(ms: Int?): String = formatDuration(ms?.toLong())

/** Grouped token count, e.g. "12,480". "—" when unknown. */
internal fun formatTokens(n: Int?): String =
    if (n == null) "—" else String.format(GROUPING, "%,d", n)

internal fun formatTokens(n: Long?): String =
    if (n == null) "—" else String.format(GROUPING, "%,d", n)

/** One-decimal percent, e.g. "63.5%". Input is already a percentage (0–100). */
internal fun formatPercent(value: Double?): String =
    if (value == null) "—" else String.format(GROUPING, "%.1f%%", value)

/** Integer percent from a 0..1 fraction, e.g. 0.82 -> "82%". */
internal fun formatConfidence(fraction: Double?): String =
    if (fraction == null) "—" else "${(fraction * 100).toInt()}%"

/** Human file size, e.g. "3.4 MB". */
internal fun formatBytes(bytes: Long): String = when {
    bytes < 1_024 -> "$bytes B"
    bytes < 1_024 * 1_024 -> String.format(GROUPING, "%.1f KB", bytes / 1024.0)
    else -> String.format(GROUPING, "%.1f MB", bytes / (1024.0 * 1024.0))
}
