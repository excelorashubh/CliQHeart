package com.cliqheart.app.feature.home

import com.cliqheart.app.core.network.PostOwnerResponse
import com.cliqheart.app.core.network.StoryResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class StoryModelMapperTest {
    private val now = Instant.parse("2026-10-31T00:00:00Z").toEpochMilli()
    private val expiry = Instant.parse("2026-10-31T01:00:00Z").toString()

    @Test
    fun `always puts one own story tile before other owners`() {
        val stories = listOf(
            StoryResponse(
                id = "own-1",
                expiresAt = expiry,
                owner = PostOwnerResponse(id = "me", username = "viewer", avatarUrl = "own.png"),
                isViewed = true,
            ),
            StoryResponse(
                id = "other-1",
                expiresAt = expiry,
                owner = PostOwnerResponse(id = "friend", username = "friend"),
                isViewed = false,
            ),
            StoryResponse(
                id = "own-2",
                expiresAt = expiry,
                owner = PostOwnerResponse(id = "me", username = "viewer"),
                isViewed = false,
            ),
        )

        val result = stories.toStoryModels("me", "viewer", "cached.png", "Your story", now)

        assertEquals(2, result.size)
        assertTrue(result.first().isYourStory)
        assertEquals(listOf("own-1", "own-2"), result.first().storyIds)
        assertEquals("cached.png", result.first().avatarUrl)
        assertTrue(result.first().hasNewStory)
        assertEquals("friend", result.last().ownerId)
        assertFalse(result.last().isYourStory)
    }

    @Test
    fun `empty and expired responses retain exactly one own tile`() {
        val expiredStories = listOf(
            StoryResponse(
                id = "expired",
                expiresAt = Instant.parse("2026-10-30T23:59:59Z").toString(),
                owner = PostOwnerResponse(id = "friend", username = "friend"),
            ),
            StoryResponse(
                id = "invalid-expiry",
                expiresAt = "invalid",
                owner = PostOwnerResponse(id = "friend", username = "friend"),
            ),
        )

        val emptyResult = emptyList<StoryResponse>()
            .toStoryModels("me", "viewer", null, "Your story", now)
        val expiredResult = expiredStories
            .toStoryModels("me", "viewer", null, "Your story", now)

        assertEquals(1, emptyResult.size)
        assertEquals(1, expiredResult.size)
        assertTrue(emptyResult.single().isYourStory)
        assertTrue(expiredResult.single().isYourStory)
    }
}
