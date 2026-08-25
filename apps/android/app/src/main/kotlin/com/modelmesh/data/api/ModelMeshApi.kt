package com.modelmesh.data.api

import com.modelmesh.data.api.dto.AddKeyRequestDto
import com.modelmesh.data.api.dto.FeedbackRequestDto
import com.modelmesh.data.api.dto.FeedbackResponseDto
import com.modelmesh.data.api.dto.ProvidersResponseDto
import com.modelmesh.data.api.dto.SubmitTaskRequestDto
import com.modelmesh.data.api.dto.SubmitTaskResponseDto
import com.modelmesh.data.api.dto.TaskListResponseDto
import com.modelmesh.data.api.dto.TaskResponseDto
import com.modelmesh.data.api.dto.TraceResponseDto
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import kotlinx.serialization.json.JsonObject

/**
 * The ModelMesh REST surface. Paths are relative to the `/api/v1/` base URL;
 * the API key is attached by [ApiKeyInterceptor].
 *
 * Every call returns `Response<T>` so the repository can read the backend's
 * error envelope on a non-2xx instead of catching an HttpException.
 */
interface ModelMeshApi {

    @POST("tasks")
    suspend fun submitTask(@Body body: SubmitTaskRequestDto): Response<SubmitTaskResponseDto>

    @GET("tasks/{taskId}")
    suspend fun getTask(@Path("taskId") taskId: String): Response<TaskResponseDto>

    @GET("tasks/{taskId}/trace")
    suspend fun getTrace(@Path("taskId") taskId: String): Response<TraceResponseDto>

    @GET("tasks")
    suspend fun listTasks(@Query("limit") limit: Int = 20): Response<TaskListResponseDto>

    @POST("tasks/{taskId}/feedback")
    suspend fun submitFeedback(
        @Path("taskId") taskId: String,
        @Body body: FeedbackRequestDto,
    ): Response<FeedbackResponseDto>

    @GET("providers/status")
    suspend fun providerStatus(): Response<ProvidersResponseDto>

    @POST("providers/keys")
    suspend fun addProviderKey(@Body body: AddKeyRequestDto): Response<JsonObject>

    /** Stats are a loose object; the dashboard reads what it recognizes. */
    @GET("telemetry/stats")
    suspend fun telemetryStats(@Query("days") days: Int = 7): Response<JsonObject>

    @GET("telemetry/calibration")
    suspend fun calibration(): Response<JsonObject>
}
