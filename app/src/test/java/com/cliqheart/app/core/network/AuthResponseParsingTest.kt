package com.cliqheart.app.core.network

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AuthResponseParsingTest {
    @Test
    fun parsesBackendLoginTokenAndUserContract() {
        val response = Gson().fromJson(
            """{"accessToken":"access-token","refreshToken":"refresh-token","user":{"id":"user-id","username":"trial","accountStatus":"active"}}""",
            AuthResponse::class.java,
        )

        assertEquals("access-token", response.accessToken)
        assertEquals("refresh-token", response.refreshToken)
        assertEquals("user-id", response.user?.id)
        assertEquals("trial", response.user?.username)
        assertEquals("active", response.user?.accountStatus)
    }

    @Test
    fun registrationResponseDoesNotInventSessionTokens() {
        val response = Gson().fromJson(
            """{"message":"Registration successful.","user":{"id":"user-id","accountStatus":"active"}}""",
            AuthResponse::class.java,
        )

        assertNull(response.accessToken)
        assertNull(response.refreshToken)
        assertEquals("Registration successful.", response.message)
        assertEquals("active", response.user?.accountStatus)
    }
}