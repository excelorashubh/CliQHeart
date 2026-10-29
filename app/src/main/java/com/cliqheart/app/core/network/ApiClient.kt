package com.cliqheart.app.core.network

import android.content.Context
import com.cliqheart.app.BuildConfig
import com.cliqheart.app.core.security.SecureTokenStore
import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {
    @Volatile
    private var tokenStore: SecureTokenStore? = null
    private val refreshLock = Any()
    private val gson = Gson()

    fun initialize(context: Context) {
        tokenStore = SecureTokenStore(context.applicationContext)
    }

    private val apiBaseUrl: String
        get() = BuildConfig.API_BASE_URL.ifBlank { "https://cliqheart.onrender.com/api/v1/" }

    private val refreshClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .callTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    private val retrofit: Retrofit by lazy {
        require(apiBaseUrl.endsWith("/")) {
            "API_BASE_URL must end in '/' for Retrofit."
        }

        val httpClient = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val request = chain.request()
                val token = tokenStore?.readSession()?.accessToken
                val authenticatedRequest = if (token.isNullOrBlank()) {
                    request
                } else {
                    request.newBuilder()
                        .header("Authorization", "Bearer $token")
                        .build()
                }
                chain.proceed(authenticatedRequest)
            }
            .authenticator { _, response -> refreshAfterUnauthorized(response) }
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .callTimeout(30, TimeUnit.SECONDS)
            .build()

        Retrofit.Builder()
            .baseUrl(apiBaseUrl)
            .client(httpClient)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
    }

    val service: ApiService by lazy { retrofit.create(ApiService::class.java) }

    private fun refreshAfterUnauthorized(response: okhttp3.Response): Request? {
        val failedRequest = response.request
        val path = failedRequest.url.encodedPath
        if (path.endsWith("/auth/login") || path.endsWith("/auth/register") ||
            path.endsWith("/auth/refresh") || path.endsWith("/auth/logout")
        ) {
            return null
        }
        val rejectedToken = failedRequest.header("Authorization")
            ?.removePrefix("Bearer ")
            ?.takeIf(String::isNotBlank)
            ?: return null

        synchronized(refreshLock) {
            val store = tokenStore ?: return null
            val current = store.readSession() ?: return null
            val currentAccessToken = current.accessToken ?: return null
            if (currentAccessToken != rejectedToken) {
                return failedRequest.newBuilder()
                    .header("Authorization", "Bearer $currentAccessToken")
                    .build()
            }
            val currentRefreshToken = current.refreshToken ?: return null

            val requestBody = gson.toJson(RefreshRequest(currentRefreshToken))
                .toRequestBody("application/json".toMediaType())
            val refreshRequest = Request.Builder()
                .url("${apiBaseUrl}auth/refresh")
                .post(requestBody)
                .header("Accept", "application/json")
                .build()
            val refreshResponse = try {
                refreshClient.newCall(refreshRequest).execute()
            } catch (_: java.io.IOException) {
                return null
            }
            refreshResponse.use { result ->
                if (!result.isSuccessful) {
                    if (result.code == 401 || result.code == 403) store.clear()
                    return null
                }
                val body = result.body?.string() ?: return null
                val refreshed = runCatching { gson.fromJson(body, AuthResponse::class.java) }
                    .getOrNull()
                    ?: return null
                val nextAccessToken = refreshed.accessToken
                val nextRefreshToken = refreshed.refreshToken
                if (nextAccessToken.isNullOrBlank() || nextRefreshToken.isNullOrBlank()) {
                    store.clear()
                    return null
                }
                store.saveSession(nextAccessToken, nextRefreshToken, refreshed.user ?: current.currentUser)
                return failedRequest.newBuilder()
                    .header("Authorization", "Bearer $nextAccessToken")
                    .build()
            }
        }
    }
}
