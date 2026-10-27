package com.cliqheart.app.feature.home.models

data class PostModel(
    val id: String,
    val authorName: String,
    val authorUsername: String,
    val authorAvatarUrl: String,
    val location: String? = null,
    val imageUrl: String,
    val caption: String,
    var likeCount: Int,
    val commentCount: Int,
    var isLiked: Boolean = false,
    var isBookmarked: Boolean = false,
    val timestamp: String,
)
