package com.modelmesh.data.local

import com.modelmesh.data.models.AgentRole
import com.modelmesh.data.models.ExecutionStrategy
import com.modelmesh.data.models.PlanSummary
import com.modelmesh.data.models.ProviderUsageView
import com.modelmesh.data.models.SubtaskStatus
import com.modelmesh.data.models.SubtaskView
import com.modelmesh.data.models.TelemetryView
import com.modelmesh.data.models.VerificationView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The `Stored*` mirrors in [Converters] are field-for-field copies of frozen domain
 * types that no compiler can check against them. These round-trips are that check:
 * if a domain type gains a field and the mirror does not, the equality assertion
 * fails here rather than silently dropping data on a user's device.
 */
class ConvertersTest {

    private val converters = Converters()

    @Test
    fun `telemetry survives a round trip`() {
        val telemetry = TelemetryView(
            totalMs = 12_345L,
            estimatedTokens = 8_400,
            actualTokens = 7_912,
            savedTokens = 46_974,
            savingsPercent = 57.56,
            failovers = 2,
            cacheHits = 1,
            providerBreakdown = listOf(
                ProviderUsageView(
                    provider = "groq",
                    model = "llama-3.1-8b-instant",
                    subtask = "bug_analysis",
                    inputTokens = 6_754,
                    outputTokens = 1_158,
                    latencyMs = 890,
                ),
                ProviderUsageView(
                    provider = "gemini",
                    model = "gemini-1.5-flash",
                    subtask = null,
                    inputTokens = 1_074,
                    outputTokens = 420,
                    latencyMs = 1_260,
                ),
            ),
        )

        val encoded = converters.fromTelemetry(telemetry)
        assertNotNull(encoded)
        assertEquals(telemetry, converters.toTelemetry(encoded))
    }

    @Test
    fun `plan survives a round trip including parallel groups`() {
        val plan = PlanSummary(
            id = "plan_01HXY",
            strategy = ExecutionStrategy.PREMIUM,
            subtaskCount = 6,
            parallelGroups = listOf(
                listOf("bug_analysis", "security_review", "performance_review"),
                listOf("synthesis"),
                listOf("critique"),
            ),
            estimatedTokens = 24_800,
            estimatedLatencyMs = 5_400,
            estimatedCost = 0.0123,
            reliabilityScore = 0.94,
            reasoning = "Premium: widest batch of 3, full context, always verified.",
        )

        val decoded = converters.toPlan(converters.fromPlan(plan))
        assertEquals(plan, decoded)
        assertEquals(3, decoded?.widestBatch)
    }

    @Test
    fun `subtasks survive a round trip including failed rows`() {
        val subtasks = listOf(
            SubtaskView(
                id = "bug_analysis",
                role = AgentRole.CODER,
                status = SubtaskStatus.COMPLETED,
                provider = "groq",
                model = "llama-3.1-70b-versatile",
                dependencies = emptyList(),
                confidence = 0.86,
                tokens = 7_912,
                latencyMs = 890,
                failovers = 1,
                fromCache = true,
                errorCode = null,
            ),
            SubtaskView(
                id = "security_review",
                role = AgentRole.SECURITY_ANALYZER,
                status = SubtaskStatus.FAILED,
                provider = null,
                model = null,
                dependencies = listOf("bug_analysis"),
                confidence = null,
                tokens = 0,
                latencyMs = null,
                failovers = 3,
                fromCache = false,
                errorCode = "ALL_PROVIDERS_FAILED",
            ),
            SubtaskView(
                id = "synthesis",
                role = AgentRole.SYNTHESIZER,
                status = SubtaskStatus.SKIPPED,
                provider = null,
                model = null,
                dependencies = listOf("bug_analysis", "security_review"),
                confidence = null,
                tokens = 0,
                latencyMs = null,
                failovers = 0,
                fromCache = false,
                errorCode = null,
            ),
        )

        assertEquals(subtasks, converters.toSubtasks(converters.fromSubtasks(subtasks)))
    }

    @Test
    fun `verification survives a round trip`() {
        val verification = VerificationView(
            verified = false,
            confidence = 0.55,
            issues = listOf("MISSING_AGENT_CONTRIBUTION", "SUSPICIOUSLY_SHORT"),
            verifiedBy = "critic",
        )

        assertEquals(verification, converters.toVerification(converters.fromVerification(verification)))
    }

    @Test
    fun `nulls stay null in both directions`() {
        assertNull(converters.fromTelemetry(null))
        assertNull(converters.fromPlan(null))
        assertNull(converters.fromSubtasks(null))
        assertNull(converters.fromVerification(null))

        assertNull(converters.toTelemetry(null))
        assertNull(converters.toPlan(null))
        assertNull(converters.toSubtasks(null))
        assertNull(converters.toVerification(null))
    }

    @Test
    fun `an empty telemetry view round trips to the same value`() {
        assertEquals(
            TelemetryView.EMPTY,
            converters.toTelemetry(converters.fromTelemetry(TelemetryView.EMPTY)),
        )
    }

    @Test
    fun `an unreadable row degrades to null instead of throwing`() {
        // A cache is allowed to lose a row; it is not allowed to crash a screen.
        assertNull(converters.toTelemetry("{not json"))
        assertNull(converters.toPlan("[]"))
        assertNull(converters.toSubtasks("{\"nope\":1}"))
        assertNull(converters.toVerification("null-ish"))
    }
}
