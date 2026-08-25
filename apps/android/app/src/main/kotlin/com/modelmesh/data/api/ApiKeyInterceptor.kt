package com.modelmesh.data.api

import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/**
 * Attaches the `X-API-Key` header the backend's auth middleware requires.
 *
 * The key is injected rather than read from a companion constant so a build
 * variant, an instrumentation test, or a future secure-storage source can
 * supply it without touching this class.
 */
@Singleton
class ApiKeyInterceptor @Inject constructor(
    @Named("apiKey") private val apiKey: String,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request().newBuilder()
            .header(HEADER, apiKey)
            .header("Accept", "application/json")
            .build()
        return chain.proceed(request)
    }

    companion object {
        const val HEADER = "X-API-Key"
    }
}
