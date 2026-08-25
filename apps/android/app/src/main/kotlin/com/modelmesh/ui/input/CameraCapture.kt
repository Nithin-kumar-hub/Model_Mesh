@file:OptIn(ExperimentalPermissionsApi::class)

package com.modelmesh.ui.input

import android.Manifest
import android.net.Uri
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.view.CameraController
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.google.accompanist.permissions.shouldShowRationale
import java.io.File

/**
 * A full-screen camera for capturing one photo to attach. The JPEG is written to the
 * app's own cache dir and handed back as a `file://` URI string — no `FileProvider`,
 * because the file never leaves the app; [PreprocessAttachmentUseCase] reads it in
 * place and the captured image is treated as material, not instruction (Rule 6).
 *
 * Permission is requested with Accompanist; if it is denied we explain why rather than
 * silently showing a black screen.
 */
@Composable
fun CameraCapture(
    onImageCaptured: (String) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val cameraPermission = rememberPermissionState(Manifest.permission.CAMERA)

    LaunchedEffect(Unit) {
        if (!cameraPermission.status.isGranted) {
            cameraPermission.launchPermissionRequest()
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        if (cameraPermission.status.isGranted) {
            CameraViewfinder(onImageCaptured = onImageCaptured)
        } else {
            PermissionRationale(
                shouldShowRationale = cameraPermission.status.shouldShowRationale,
                onRequest = { cameraPermission.launchPermissionRequest() },
            )
        }

        IconButton(
            onClick = onCancel,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(8.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.Close,
                contentDescription = "Close camera",
                tint = Color.White,
            )
        }
    }
}

@Composable
private fun BoxScope.CameraViewfinder(onImageCaptured: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val controller = remember {
        LifecycleCameraController(context).apply {
            setEnabledUseCases(CameraController.IMAGE_CAPTURE)
        }
    }
    var capturing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            PreviewView(ctx).apply {
                this.controller = controller
                controller.bindToLifecycle(lifecycleOwner)
            }
        },
    )

    error?.let { message ->
        Surface(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(top = 56.dp, start = 16.dp, end = 16.dp),
            color = MaterialTheme.colorScheme.errorContainer,
            contentColor = MaterialTheme.colorScheme.onErrorContainer,
            shape = MaterialTheme.shapes.medium,
        ) {
            Text(text = message, modifier = Modifier.padding(12.dp))
        }
    }

    Button(
        modifier = Modifier
            .align(Alignment.BottomCenter)
            .padding(bottom = 40.dp),
        onClick = {
            if (capturing) return@Button
            capturing = true
            error = null
            val file = File(context.cacheDir, "capture-${System.currentTimeMillis()}.jpg")
            val output = ImageCapture.OutputFileOptions.Builder(file).build()
            controller.takePicture(
                output,
                ContextCompat.getMainExecutor(context),
                object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(results: ImageCapture.OutputFileResults) {
                        capturing = false
                        onImageCaptured(Uri.fromFile(file).toString())
                    }

                    override fun onError(exception: ImageCaptureException) {
                        capturing = false
                        error = exception.message ?: "Couldn't capture the photo. Try again."
                    }
                },
            )
        },
    ) {
        Text(if (capturing) "Capturing…" else "Capture")
    }
}

@Composable
private fun BoxScope.PermissionRationale(shouldShowRationale: Boolean, onRequest: () -> Unit) {
    Column(
        modifier = Modifier
            .align(Alignment.Center)
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Filled.PhotoCamera,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(48.dp),
        )
        Text(
            text = if (shouldShowRationale) {
                "Camera access is needed to take a photo to attach as material."
            } else {
                "Allow camera access to take a photo."
            },
            color = Color.White,
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(vertical = 16.dp),
        )
        Button(onClick = onRequest) {
            Text("Allow camera")
        }
        Spacer(Modifier.size(8.dp))
    }
}
