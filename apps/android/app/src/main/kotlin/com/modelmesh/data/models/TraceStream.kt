package com.modelmesh.data.models

/**
 * What the execution screen collects from the trace stream.
 *
 * The socket replays history on join and can reconnect mid-run, so a consumer
 * needs both the folded timeline and the transport's state — a stalled trace and
 * a finished task look identical if you only render events.
 */
data class TimelineUpdate(
    val timeline: ExecutionTimeline,
    val connection: TraceConnection,
)

/**
 * Transport state for the trace stream.
 *
 * `POLLING` is the honest fallback: the socket could not be established (captive
 * portal, proxy that drops upgrades) and the timeline is being refreshed from
 * `GET /tasks/:id/trace` instead. The UI says so rather than pretending to be live.
 */
enum class TraceConnection(val label: String) {
    CONNECTING("Connecting"),
    LIVE("Live"),
    RECONNECTING("Reconnecting"),
    POLLING("Polling (no live socket)"),
    CLOSED("Closed"),
}
