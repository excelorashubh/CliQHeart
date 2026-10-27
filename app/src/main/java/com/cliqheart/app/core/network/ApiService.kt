package com.cliqheart.app.core.network

import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Body

data class HealthResponse(
    val status: String? = null,
)

data class LoginRequest(
    val identifier: String,
    val password: String,
)

data class RegisterRequest(
    val displayName: String,
    val username: String,
    val email: String,
    val password: String,
    val confirmPassword: String,
    val agreeToTerms: Boolean = true,
)

data class UserResponse(
    val id: String? = null,
    val _id: String? = null,
    val username: String? = null,
    val email: String? = null,
    val displayName: String? = null,
    val accountStatus: String? = null,
)

data class AuthResponse(
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val message: String? = null,
    val user: UserResponse? = null,
)

interface ApiService {
    @GET("health")
    suspend fun getHealth(): Response<HealthResponse>

    @POST("auth/register")
    suspend fun register(@Body request: RegisterRequest): Response<AuthResponse>

    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): Response<AuthResponse>
}
