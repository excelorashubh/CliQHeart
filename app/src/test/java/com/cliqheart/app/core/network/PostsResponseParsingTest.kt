package com.cliqheart.app.core.network

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PostsResponseParsingTest {
    @Test
    fun parsesBackendPostPageAndEngagementState() {
        val response = Gson().fromJson(
            """
                {
                  "posts": [{
                    "id": "post-id",
                    "caption": "A real post",
                    "createdAt": "2026-10-30T08:00:00.000Z",
                    "location": "London",
                    "owner": {
                      "id": "owner-id",
                      "username": "creator",
                      "displayName": "Creator",
                      "avatarUrl": "https://images.example/avatar.jpg"
                    },
                    "media": {
                      "resourceType": "image",
                      "secureUrl": "https://images.example/post.jpg"
                    },
                    "likeCount": 4,
                    "commentCount": 2,
                    "isLiked": true,
                    "isSaved": false
                  }],
                  "nextCursor": "next-post-id"
                }
            """.trimIndent(),
            PostsResponse::class.java,
        )

        val post = response.posts.single()
        assertEquals("post-id", post.id)
        assertEquals("creator", post.owner?.username)
        assertEquals("https://images.example/post.jpg", post.media?.secureUrl)
        assertEquals(4, post.likeCount)
        assertEquals(2, post.commentCount)
        assertTrue(post.isLiked == true)
        assertFalse(post.isSaved == true)
        assertEquals("next-post-id", response.nextCursor)
    }

    @Test
    fun parsesReelPagesAndStoryMedia() {
        val reels = Gson().fromJson(
            """
                {
                  "reels": [{
                    "id": "reel-id",
                    "owner": { "id": "owner-id", "username": "creator" },
                    "media": {
                      "resourceType": "video",
                      "secureUrl": "https://media.example/reel.mp4",
                      "thumbnailUrl": "https://media.example/reel.jpg",
                      "width": 1080,
                      "height": 1920
                    },
                    "likeCount": 8,
                    "repostCount": 2,
                    "isReposted": true,
                    "isFollowing": false
                  }],
                  "nextCursor": null
                }
            """.trimIndent(),
            ReelsResponse::class.java,
        )
        val story = Gson().fromJson(
            """
                {
                  "story": {
                    "id": "story-id",
                    "caption": "A story",
                    "owner": { "username": "creator" },
                    "media": {
                      "resourceType": "image",
                      "secureUrl": "https://media.example/story.jpg"
                    }
                  }
                }
            """.trimIndent(),
            StoryEnvelope::class.java,
        )

        assertEquals("reel-id", reels.reels.single().id)
        assertEquals(1920, reels.reels.single().media?.height)
        assertEquals(2, reels.reels.single().repostCount)
        assertTrue(reels.reels.single().isReposted == true)
        assertEquals("story-id", story.story?.id)
        assertEquals("https://media.example/story.jpg", story.story?.media?.secureUrl)
    }

    @Test
    fun parsesMixedExploreItemsAndHashtagSuggestions() {
        val explore = Gson().fromJson(
            """
                {
                  "items": [
                    {
                      "id": "reel-id",
                      "contentType": "reel",
                      "owner": { "id": "creator-id", "username": "creator" },
                      "media": {
                        "resourceType": "video",
                        "secureUrl": "https://media.example/reel.mp4",
                        "thumbnailUrl": "https://media.example/reel.jpg",
                        "duration": 12.5
                      }
                    },
                    {
                      "id": "post-id",
                      "contentType": "post",
                      "media": {
                        "resourceType": "image",
                        "secureUrl": "https://media.example/post.jpg"
                      }
                    }
                  ],
                  "nextCursor": "1780308000000_0123456789abcdef01234567"
                }
            """.trimIndent(),
            DiscoveryResponse::class.java,
        )
        val hashtags = Gson().fromJson(
            """
                {
                  "hashtags": [{
                    "name": "travel",
                    "normalizedName": "travel",
                    "usageCount": 17
                  }]
                }
            """.trimIndent(),
            HashtagsResponse::class.java,
        )

        assertEquals(listOf("reel", "post"), explore.items.map { it.contentType })
        assertEquals("https://media.example/reel.jpg", explore.items.first().media?.thumbnailUrl)
        assertEquals(12.5, explore.items.first().media?.duration)
        assertEquals("1780308000000_0123456789abcdef01234567", explore.nextCursor)
        assertEquals("travel", hashtags.hashtags.single().normalizedName)
        assertEquals(17, hashtags.hashtags.single().usageCount)
    }

    @Test
    fun parsesPeopleSearchUserProfileAndFollowState() {
        val response = Gson().fromJson(
            """
                {
                  "users": [{
                    "id": "user-id",
                    "username": "ragxshubh",
                    "displayName": "Ragx Shubh",
                    "avatarUrl": "https://images.example/profile.jpg",
                    "isFollowing": true
                  }],
                  "nextCursor": null
                }
            """.trimIndent(),
            UsersResponse::class.java,
        )

        val user = response.users.single()
        assertEquals("user-id", user.id)
        assertEquals("ragxshubh", user.username)
        assertEquals("Ragx Shubh", user.displayName)
        assertEquals("https://images.example/profile.jpg", user.avatarUrl)
        assertTrue(user.isFollowing == true)
    }
}
