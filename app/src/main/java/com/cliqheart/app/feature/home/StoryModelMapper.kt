package com.cliqheart.app.feature.home

import com.cliqheart.app.core.network.StoryResponse
import com.cliqheart.app.feature.home.models.StoryModel
import java.time.Instant
import java.time.OffsetDateTime

internal fun List<StoryResponse>.toStoryModels(
    currentUserId: String?,
    currentUsername: String?,
    currentAvatarUrl: String?,
    yourStoryLabel: String,
    nowMillis: Long = System.currentTimeMillis(),
): List<StoryModel> {
    val activeStories = asSequence()
        .filter { story ->
            val ownerId = story.owner?.id?.takeIf(String::isNotBlank)
                ?: story.owner?._id?.takeIf(String::isNotBlank)
            val expiry = story.expiresAt.toEpochMillis()
            !story.id.isNullOrBlank() &&
                !ownerId.isNullOrBlank() &&
                (story.expiresAt.isNullOrBlank() || expiry > nowMillis)
        }
        .distinctBy { it.id?.lowercase() }
        .toList()

    val groupedStories = activeStories
        .groupBy {
            val ownerId = it.owner?.id?.takeIf(String::isNotBlank)
                ?: it.owner?._id
                ?: ""
            ownerId.lowercase()
        }

    val normalizedCurrentUserId = currentUserId.orEmpty().trim().lowercase()
    val normalizedCurrentUsername = currentUsername.orEmpty().trim().lowercase()

    val ownGroup = groupedStories.entries.firstOrNull { (ownerId, items) ->
        (normalizedCurrentUserId.isNotBlank() && ownerId == normalizedCurrentUserId) ||
            (normalizedCurrentUsername.isNotBlank() &&
                items.firstOrNull()?.owner?.username?.trim()?.equals(normalizedCurrentUsername, ignoreCase = true) == true)
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
                (normalizedCurrentUsername.isBlank() ||
                    !items.firstOrNull()?.owner?.username?.trim().equals(normalizedCurrentUsername, ignoreCase = true))
        }
        .values
        .mapNotNull { items ->
            val owner = items.firstOrNull()?.owner ?: return@mapNotNull null
            val ownerId = owner.id?.takeIf(String::isNotBlank)
                ?: owner._id?.takeIf(String::isNotBlank)
                ?: return@mapNotNull null
            val username = owner.username?.takeIf(String::isNotBlank) ?: ownerId
            val avatarUrl = owner.avatarUrl.orEmpty()
            StoryModel(
                ownerId = ownerId,
                username = username,
                avatarUrl = avatarUrl,
                storyIds = items.mapNotNull { it.id },
                hasNewStory = items.any { it.isViewed != true },
            )
        }

    return listOf(yourStory) + others.distinctBy { it.ownerId.lowercase() }
}

private fun String?.toEpochMillis(): Long {
    if (isNullOrBlank()) return Long.MAX_VALUE
    return runCatching {
        Instant.parse(this).toEpochMilli()
    }.getOrElse {
        runCatching {
            OffsetDateTime.parse(this).toInstant().toEpochMilli()
        }.getOrElse {
            0L
        }
    }
}
