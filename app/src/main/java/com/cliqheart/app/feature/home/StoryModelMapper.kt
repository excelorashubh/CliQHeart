package com.cliqheart.app.feature.home

import com.cliqheart.app.core.network.StoryResponse
import com.cliqheart.app.feature.home.models.StoryModel
import java.time.Instant
import java.time.format.DateTimeParseException

internal fun List<StoryResponse>.toStoryModels(
    currentUserId: String?,
    currentUsername: String?,
    currentAvatarUrl: String?,
    yourStoryLabel: String,
    nowMillis: Long = System.currentTimeMillis(),
): List<StoryModel> {
    val activeStories = asSequence()
        .filter { story ->
            val expiry = story.expiresAt.toEpochMillis()
            !story.id.isNullOrBlank() &&
                !(story.owner?.id ?: story.owner?._id).isNullOrBlank() &&
                expiry > nowMillis
        }
        .distinctBy { it.id?.lowercase() }
        .toList()
    val groupedStories = activeStories
        .groupBy {
            (it.owner?.id?.takeIf(String::isNotBlank) ?: it.owner?._id)
                .orEmpty()
                .lowercase()
        }
    val normalizedCurrentUserId = currentUserId.orEmpty().lowercase()
    val ownGroup = groupedStories.entries.firstOrNull { (ownerId, items) ->
        ownerId == normalizedCurrentUserId ||
            (!currentUsername.isNullOrBlank() &&
                items.firstOrNull()?.owner?.username.equals(currentUsername, ignoreCase = true))
    }
    val ownStories = ownGroup?.value.orEmpty()
    val yourStory = StoryModel(
        ownerId = currentUserId?.takeIf(String::isNotBlank)
            ?: ownGroup?.key
            ?: "your-story",
        username = yourStoryLabel,
        avatarUrl = currentAvatarUrl.orEmpty(),
        storyIds = ownStories.mapNotNull { it.id },
        hasNewStory = ownStories.any { it.isViewed != true },
        isYourStory = true,
    )
    val others = groupedStories
        .filter { (ownerId, items) ->
            ownerId != ownGroup?.key &&
                (currentUsername.isNullOrBlank() ||
                    !items.firstOrNull()?.owner?.username.equals(currentUsername, ignoreCase = true))
        }
        .values
        .mapNotNull { items ->
            val owner = items.firstOrNull()?.owner ?: return@mapNotNull null
            StoryModel(
                ownerId = owner.id?.takeIf(String::isNotBlank) ?: owner._id.orEmpty(),
                username = owner.username.orEmpty(),
                avatarUrl = owner.avatarUrl.orEmpty(),
                storyIds = items.mapNotNull { it.id },
                hasNewStory = items.any { it.isViewed != true },
            )
        }
    return listOf(yourStory) + others.distinctBy { it.ownerId.lowercase() }
}

private fun String?.toEpochMillis(): Long {
    if (isNullOrBlank()) return 0L
    return try {
        Instant.parse(this).toEpochMilli()
    } catch (_: DateTimeParseException) {
        0L
    }
}
