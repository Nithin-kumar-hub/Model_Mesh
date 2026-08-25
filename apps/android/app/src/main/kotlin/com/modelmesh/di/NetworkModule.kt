package com.modelmesh.di

import com.modelmesh.BuildConfig
import com.modelmesh.data.api.ApiKeyInterceptor
import com.modelmesh.data.api.ModelMeshApi
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit
import javax.inject.Named
import javax.inject.Singleton

/**
 * Networking. Endpoint and key come from `BuildConfig` — which reads gradle
 * properties, overridable in `local.properties` — so no secret is ever written in
 * Kotlin and a demo device can be pointed at a laptop without editing source.
 */
@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    @Named("apiKey")
    fun apiKey(): String = BuildConfig.API_KEY

    @Provides
    @Singleton
    @Named("apiBaseUrl")
    fun apiBaseUrl(): String = BuildConfig.API_BASE_URL

    @Provides
    @Singleton
    @Named("wsBaseUrl")
    fun wsBaseUrl(): String = BuildConfig.WS_BASE_URL

    /**
     * `explicitNulls = false` is not a style choice: the backend's Zod schema is
     * `.strict()` at every level and rejects an explicit `null` for an optional
     * field, so `{"budget": null}` is a 400. Omitting the key is the contract.
     *
     * `ignoreUnknownKeys = true` keeps the app alive when the backend adds a field.
     */
    @Provides
    @Singleton
    fun json(): Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        isLenient = true
    }

    @Provides
    @Singleton
    fun okHttpClient(apiKeyInterceptor: ApiKeyInterceptor): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(apiKeyInterceptor)
        .addInterceptor(loggingInterceptor())
        .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        // A base64 image is megabytes on a slow uplink.
        .writeTimeout(WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .build()

    @Provides
    @Singleton
    fun retrofit(
        @Named("apiBaseUrl") baseUrl: String,
        client: OkHttpClient,
        json: Json,
    ): Retrofit = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(client)
        .addConverterFactory(json.asConverterFactory(JSON_MEDIA_TYPE.toMediaType()))
        .build()

    @Provides
    @Singleton
    fun modelMeshApi(retrofit: Retrofit): ModelMeshApi = retrofit.create(ModelMeshApi::class.java)

    /**
     * `BASIC` even in debug: `BODY` would dump every base64 attachment into logcat,
     * and the API key is redacted because a shared secret in a log is a leaked one.
     */
    private fun loggingInterceptor(): HttpLoggingInterceptor =
        HttpLoggingInterceptor()
            .apply { level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE }
            .also { it.redactHeader(ApiKeyInterceptor.HEADER) }

    private const val JSON_MEDIA_TYPE = "application/json"
    private const val CONNECT_TIMEOUT_SECONDS = 20L
    private const val READ_TIMEOUT_SECONDS = 60L
    private const val WRITE_TIMEOUT_SECONDS = 60L
}
