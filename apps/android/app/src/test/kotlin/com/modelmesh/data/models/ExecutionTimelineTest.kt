package com.modelmesh.data.models

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The execution screen renders whatever this fold produces, so the fold is what has
 * to be right: stages must not report DONE early, a retrying subtask must not flash
 * red, and a failed or skipped subtask must never disappear from the list.
 */
class ExecutionTimelineTest {

    private fun event(
        name: TraceEventName,
        offsetMs: Long,
        payload: Map<String, Any?> = emptyMap(),
    ) = TraceEvent(name = name, taskId = TASK_ID, offsetMs = offsetMs, payload = payload)

    private fun timelineOf(vararg events: TraceEvent) =
        ExecutionTimeline(TASK_ID).withEvents(events.toList())

    @Test
    fun `a stage is running once started and done once finished`() {
        val running = timelineOf(event(TraceEventName.CLASSIFYING, 10))
        assertEquals(
            StageState.RUNNING,
            running.stages.single { it.stage == PipelineStage.UNDERSTAND }.state,
        )

        val done = running.withEvent(
            event(TraceEventName.CLASSIFIED, 240, mapOf("taskType" to "code_review", "confidence" to 0.82)),
        )
        val stage = done.stages.single { it.stage == PipelineStage.UNDERSTAND }
        assertEquals(StageState.DONE, stage.state)
        assertEquals(230L, stage.durationMs)
    }

    @Test
    fun `stages not yet reached stay pending`() {
        val timeline = timelineOf(event(TraceEventName.CLASSIFYING, 10))

        assertEquals(
            StageState.PENDING,
            timeline.stages.single { it.stage == PipelineStage.VERIFY }.state,
        )
    }

    @Test
    fun `subtask events fold into one row per subtask`() {
        val timeline = timelineOf(
            event(
                TraceEventName.SUBTASK_STARTED,
                100,
                mapOf("subtaskId" to "bug_analysis", "role" to "coder", "provider" to "groq", "model" to "llama-3.1-70b"),
            ),
            event(
                TraceEventName.SUBTASK_DONE,
                980,
                mapOf(
                    "subtaskId" to "bug_analysis",
                    "role" to "coder",
                    "tokens" to 7_912,
                    "ms" to 880,
                    "confidence" to 0.86,
                    "failovers" to 1,
                    "fromCache" to false,
                ),
            ),
            event(
                TraceEventName.SUBTASK_STARTED,
                100,
                mapOf("subtaskId" to "security_review", "role" to "security_analyzer"),
            ),
        )

        val subtasks = timeline.subtasks
        assertEquals(2, subtasks.size)

        val bug = subtasks.single { it.id == "bug_analysis" }
        assertEquals(AgentRole.CODER, bug.role)
        assertEquals(SubtaskStatus.COMPLETED, bug.status)
        assertEquals("groq", bug.provider)
        assertEquals(7_912, bug.tokens)
        assertEquals(880, bug.latencyMs)
        assertEquals(0.86, bug.confidence!!, 1e-9)
        assertEquals(1, bug.failovers)
        assertEquals(100L, bug.startedAtMs)
        assertEquals(980L, bug.finishedAtMs)

        assertEquals(SubtaskStatus.RUNNING, subtasks.single { it.id == "security_review" }.status)
    }

    @Test
    fun `a subtask that is still retrying stays running`() {
        val timeline = timelineOf(
            event(TraceEventName.SUBTASK_STARTED, 100, mapOf("subtaskId" to "s1", "role" to "researcher")),
            event(
                TraceEventName.SUBTASK_FAILED,
                400,
                mapOf("subtaskId" to "s1", "error" to "RATE_LIMIT", "retrying" to true),
            ),
        )

        val subtask = timeline.subtasks.single()
        assertEquals(SubtaskStatus.RUNNING, subtask.status)
        assertEquals(1, subtask.failovers)
        assertNull(subtask.finishedAtMs)
    }

