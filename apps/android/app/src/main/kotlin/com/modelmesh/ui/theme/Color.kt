package com.modelmesh.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/*
 * ModelMesh palette.
 *
 * Brand identity is an indigo "hub" with a teal accent — the same mesh motif as
 * the launcher icon. The palette also carries meaning: the execution states have
 * dedicated semantic colors (below) so the trace screen, the status chips, and the
 * subtask cards all agree on what "running", "failed", or "skipped" looks like.
 */

// ── Material 3 roles — light ────────────────────────────────────────────────
internal val md_light_primary = Color(0xFF5A54E0)
internal val md_light_onPrimary = Color(0xFFFFFFFF)
internal val md_light_primaryContainer = Color(0xFFE4E0FF)
internal val md_light_onPrimaryContainer = Color(0xFF150467)
internal val md_light_secondary = Color(0xFF5B5D72)
internal val md_light_onSecondary = Color(0xFFFFFFFF)
internal val md_light_secondaryContainer = Color(0xFFE1E0F9)
internal val md_light_onSecondaryContainer = Color(0xFF181A2C)
internal val md_light_tertiary = Color(0xFF00696E)
internal val md_light_onTertiary = Color(0xFFFFFFFF)
internal val md_light_tertiaryContainer = Color(0xFF6FF6FD)
internal val md_light_onTertiaryContainer = Color(0xFF002022)
internal val md_light_error = Color(0xFFBA1A1A)
internal val md_light_onError = Color(0xFFFFFFFF)
internal val md_light_errorContainer = Color(0xFFFFDAD6)
internal val md_light_onErrorContainer = Color(0xFF410002)
internal val md_light_background = Color(0xFFFBF8FF)
internal val md_light_onBackground = Color(0xFF1B1B21)
internal val md_light_surface = Color(0xFFFBF8FF)
internal val md_light_onSurface = Color(0xFF1B1B21)
internal val md_light_surfaceVariant = Color(0xFFE4E1EC)
internal val md_light_onSurfaceVariant = Color(0xFF46464F)
internal val md_light_surfaceContainer = Color(0xFFF0ECF6)
internal val md_light_surfaceContainerHigh = Color(0xFFEAE7F1)
internal val md_light_outline = Color(0xFF777680)
internal val md_light_outlineVariant = Color(0xFFC8C5D0)
internal val md_light_inverseSurface = Color(0xFF303036)
internal val md_light_inverseOnSurface = Color(0xFFF2EFF7)

// ── Material 3 roles — dark ─────────────────────────────────────────────────
internal val md_dark_primary = Color(0xFFC6C0FF)
internal val md_dark_onPrimary = Color(0xFF281C76)
internal val md_dark_primaryContainer = Color(0xFF4139A9)
internal val md_dark_onPrimaryContainer = Color(0xFFE4E0FF)
internal val md_dark_secondary = Color(0xFFC4C4DD)
internal val md_dark_onSecondary = Color(0xFF2D2F42)
internal val md_dark_secondaryContainer = Color(0xFF434559)
internal val md_dark_onSecondaryContainer = Color(0xFFE1E0F9)
internal val md_dark_tertiary = Color(0xFF4FD9E1)
internal val md_dark_onTertiary = Color(0xFF00363A)
internal val md_dark_tertiaryContainer = Color(0xFF004F54)
internal val md_dark_onTertiaryContainer = Color(0xFF6FF6FD)
internal val md_dark_error = Color(0xFFFFB4AB)
internal val md_dark_onError = Color(0xFF690005)
internal val md_dark_errorContainer = Color(0xFF93000A)
internal val md_dark_onErrorContainer = Color(0xFFFFDAD6)
internal val md_dark_background = Color(0xFF131318)
internal val md_dark_onBackground = Color(0xFFE4E1E9)
internal val md_dark_surface = Color(0xFF131318)
internal val md_dark_onSurface = Color(0xFFE4E1E9)
internal val md_dark_surfaceVariant = Color(0xFF46464F)
internal val md_dark_onSurfaceVariant = Color(0xFFC8C5D0)
internal val md_dark_surfaceContainer = Color(0xFF1F1F25)
internal val md_dark_surfaceContainerHigh = Color(0xFF2A2930)
internal val md_dark_outline = Color(0xFF918F9A)
internal val md_dark_outlineVariant = Color(0xFF46464F)
internal val md_dark_inverseSurface = Color(0xFFE4E1E9)
internal val md_dark_inverseOnSurface = Color(0xFF303036)

