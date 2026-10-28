package com.cliqheart.app.core.network

import android.content.Context
import com.cliqheart.app.core.security.SecureTokenStore
import com.cliqheart.app.BuildConfig
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {
    @Volatile
    private var tokenStore: SecureTokenStore? = null

    fun initialize(context: Context) {
        tokenStore = SecureTokenStore(context.applicationContext)
    }

    private val retrofit: Retrofit by lazy {
        val apiBaseUrl = BuildConfig.API_BASE_URL.ifBlank { "https://cliqheart.onrender.com/api/v1/" }
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
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .callTimeout(30, TimeUnit.SECONDS)
            .build()

        Retrofit.Builder()
            .baseUrl(apiBaseUrl)
            .client(httpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    val service: ApiService by lazy { retrofit.create(ApiService::class.java) }
}
