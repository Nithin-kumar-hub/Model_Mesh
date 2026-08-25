package com.modelmesh.data.api

import android.util.Log
import com.modelmesh.data.models.TraceEvent
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import org.json.JSONObject
import java.net.URI
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/**
 * Live execution trace over Socket.io.
 *
 * The backend serves Socket.io on path `/ws` with one room per task, replays the
 * persisted trace on join (`trace_history`), then streams `trace` events. That
 * replay is what makes this safe on a phone: a subscription that starts after
 * `plan_selected`, or resumes after the radio drops, still renders the whole
 * timeline instead of a hole.
 *
 * A closed flow disconnects the socket, so a screen leaving composition frees
 * its slot against the backend's 5-connections-per-key cap.
 */
@Singleton
class TraceSocketClient @Inject constructor(
    @Named("wsBaseUrl") private val wsBaseUrl: String,
    @Named("apiKey") private val apiKey: String,
) {

    sealed interface Signal {
        /** The persisted timeline, replayed on join. */
        data class History(val events: List<TraceEvent>) : Signal

        data class Live(val event: TraceEvent) : Signal

        data object Connected : Signal

        data class Disconnected(val reason: String) : Signal

        /** Transport-level failure. The caller decides whether to fall back to polling. */
        data class Error(val message: String) : Signal
    }

    fun observe(taskId: String): Flow<Signal> = callbackFlow {
        val options = IO.Options().apply {
            path = SOCKET_PATH
            // Handshake auth, so the key never lands in a query string or a log.
            auth = mapOf("apiKey" to apiKey)
            query = "taskId=$taskId"
            transports = arrayOf("websocket")
            reconnection = true
            reconnectionDelay = 1_000
            reconnectionDelayMax = 8_000
            timeout = 20_000
        }

        val socket: Socket = IO.socket(URI.create(wsBaseUrl), options)

        val onConnect = io.socket.emitter.Emitter.Listener {
            // Re-subscribing on every connect covers reconnects, where the
            // handshake query is replayed but the room membership is not.
            socket.emit(EVENT_SUBSCRIBE, JSONObject(mapOf("taskId" to taskId)))
            trySend(Signal.Connected)
        }

        val onHistory = io.socket.emitter.Emitter.Listener { args ->
            val payload = args.firstOrNull() as? JSONObject ?: return@Listener
            trySend(Signal.History(TraceEventMapper.historyFromSocket(taskId, payload)))
        }

        val onTrace = io.socket.emitter.Emitter.Listener { args ->
            val payload = args.firstOrNull() as? JSONObject ?: return@Listener
            trySend(Signal.Live(TraceEventMapper.fromSocket(taskId, payload)))
        }

        val onDisconnect = io.socket.emitter.Emitter.Listener { args ->
            trySend(Signal.Disconnected(args.firstOrNull()?.toString() ?: "disconnected"))
        }

        val onError = io.socket.emitter.Emitter.Listener { args ->
            val message = args.firstOrNull()?.toString() ?: "socket error"
            Log.w(TAG, "Trace socket error for $taskId: $message")
            trySend(Signal.Error(message))
        }

        socket.on(Socket.EVENT_CONNECT, onConnect)
        socket.on(Socket.EVENT_DISCONNECT, onDisconnect)
        socket.on(Socket.EVENT_CONNECT_ERROR, onError)
        socket.on(EVENT_TRACE_HISTORY, onHistory)
        socket.on(EVENT_TRACE, onTrace)

        socket.connect()

        awaitClose {
            socket.emit(EVENT_UNSUBSCRIBE, JSONObject(mapOf("taskId" to taskId)))
            socket.off()
            socket.disconnect()
            socket.close()
        }
    }

    private companion object {
        const val TAG = "TraceSocketClient"
        const val SOCKET_PATH = "/ws"
        const val EVENT_TRACE = "trace"
        const val EVENT_TRACE_HISTORY = "trace_history"
        const val EVENT_SUBSCRIBE = "subscribe"
        const val EVENT_UNSUBSCRIBE = "unsubscribe"
    }
}
