package com.cliqheart.app.feature.home.models

data class StoryModel(
    val ownerId: String,
    val username: String,
    val avatarUrl: String,
    val storyIds: List<String>,
    val hasNewStory: Boolean = false,
    val isYourStory: Boolean = false,
)
