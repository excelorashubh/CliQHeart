package com.cliqheart.app.feature.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AuthValidationTest {
    @Test
    fun emailRequiresValidAddress() {
        assertEquals("Email is required.", AuthValidation.emailError(""))
        assertEquals("Enter a valid email address.", AuthValidation.emailError("not-an-email"))
        assertNull(AuthValidation.emailError("person@example.com"))
    }

    @Test
    fun loginAcceptsEmailOrUsernameIdentifier() {
        assertEquals("Email or username is required.", AuthValidation.loginIdentifierError(" "))
        assertEquals("Enter a valid email address.", AuthValidation.loginIdentifierError("bad@"))
        assertNull(AuthValidation.loginIdentifierError("person@example.com"))
        assertNull(AuthValidation.loginIdentifierError("person_1"))
    }

    @Test
    fun usernameMustMeetLengthAndCharacterRules() {
        assertEquals("Username is required.", AuthValidation.usernameError(" "))
        assertEquals(
            "Use 3-30 letters, numbers, periods, or underscores.",
            AuthValidation.usernameError("ab"),
        )
        assertNull(AuthValidation.usernameError("cliq.heart_1"))
    }

    @Test
    fun registrationPasswordAndConfirmationAreValidated() {
        assertEquals(
            "Use at least 8 characters.",
            AuthValidation.registrationPasswordError("short1"),
        )
        assertEquals(
            "Include at least one letter and one number.",
            AuthValidation.registrationPasswordError("allletters"),
        )
        assertNull(AuthValidation.registrationPasswordError("cliqheart1"))
        assertEquals(
            "Passwords do not match.",
            AuthValidation.confirmationError("cliqheart1", "different1"),
        )
        assertNull(AuthValidation.confirmationError("cliqheart1", "cliqheart1"))
    }
}
