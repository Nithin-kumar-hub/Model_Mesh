package com.modelmesh.util

/**
 * Mirrors the backend's `Result<T, E>` contract (CLAUDE.md §9) so a failure
 * carries a code the UI can act on instead of an opaque exception.
 */
sealed interface AppResult<out T> {
    data class Success<out T>(val data: T) : AppResult<T>

    data class Failure(
        val code: ErrorCode,
        val message: String,
        val cause: Throwable? = null,
    ) : AppResult<Nothing>
}

/** The subset of the backend error taxonomy the app reacts to differently. */
enum class ErrorCode {
    INVALID_INPUT,
    UNSUPPORTED_MODALITY,
    FILE_TOO_LARGE,
    PROMPT_INJECTION,
    TASK_NOT_FOUND,
    UNAUTHORIZED,
    RATE_LIMITED,
    NO_PROVIDERS_AVAILABLE,
    TIMEOUT,
    OFFLINE,
    INTERNAL,
    ;

    companion object {
        /** Backend codes the app does not model individually collapse to INTERNAL. */
        fun fromWire(value: String?): ErrorCode = when (value?.uppercase()) {
            "INVALID_INPUT" -> INVALID_INPUT
            "UNSUPPORTED_MODALITY" -> UNSUPPORTED_MODALITY
            "FILE_TOO_LARGE" -> FILE_TOO_LARGE
            "PROMPT_INJECTION", "PROMPT_INJECTION_DETECTED" -> PROMPT_INJECTION
            "TASK_NOT_FOUND" -> TASK_NOT_FOUND
            "UNAUTHORIZED" -> UNAUTHORIZED
            "RATE_LIMIT_GLOBAL", "QUOTA_EXCEEDED" -> RATE_LIMITED
            "NO_PROVIDERS_AVAILABLE", "ALL_PROVIDERS_FAILED" -> NO_PROVIDERS_AVAILABLE
            "TIMEOUT", "TASK_TIMED_OUT" -> TIMEOUT
            else -> INTERNAL
        }
    }
}

inline fun <T, R> AppResult<T>.map(transform: (T) -> R): AppResult<R> = when (this) {
    is AppResult.Success -> AppResult.Success(transform(data))
    is AppResult.Failure -> this
}

inline fun <T> AppResult<T>.onSuccess(action: (T) -> Unit): AppResult<T> {
    if (this is AppResult.Success) action(data)
    return this
}

inline fun <T> AppResult<T>.onFailure(action: (AppResult.Failure) -> Unit): AppResult<T> {
    if (this is AppResult.Failure) action(this)
    return this
}

fun <T> AppResult<T>.getOrNull(): T? = (this as? AppResult.Success)?.data
