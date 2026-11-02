package com.cliqheart.app.feature.home

import com.cliqheart.app.core.network.PostMediaResponse
import com.cliqheart.app.core.network.PostResponse
import org.junit.Assert.assertEquals
import org.junit.Test

class ReelsFeedMergerTest {
    @Test
    fun combinesVideoPostsAndReelsWithoutImagesOrDuplicateMedia() {
        val post = videoContent("post-id", "shared-media", "https://media.example/shared.mp4")
        val duplicateReel = videoContent("reel-id", "shared-media", "https://media.example/shared.mp4")
        val separatePost = videoContent("video-post-id", "post-media", "https://media.example/post.mp4")
        val imagePost = PostResponse(
            id = "image-post",
            media = PostMediaResponse(
                id = "image-media",
                resourceType = "image",
                secureUrl = "https://media.example/image.jpg",
            ),
        )

        val result = mergeReelsAndVideoPosts(
            videoPosts = listOf(post, imagePost, separatePost),
            reels = listOf(duplicateReel),
        )

        assertEquals(listOf("reel:reel-id", "post:video-post-id"), result.map {
            "${it.contentType}:${it.response.id}"
        })
    }

    @Test
    fun fallsBackToVideoUrlWhenMediaIdIsMissing() {
        val post = videoContent("post-id", null, "https://media.example/shared.mp4")
        val reel = videoContent("reel-id", null, "https://media.example/shared.mp4")

        val result = mergeReelsAndVideoPosts(videoPosts = listOf(post), reels = listOf(reel))

        assertEquals(listOf("reel:reel-id"), result.map { "${it.contentType}:${it.response.id}" })
    }

    @Test
    fun excludesVideoMediaWithoutSecureHttpsPlaybackUrl() {
        val result = mergeReelsAndVideoPosts(
            videoPosts = listOf(
                videoContent("http-video", "media-1", "http://media.example/video.mp4"),
                videoContent("missing-url", "media-2", null),
            ),
            reels = emptyList(),
        )

        assertEquals(emptyList<ReelsFeedItem>(), result)
    }

    private fun videoContent(id: String, mediaId: String?, url: String?) = PostResponse(
        id = id,
        media = PostMediaResponse(
            id = mediaId,
            resourceType = "video",
            secureUrl = url,
        ),
    )
}