/**
 * Semantic colors for execution state. Every value has an accent (for
 * indicators/labels drawn on a surface) plus a container/onContainer pair (for
 * filled chips), so the same state reads consistently everywhere it appears.
 *
 * `skipped` is deliberately amber, not red: a skipped subtask is a consequence of
 * an upstream failure, not a fault in itself. `savings` is teal to stand apart
 * from the green `done` — it is the product's hero number, not just another
 * success marker.
 */
@Immutable
data class ExecutionColors(
    val running: Color,
    val runningContainer: Color,
    val onRunningContainer: Color,
    val done: Color,
    val doneContainer: Color,
    val onDoneContainer: Color,
    val failed: Color,
    val failedContainer: Color,
    val onFailedContainer: Color,
    val skipped: Color,
    val skippedContainer: Color,
    val onSkippedContainer: Color,
    val pending: Color,
    val pendingContainer: Color,
    val onPendingContainer: Color,
    val savings: Color,
    val savingsContainer: Color,
    val onSavingsContainer: Color,
)

val LightExecutionColors = ExecutionColors(
    running = Color(0xFF1B61C9),
    runningContainer = Color(0xFFD9E7FF),
    onRunningContainer = Color(0xFF001B3D),
    done = Color(0xFF1E7D34),
    doneContainer = Color(0xFFB9F0C0),
    onDoneContainer = Color(0xFF00210A),
    failed = Color(0xFFBA1A1A),
    failedContainer = Color(0xFFFFDAD6),
    onFailedContainer = Color(0xFF410002),
    skipped = Color(0xFF815600),
    skippedContainer = Color(0xFFFFDDB0),
    onSkippedContainer = Color(0xFF291800),
    pending = Color(0xFF5F5E66),
    pendingContainer = Color(0xFFE5E1EC),
    onPendingContainer = Color(0xFF1B1B21),
    savings = Color(0xFF00696E),
    savingsContainer = Color(0xFFA6F0F5),
    onSavingsContainer = Color(0xFF002022),
)

val DarkExecutionColors = ExecutionColors(
    running = Color(0xFFA6C8FF),
    runningContainer = Color(0xFF00468C),
    onRunningContainer = Color(0xFFD9E7FF),
    done = Color(0xFF7FD98D),
    doneContainer = Color(0xFF005321),
    onDoneContainer = Color(0xFFB9F0C0),
    failed = Color(0xFFFFB4AB),
    failedContainer = Color(0xFF93000A),
    onFailedContainer = Color(0xFFFFDAD6),
    skipped = Color(0xFFF5BD4F),
    skippedContainer = Color(0xFF614000),
    onSkippedContainer = Color(0xFFFFDDB0),
    pending = Color(0xFFC9C5D0),
    pendingContainer = Color(0xFF3A3A40),
    onPendingContainer = Color(0xFFE5E1EC),
    savings = Color(0xFF4FD9E1),
    savingsContainer = Color(0xFF004F54),
    onSavingsContainer = Color(0xFFA6F0F5),
)

/**
 * Provided by [ModelMeshTheme] for the active scheme. Reachable in any Composable
 * as `executionColors`. Defaults to the light set so a stray read outside the
 * theme is legible rather than crashing.
 */
val LocalExecutionColors = staticCompositionLocalOf { LightExecutionColors }
