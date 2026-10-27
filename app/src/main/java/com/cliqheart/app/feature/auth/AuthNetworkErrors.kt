package com.cliqheart.app.feature.auth

import android.content.Context
import com.cliqheart.app.R
import com.google.gson.Gson
import com.google.gson.JsonParseException
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

object AuthNetworkErrors {
    data class Failure(
        val message: String,
        val retryable: Boolean,
    )

    fun fromException(context: Context, exception: Throwable): Failure {
        val causes = generateSequence(exception) { it.cause }
        return when {
            causes.any { it is JsonParseException } -> Failure(
                context.getString(R.string.auth_malformed_response),
                retryable = true,
            )
            causes.any { it is SocketTimeoutException } -> Failure(
                context.getString(R.string.auth_connection_timeout),
                retryable = true,
            )
            causes.any { it is ConnectException } -> Failure(
                context.getString(R.string.auth_connection_refused),
                retryable = true,
            )
            causes.any { it is UnknownHostException } -> Failure(
                context.getString(R.string.auth_host_unresolved),
                retryable = false,
            )
            causes.any { it is IOException } -> Failure(
                context.getString(R.string.auth_network_error),
                retryable = true,
            )
            else -> Failure(
                context.getString(R.string.auth_unexpected_error),
                retryable = false,
            )
        }
    }

    fun fromHttpResponse(
        context: Context,
        statusCode: Int,
        responseBody: String?,
        isLogin: Boolean,
    ): Failure {
        if (isLogin && statusCode == 401) {
            return Failure(context.getString(R.string.auth_invalid_credentials), retryable = false)
        }
        if (isLogin && statusCode == 403) {
            val message = responseBody?.let(::parseErrorMessage)
                ?: context.getString(R.string.auth_account_inactive)
            return Failure(message, retryable = false)
        }
        if (statusCode >= 500) {
            return Failure(
                context.getString(R.string.auth_server_error, statusCode),
                retryable = true,
            )
        }

        val message = responseBody?.let(::parseErrorMessage)
            ?: context.getString(R.string.auth_http_error, statusCode)
        return Failure(message, retryable = statusCode == 408 || statusCode == 429)
    }

    private fun parseErrorMessage(responseBody: String): String? = runCatching {
        val body = Gson().fromJson(responseBody, Map::class.java)
        val fieldError = (body["details"] as? List<*>)
            ?.firstNotNullOfOrNull { detail ->
                val issue = detail as? Map<*, *> ?: return@firstNotNullOfOrNull null
                val field = issue["field"] as? String
                val message = issue["message"] as? String
                if (field == null || message == null) null else "$field: $message"
            }
        fieldError ?: (body["error"] as? String) ?: (body["message"] as? String)
    }.getOrNull()
}