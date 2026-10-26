package com.cliqheart.app.core.network

import com.google.gson.JsonParseException
import retrofit2.HttpException
import java.io.IOException

class HealthRepository(private val apiService: ApiService) {
    suspend fun check(): HealthCheckResult = try {
        val response = apiService.getHealth()
        val status = response.body()?.status
        if (response.isSuccessful && status != null) {
            HealthCheckResult.Available(status)
        } else {
            HealthCheckResult.Unavailable
        }
    } catch (_: IOException) {
        HealthCheckResult.Unavailable
    } catch (_: HttpException) {
        HealthCheckResult.Unavailable
    } catch (_: JsonParseException) {
        HealthCheckResult.Unavailable
    }
}

sealed interface HealthCheckResult {
    data class Available(val status: String) : HealthCheckResult
    data object Unavailable : HealthCheckResult
}