    @Test
    fun `a subtask that gave up is reported as failed and never dropped`() {
        val timeline = timelineOf(
            event(TraceEventName.SUBTASK_STARTED, 100, mapOf("subtaskId" to "s1", "role" to "researcher")),
            event(
                TraceEventName.SUBTASK_FAILED,
                900,
                mapOf("subtaskId" to "s1", "error" to "ALL_PROVIDERS_FAILED", "retrying" to false),
            ),
            event(
                TraceEventName.SUBTASK_SKIPPED,
                901,
                mapOf("subtaskId" to "s2", "reason" to "dependency failed"),
            ),
        )

        assertEquals(SubtaskStatus.FAILED, timeline.subtasks.single { it.id == "s1" }.status)
        val skipped = timeline.subtasks.single { it.id == "s2" }
        assertEquals(SubtaskStatus.SKIPPED, skipped.status)
        assertEquals("dependency failed", skipped.skipReason)
    }

    @Test
    fun `a replayed event is not counted twice`() {
        val replayed = event(TraceEventName.PLANNING, 500, mapOf("planCount" to 3))

        val timeline = timelineOf(replayed).withEvent(replayed).withEvents(listOf(replayed))

        assertEquals(1, timeline.events.size)
    }

    @Test
    fun `plan preview and context savings come from their own events`() {
        val timeline = timelineOf(
            event(
                TraceEventName.DECOMPOSED,
                600,
                mapOf(
                    "subtaskCount" to 5,
                    "masterContextTokens" to 12_088,
                    "slicedContextTokens" to 26_000,
                    "naiveContextTokens" to 42_000,
                    "contextReductionPercent" to 38,
                ),
            ),
            event(
                TraceEventName.PLAN_SELECTED,
                700,
                mapOf(
                    "strategy" to "balanced",
                    "requestedStrategy" to "premium",
                    "downgraded" to true,
                    "estimatedTokens" to 24_800,
                    "estimatedLatencyMs" to 5_400,
                    "reliabilityScore" to 0.94,
                    "parallelGroups" to listOf(listOf("a", "b"), listOf("c")),
                    "reasoning" to "Budget forced a step down from premium.",
                ),
            ),
        )

        val savings = timeline.contextSavings
        assertNotNull(savings)
        assertEquals(12_088, savings!!.masterContextTokens)
        assertEquals(42_000, savings.naiveContextTokens)
        assertEquals(38, savings.reductionPercent)

        val plan = timeline.plan
        assertNotNull(plan)
        assertEquals(ExecutionStrategy.BALANCED, plan!!.strategy)
        assertEquals(ExecutionStrategy.PREMIUM, plan.requestedStrategy)
        assertTrue(plan.downgraded)
        assertEquals(listOf(listOf("a", "b"), listOf("c")), plan.parallelGroups)
    }

    @Test
    fun `outcome reports partial runs and the subtasks that failed`() {
        val timeline = timelineOf(
            event(
                TraceEventName.COMPLETED,
                9_400,
                mapOf(
                    "totalTokens" to 7_912,
                    "savedTokens" to 46_974,
                    "savingsPercent" to 49.29,
                    "ms" to 9_400,
                    "confidence" to 0.71,
                    "partial" to true,
                    "failedSubtasks" to listOf("security_review", "performance_review"),
                    "replans" to 1,
                    "cacheHits" to 2,
                    "failovers" to 3,
                ),
            ),
        )

        val outcome = timeline.outcome
        assertNotNull(outcome)
        assertTrue(outcome!!.partial)
        assertEquals(listOf("security_review", "performance_review"), outcome.failedSubtasks)
        assertEquals(1, outcome.replans)
        assertEquals(49.29, outcome.savingsPercent, 1e-9)
        assertTrue(timeline.isFinished)
        assertFalse(timeline.failed)
    }

    @Test
    fun `a failed run is finished and flagged failed`() {
        val timeline = timelineOf(event(TraceEventName.FAILED, 1_200, mapOf("error" to "NO_PROVIDERS_AVAILABLE")))

        assertTrue(timeline.isFinished)
        assertTrue(timeline.failed)
        assertNull(timeline.outcome)
        assertEquals(1_200L, timeline.elapsedMs)
    }

    private companion object {
        const val TASK_ID = "task_01HXYZ"
    }
}
