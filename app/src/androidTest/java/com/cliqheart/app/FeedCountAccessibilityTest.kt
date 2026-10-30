package com.cliqheart.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FeedCountAccessibilityTest {
    @Test
    fun countDescriptionsAcceptCompactStringValues() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext

        assertEquals("1.2K likes", context.getString(R.string.likes_count, "1.2K"))
        assertEquals("1.2K comments", context.getString(R.string.comments_count, "1.2K"))
        assertEquals("1.2K reposts", context.getString(R.string.reposts_count, "1.2K"))
    }
}
