package com.cliqheart.app.feature.home

import org.json.JSONException
import org.json.JSONObject
import retrofit2.Response

fun apiErrorMessage(response: Response<*>, fallback: String): String {
    if (response.code() == 401) return "Your session expired. Please sign in again."
    val body = response.errorBody()?.string() ?: return fallback
    return try {
        JSONObject(body).optString("error").takeIf { it.isNotBlank() } ?: fallback
    } catch (_: JSONException) {
        fallback
    }
}
