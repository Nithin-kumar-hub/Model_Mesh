package com.modelmesh.data.preprocess

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import com.modelmesh.data.models.LocalMetadata
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Hardware and connectivity facts, sent to the backend as routing hints.
 *
 * The rule for this class is that an unknown is reported as `null`, never as
 * `false`. The backend treats every field here as a hint and never trusts it for
 * correctness, so a `null` costs nothing — while a fabricated `true` would corrupt
 * a real routing decision. That is why [LocalMetadata]'s hardware fields are all
 * nullable.
 */
@Singleton
class DeviceCapabilities @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    fun snapshot(): LocalMetadata = LocalMetadata(
        deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}".take(MAX_DEVICE_MODEL_CHARS),
        hasNPU = npuDeclared(),
        // Every Android device has a GPU, so `true` would be vacuous, and whether
        // GPU-accelerated *inference* is available cannot be read from the SDK.
        hasGPU = null,
        batteryLevel = batteryLevel(),
        isOnWifi = onWifi(),
    )

    /**
     * `false` from `hasSystemFeature` means "not declared", which is not the same
     * as "not present" — so only a `true` is informative.
     */
    private fun npuDeclared(): Boolean? =
        if (context.packageManager.hasSystemFeature(FEATURE_NEURAL_NETWORKS)) true else null

    private fun batteryLevel(): Int? {
        // A null receiver returns the last sticky broadcast without registering.
        val status = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?: return null
        val level = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        if (level < 0 || scale <= 0) return null
        // The backend's Zod schema rejects anything outside 0–100.
        return (level * 100 / scale).coerceIn(0, 100)
    }

    /** `null` when there is no active network at all — different from "on cellular". */
    private fun onWifi(): Boolean? {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return null
        val network = manager.activeNetwork ?: return null
        val capabilities = manager.getNetworkCapabilities(network) ?: return null
        return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }

    private companion object {
        const val FEATURE_NEURAL_NETWORKS = "android.hardware.neuralnetworks"

        /** `deviceModel` is capped at 120 chars by the backend schema. */
        const val MAX_DEVICE_MODEL_CHARS = 120
    }
}
