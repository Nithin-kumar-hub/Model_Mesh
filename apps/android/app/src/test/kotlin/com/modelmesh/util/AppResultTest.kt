package com.modelmesh.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppResultTest {

    private val failure = AppResult.Failure(ErrorCode.OFFLINE, "no network")

    @Test
    fun `map transforms a success`() {
        val mapped = AppResult.Success(2).map { it * 21 }

        assertEquals(AppResult.Success(42), mapped)
    }

    @Test
    fun `map leaves a failure untouched and does not run the transform`() {
        var ran = false

        val mapped: AppResult<String> = failure.map { ran = true; "never" }

        assertFalse(ran)
        assertEquals(failure, mapped)
    }

    @Test
    fun `onSuccess runs only for a success and returns the receiver`() {
        var seen: Int? = null
        val result: AppResult<Int> = AppResult.Success(7)

        val returned = result.onSuccess { seen = it }

        assertEquals(7, seen)
        assertEquals(result, returned)
    }

    @Test
    fun `onSuccess does not run for a failure`() {
        var ran = false

        failure.onSuccess { ran = true }

        assertFalse(ran)
    }

    @Test
    fun `onFailure exposes the code and message`() {
        var code: ErrorCode? = null
        var message: String? = null

        failure.onFailure { code = it.code; message = it.message }

        assertEquals(ErrorCode.OFFLINE, code)
        assertEquals("no network", message)
    }

    @Test
    fun `onFailure does not run for a success`() {
        var ran = false

        AppResult.Success(Unit).onFailure { ran = true }

        assertFalse(ran)
    }

    @Test
    fun `getOrNull unwraps a success and nulls a failure`() {
        assertEquals("ok", AppResult.Success("ok").getOrNull())
        assertNull(failure.getOrNull())
    }

    @Test
    fun `getOrNull returns a stored null payload`() {
        // A nullable success payload is legitimate: "the task is not known yet".
        assertNull(AppResult.Success<String?>(null).getOrNull())
    }

    @Test
    fun `chaining map keeps the original failure code`() {
        val chained = failure.map { 1 }.map { it + 1 }

        assertTrue(chained is AppResult.Failure)
        assertEquals(ErrorCode.OFFLINE, (chained as AppResult.Failure).code)
    }

    @Test
    fun `fromWire collapses unmodelled codes to INTERNAL and maps aliases`() {
        assertEquals(ErrorCode.PROMPT_INJECTION, ErrorCode.fromWire("PROMPT_INJECTION_DETECTED"))
        assertEquals(ErrorCode.RATE_LIMITED, ErrorCode.fromWire("RATE_LIMIT_GLOBAL"))
        assertEquals(ErrorCode.RATE_LIMITED, ErrorCode.fromWire("QUOTA_EXCEEDED"))
        assertEquals(ErrorCode.NO_PROVIDERS_AVAILABLE, ErrorCode.fromWire("ALL_PROVIDERS_FAILED"))
        assertEquals(ErrorCode.TIMEOUT, ErrorCode.fromWire("TASK_TIMED_OUT"))
        assertEquals(ErrorCode.INTERNAL, ErrorCode.fromWire("SOMETHING_NEW"))
        assertEquals(ErrorCode.INTERNAL, ErrorCode.fromWire(null))
    }
}
