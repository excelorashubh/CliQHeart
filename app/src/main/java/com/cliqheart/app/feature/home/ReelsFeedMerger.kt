package com.cliqheart.app.feature.home

import com.cliqheart.app.core.network.PostResponse

internal data class ReelsFeedItem(
    val contentType: String,
    val response: PostResponse,
)

internal fun mergeReelsAndVideoPosts(
    videoPosts: List<PostResponse>,
    reels: List<PostResponse>,
): List<ReelsFeedItem> {
    val merged = LinkedHashMap<String, ReelsFeedItem>()

    fun add(contentType: String, content: List<PostResponse>) {
        content.forEach { response ->
            val media = response.media ?: return@forEach
            if (media.resourceType != "video") return@forEach
            val url = media.secureUrl?.takeIf {
                it.startsWith("https://", ignoreCase = true)
            } ?: return@forEach
            val key = media.id?.takeIf(String::isNotBlank)?.let { "media:$it" } ?: "url:$url"
            if (key !in merged) merged[key] = ReelsFeedItem(contentType, response)
        }
    }

    add("reel", reels)
    add("post", videoPosts)
    return merged.values.toList()
}
