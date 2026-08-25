package com.modelmesh.di

import com.modelmesh.data.api.dto.BudgetDto
import com.modelmesh.data.api.dto.LocalMetadataDto
import com.modelmesh.data.api.dto.SubmitTaskRequestDto
import com.modelmesh.data.api.dto.TaskInputDto
import com.modelmesh.data.api.dto.TaskResponseDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The wire format the backend actually accepts.
 *
 * `POST /tasks` is validated by a Zod schema that is `.strict()` at every level, so
 * an explicit `null` for an optional field is a 400 — not a tolerated no-op. That
 * makes `explicitNulls = false` part of the contract, and this test is what stops a
 * future edit to [NetworkModule] from quietly breaking every submission.
 */
class NetworkJsonTest {

    private val json = NetworkModule.json()

    @Test
    fun `absent optional blocks are omitted, never serialized as null`() {
        val encoded = json.encodeToString(
            SubmitTaskRequestDto.serializer(),
            SubmitTaskRequestDto(
                input = TaskInputDto(type = "text", text = "Explain this stack trace"),
                strategy = "balanced",
            ),
        )

        assertFalse("an explicit null would be rejected by the backend", encoded.contains("null"))
        assertFalse(encoded.contains("budget"))
        assertFalse(encoded.contains("preferences"))
        assertFalse(encoded.contains("files"))
        assertTrue(encoded.contains("\"type\":\"text\""))
        assertTrue(encoded.contains("\"strategy\":\"balanced\""))
    }

    @Test
    fun `only the metadata fields the device could actually report are sent`() {
        // An unknown capability is absent, not `false` — the backend never has to
        // distinguish "no NPU" from "we could not tell".
        assertEquals(
            """{"batteryLevel":77}""",
            json.encodeToString(LocalMetadataDto.serializer(), LocalMetadataDto(batteryLevel = 77)),
        )
    }

    @Test
    fun `a populated budget is sent in full`() {
        val encoded = json.encodeToString(
            SubmitTaskRequestDto.serializer(),
            SubmitTaskRequestDto(
                input = TaskInputDto(type = "text", text = "hi"),
                budget = BudgetDto(maxTokens = 20_000, maxLatencyMs = 30_000),
            ),
        )

        assertTrue(encoded.contains("\"maxTokens\":20000"))
        assertTrue(encoded.contains("\"maxLatencyMs\":30000"))
        assertFalse(encoded.contains("minQuality"))
    }

    @Test
    fun `unknown response fields do not break decoding`() {
        val decoded = json.decodeFromString(
            TaskResponseDto.serializer(),
            """{"taskId":"task_01","status":"completed","somethingTheBackendAddedLater":42}""",
        )

        assertEquals("task_01", decoded.taskId)
        assertEquals("completed", decoded.status)
        assertTrue(decoded.subtasks.isEmpty())
    }
}
