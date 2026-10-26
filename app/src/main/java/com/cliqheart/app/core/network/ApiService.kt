package com.cliqheart.app.core.network

import retrofit2.Response
import retrofit2.http.GET

data class HealthResponse(
    val status: String? = null,
)

interface ApiService {
    @GET("health")
    suspend fun getHealth(): Response<HealthResponse>
}
