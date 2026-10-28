package com.cliqheart.app.feature.home.models

data class StoryModel(
    val id: String,
    val username: String,
    val avatarUrl: String,
    val hasNewStory: Boolean = false,
    val isYourStory: Boolean = false,
)
