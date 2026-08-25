package com.modelmesh

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.navigation.compose.rememberNavController
import com.modelmesh.ui.input.SharedContent
import com.modelmesh.ui.navigation.ModelMeshNavHost
import com.modelmesh.ui.theme.ModelMeshTheme
import dagger.hilt.android.AndroidEntryPoint

/**
 * The single activity. Its only responsibilities are Hilt entry (`@AndroidEntryPoint`
 * so the ViewModels' use cases can be injected), edge-to-edge chrome, hosting the nav
 * graph, and turning an Android *share* into a [SharedContent] for the input screen.
 *
 * The share handling is where Rule 6 lives at the OS boundary: shared **text** is an
 * instruction and may prefill the field; a shared **image or PDF** is material and is
 * only ever forwarded as a stream URI, so it goes through on-device preprocessing and
 * is never concatenated into the instruction.
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    // Observable so a share arriving via onNewIntent recomposes the graph.
    private val sharedContent = mutableStateOf<SharedContent?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        sharedContent.value = intent?.parseSharedContent(this)

        setContent {
            ModelMeshTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    val navController = rememberNavController()
                    val shared by sharedContent

                    ModelMeshNavHost(
                        navController = navController,
                        sharedContent = shared,
                        onSharedContentConsumed = { sharedContent.value = null },
                    )
                }
            }
        }
    }

    /**
     * A share that arrives while the app is already running. We route it to the input
     * screen so the new task is composed there, never appended to whatever screen the
     * user happened to be on.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.parseSharedContent(this)?.let { sharedContent.value = it }
    }
}

/**
 * Turn an `ACTION_SEND` into a [SharedContent], or null if this isn't a share we
 * accept. Text and file paths are kept apart deliberately (Rule 6) — a file never
 * becomes instruction text here.
 */
private fun Intent.parseSharedContent(context: Context): SharedContent? {
    if (action != Intent.ACTION_SEND) return null
    val mime = type ?: return null

    return when {
        mime == "text/plain" -> {
            val text = getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }
            text?.let { SharedContent(text = it) }
        }

        mime.startsWith("image/") || mime == "application/pdf" -> {
            val uri = extraStreamCompat() ?: return null
            SharedContent(
                streamUri = uri.toString(),
                mimeType = mime,
                displayName = context.displayNameFor(uri) ?: uri.lastPathSegment ?: "shared-file",
            )
        }

        else -> null
    }
}

@Suppress("DEPRECATION")
private fun Intent.extraStreamCompat(): Uri? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
        getParcelableExtra(Intent.EXTRA_STREAM)
    }

private fun Context.displayNameFor(uri: Uri): String? {
    if (uri.scheme != "content") return null
    return runCatching {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) cursor.getString(index) else null
            } else {
                null
            }
        }
    }.getOrNull()
}
