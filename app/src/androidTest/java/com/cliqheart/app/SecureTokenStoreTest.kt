package com.cliqheart.app

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.cliqheart.app.core.security.SecureTokenStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SecureTokenStoreTest {
    @Test
    fun tokenRoundTripsEncryptedAndCanBeCleared() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val store = SecureTokenStore(context)
        val preferences = context.getSharedPreferences(
            "cliqheart_secure_tokens",
            Context.MODE_PRIVATE,
        )
        val token = "instrumentation-test-token"

        store.clear()
        store.save(token)

        assertEquals(token, store.read())
        assertFalse(preferences.all.values.contains(token))

        store.clear()
        assertNull(store.read())
    }
}
