package com.cliqheart.app.feature.auth

object AuthValidation {
    private val emailPattern = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")
    private val usernamePattern = Regex("^[A-Za-z0-9._]{3,30}$")

    fun emailError(email: String): String? = when {
        email.isBlank() -> "Email is required."
        !emailPattern.matches(email.trim()) -> "Enter a valid email address."
        else -> null
    }

    fun loginIdentifierError(identifier: String): String? = when {
        identifier.isBlank() -> "Email or username is required."
        identifier.contains('@') -> emailError(identifier)
        else -> usernameError(identifier)
    }

    fun usernameError(username: String): String? = when {
        username.isBlank() -> "Username is required."
        !usernamePattern.matches(username) ->
            "Use 3-30 letters, numbers, periods, or underscores."
        else -> null
    }

    fun loginPasswordError(password: String): String? =
        if (password.isBlank()) "Password is required." else null

    fun registrationPasswordError(password: String): String? = when {
        password.length < 8 -> "Use at least 8 characters."
        password.none(Char::isLetter) || password.none(Char::isDigit) ->
            "Include at least one letter and one number."
        else -> null
    }

    fun confirmationError(password: String, confirmation: String): String? = when {
        confirmation.isBlank() -> "Confirm your password."
        password != confirmation -> "Passwords do not match."
        else -> null
    }
}
