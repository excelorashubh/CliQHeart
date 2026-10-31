package com.cliqheart.app.feature.home.models

data class ActivityItemModel(
    val id: String,
    val avatarUrl: String,
    val username: String,
    val actionText: String,
    val timeAgo: String,
    val postImageUrl: String? = null,
    val isFollowAction: Boolean = false,
    val actorId: String? = null,
    val isRead: Boolean = false,
)
