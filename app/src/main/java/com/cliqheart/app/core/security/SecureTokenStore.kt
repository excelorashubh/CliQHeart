package com.cliqheart.app.core.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.google.gson.Gson
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class SessionPayload(
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val currentUser: com.cliqheart.app.core.network.UserResponse? = null,
)

class SecureTokenStore(context: Context) {
    private val gson = Gson()
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun saveSession(
        accessToken: String,
        refreshToken: String,
        currentUser: com.cliqheart.app.core.network.UserResponse? = null,
    ) {
        val payload = SessionPayload(
            accessToken = accessToken,
            refreshToken = refreshToken,
            currentUser = currentUser,
        )
        save(gson.toJson(payload))
    }

    fun saveCurrentUser(currentUser: com.cliqheart.app.core.network.UserResponse) {
        val session = readSession() ?: return
        val accessToken = session.accessToken ?: return
        val refreshToken = session.refreshToken ?: return
        saveSession(accessToken, refreshToken, currentUser)
    }

    fun readSession(): SessionPayload? {
        val payloadJson = read() ?: return null
        return runCatching { gson.fromJson(payloadJson, SessionPayload::class.java) }.getOrNull()
    }

    fun save(token: String) {
        require(token.isNotBlank()) { "Token must not be blank." }

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val ciphertext = cipher.doFinal(token.toByteArray(StandardCharsets.UTF_8))
        val saved = preferences.edit()
            .putString(IV_KEY, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(TOKEN_KEY, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .commit()

        check(saved) { "Could not save the encrypted token." }
    }

    fun read(): String? {
        val encodedIv = preferences.getString(IV_KEY, null)
        val encodedToken = preferences.getString(TOKEN_KEY, null)
        if (encodedIv == null && encodedToken == null) {
            return null
        }
        check(encodedIv != null && encodedToken != null) {
            "Encrypted token storage is incomplete."
        }

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            getOrCreateKey(),
            GCMParameterSpec(GCM_TAG_SIZE_BITS, Base64.decode(encodedIv, Base64.NO_WRAP)),
        )
        val token = cipher.doFinal(Base64.decode(encodedToken, Base64.NO_WRAP))
        return String(token, StandardCharsets.UTF_8)
    }

    fun clear() {
        check(preferences.edit().clear().commit()) {
            "Could not clear the encrypted token."
        }
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE)
        keyStore.load(null)
        val existingKey = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
        if (existingKey != null) {
            return existingKey
        }

        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
        keyGenerator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return keyGenerator.generateKey()
    }

    private companion object {
        const val ANDROID_KEY_STORE = "AndroidKeyStore"
        const val GCM_TAG_SIZE_BITS = 128
        const val IV_KEY = "token_iv"
        const val KEY_ALIAS = "cliqheart.auth.token"
        const val PREFERENCES_NAME = "cliqheart_secure_tokens"
        const val TOKEN_KEY = "token_ciphertext"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
