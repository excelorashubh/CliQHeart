package com.cliqheart.app.feature.home.models

data class PostModel(
    val id: String,
    val contentType: String = "post",
    val authorId: String,
    val authorName: String,
    val authorUsername: String,
    val authorAvatarUrl: String,
    val location: String? = null,
    val imageUrl: String,
    val videoUrl: String? = null,
    val videoFormat: String? = null,
    val mediaWidth: Int? = null,
    val mediaHeight: Int? = null,
    val isFollowing: Boolean = false,
    val caption: String,
    val likeCount: Int,
    val commentCount: Int,
    val repostCount: Int = 0,
    val isLiked: Boolean = false,
    val isBookmarked: Boolean = false,
    val isReposted: Boolean = false,
    val timestamp: String,
    val createdAtMillis: Long = 0,
) {
    val contentKey: String get() = "$contentType:$id"
}
