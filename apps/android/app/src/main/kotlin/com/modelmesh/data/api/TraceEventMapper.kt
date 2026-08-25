package com.modelmesh.data.api

import com.modelmesh.data.models.TraceEvent
import com.modelmesh.data.models.TraceEventName
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import org.json.JSONArray
import org.json.JSONObject

/**
 * Trace events arrive two ways — replayed over REST (kotlinx `JsonObject`) and
 * live over Socket.io (`org.json.JSONObject`) — and both must fold into the same
 * domain type, or the timeline would render differently depending on when the
 * screen was opened.
 */
object TraceEventMapper {

    private val RESERVED = setOf("event", "ts", "taskId")

    fun fromRest(taskId: String, json: JsonObject): TraceEvent {
        val rawName = (json["event"] as? JsonPrimitive)?.contentOrNullSafe().orEmpty()
        val offset = (json["ts"] as? JsonPrimitive)?.longOrNull ?: 0L

        return TraceEvent(
            name = TraceEventName.fromWire(rawName),
            taskId = taskId,
            offsetMs = offset,
            payload = json.filterKeys { it !in RESERVED }.mapValues { (_, value) -> unwrap(value) },
            rawName = rawName,
        )
    }

    fun fromSocket(fallbackTaskId: String, json: JSONObject): TraceEvent {
        val rawName = json.optString("event")
        val payload = LinkedHashMap<String, Any?>()
        for (key in json.keys()) {
            if (key in RESERVED) continue
            payload[key] = unwrap(json.opt(key))
        }

        return TraceEvent(
            name = TraceEventName.fromWire(rawName),
            taskId = json.optString("taskId").ifEmpty { fallbackTaskId },
            offsetMs = json.optLong("ts", 0L),
            payload = payload,
            rawName = rawName,
        )
    }

    /** `trace_history` replays the whole timeline when a socket joins a room. */
    fun historyFromSocket(fallbackTaskId: String, json: JSONObject): List<TraceEvent> {
        val taskId = json.optString("taskId").ifEmpty { fallbackTaskId }
        val events = json.optJSONArray("events") ?: return emptyList()
        return (0 until events.length()).mapNotNull { index ->
            events.optJSONObject(index)?.let { fromSocket(taskId, it) }
        }
    }

    // ── Loose value unwrapping ────────────────────────────────────────────

    private fun unwrap(value: Any?): Any? = when (value) {
        null, JSONObject.NULL -> null
        is JSONObject -> value.keys().asSequence().associateWith { unwrap(value.opt(it)) }
        is JSONArray -> (0 until value.length()).map { unwrap(value.opt(it)) }
        else -> value
    }

    private fun unwrap(value: kotlinx.serialization.json.JsonElement): Any? = when (value) {
        is JsonNull -> null
        is JsonPrimitive -> when {
            value.isString -> value.content
            value.booleanOrNull != null -> value.booleanOrNull
            value.longOrNull != null -> value.longOrNull
            value.doubleOrNull != null -> value.doubleOrNull
            else -> value.content
        }
        is JsonObject -> value.mapValues { (_, nested) -> unwrap(nested) }
        is JsonArray -> value.map { unwrap(it) }
    }

    private fun JsonPrimitive.contentOrNullSafe(): String? = if (this is JsonNull) null else content
}
