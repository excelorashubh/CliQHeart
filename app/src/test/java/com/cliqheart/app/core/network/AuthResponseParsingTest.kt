package com.cliqheart.app.core.network

import com.google.gson.Gson
import org.junit.Assert.assertEquals
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
    fun registrationResponseParsesNewSessionTokens() {
        val response = Gson().fromJson(
            """{"message":"Registration successful.","accessToken":"access-token","refreshToken":"refresh-token","user":{"id":"user-id","accountStatus":"active"}}""",
            AuthResponse::class.java,
        )

        assertEquals("access-token", response.accessToken)
        assertEquals("refresh-token", response.refreshToken)
        assertEquals("Registration successful.", response.message)
        assertEquals("active", response.user?.accountStatus)
    }

    @Test
    fun professionalAccountFieldsRemainOptionalForExistingAccounts() {
        val personal = Gson().fromJson(
            """{"user":{"id":"personal-id","username":"personal"}}""",
            AuthResponse::class.java,
        )
        val professional = Gson().fromJson(
            """{"user":{"id":"creator-id","username":"creator","accountType":"CREATOR","professionalCategory":"ARTIST"}}""",
            AuthResponse::class.java,
        )

        assertEquals(null, personal.user?.accountType)
        assertEquals("CREATOR", professional.user?.accountType)
        assertEquals("ARTIST", professional.user?.professionalCategory)
    }
}