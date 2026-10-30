package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.text.format.DateUtils
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.util.Log
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.ConcatAdapter
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.PostResponse
import com.cliqheart.app.core.network.StoryResponse
import com.cliqheart.app.core.network.UnreadCountResponse
import com.cliqheart.app.core.ui.limitContentWidth
import com.cliqheart.app.databinding.FragmentHomeFeedBinding
import com.cliqheart.app.feature.home.StoryViewerDialogFragment
import com.cliqheart.app.feature.home.adapters.FeedAdapter
import com.cliqheart.app.feature.home.adapters.HomeFeedHeaderAdapter
import com.cliqheart.app.feature.home.apiErrorMessage
import com.cliqheart.app.feature.home.models.PostModel
import com.cliqheart.app.feature.home.models.StoryModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.io.IOException
import java.time.Instant
import java.time.format.DateTimeParseException
import retrofit2.Response

internal const val POST_PUBLISHED_REQUEST_KEY = "cliqheart.post.published"

class HomeFeedFragment : Fragment() {
    private var _binding: FragmentHomeFeedBinding? = null
    private val binding get() = requireNotNull(_binding)
    private var feedAdapter: FeedAdapter? = null
    private var headerAdapter: HomeFeedHeaderAdapter? = null
    private var nextPostCursor: String? = null
    private var nextReelCursor: String? = null
    private var postsExhausted = false
    private var reelsExhausted = false
    private var loadingPosts = false
    private var loadingStories = false
    private val pendingInteractions = mutableSetOf<String>()
    private val viewedStoryIds = mutableSetOf<String>()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentHomeFeedBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        view.limitContentWidth(680)
        setupFeed()

        binding.swipeRefreshLayout.setOnRefreshListener {
            loadPosts(refresh = true)
            loadStories()
            loadUnreadBadges()
        }
        binding.btnHeaderNotifications.setOnClickListener {
            (parentFragment as? com.cliqheart.app.feature.home.MainShellFragment)?.openActivity()
        }

        binding.btnHeaderMessages.setOnClickListener {
            findNavController().navigate(R.id.messagesFragment)
        }

        parentFragmentManager.setFragmentResultListener(
            POST_PUBLISHED_REQUEST_KEY,
            viewLifecycleOwner,
        ) { _, _ ->
            if (!loadingPosts) loadPosts(refresh = true)
        }

        loadPosts(refresh = true)
        loadStories()
        loadUnreadBadges()
    }

    private fun setupFeed() {
        val adapter = FeedAdapter(
            posts = emptyList(),
            onLikeClicked = ::toggleLike,
            onBookmarkClicked = ::toggleBookmark,
            onCommentClicked = {
                Toast.makeText(
                    requireContext(),
                    R.string.comments_unavailable,
                    Toast.LENGTH_SHORT,
                ).show()
            },
            onRepostClicked = ::toggleRepost,
            onFollowClicked = ::followAuthor,
        )
        feedAdapter = adapter
        val header = HomeFeedHeaderAdapter(
            onFeedRetry = {
                if (!loadingPosts) loadPosts(refresh = true)
            },
            onStoryClick = ::openStoryGroup,
            onStoriesRetry = ::loadStories,
        )
        headerAdapter = header
        binding.feedRecyclerView.layoutManager = LinearLayoutManager(requireContext())
        binding.feedRecyclerView.adapter = ConcatAdapter(header, adapter)
        binding.feedRecyclerView.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                feedAdapter?.updateVisibleVideoPlayback()
                if (dy <= 0 || loadingPosts || (postsExhausted && reelsExhausted)) return
                val layoutManager = recyclerView.layoutManager as? LinearLayoutManager ?: return
                if (layoutManager.findLastVisibleItemPosition() >=
                    layoutManager.itemCount - PREFETCH_THRESHOLD
                ) {
                    loadPosts(refresh = false)
                }
            }

        })
    }

    override fun onPause() {
        feedAdapter?.pauseVideos()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        bindingOrNull()?.feedRecyclerView?.post {
            feedAdapter?.updateVisibleVideoPlayback()
        }
    }

    private fun loadPosts(refresh: Boolean) {
        if (loadingPosts || (!refresh && postsExhausted && reelsExhausted)) return
        loadingPosts = true
        if (refresh) {
            nextPostCursor = null
            nextReelCursor = null
            postsExhausted = false
            reelsExhausted = false
        }
        if (refresh && feedAdapter?.postCount == 0) {
            showFeedState(getString(R.string.loading_posts))
        }
        if (refresh) binding.swipeRefreshLayout.isRefreshing = true

        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val postPage = if (postsExhausted) {
                    null
                } else {
                    val response = ApiClient.service.getPosts(PAGE_SIZE, nextPostCursor)
                    if (!response.isSuccessful) {
                        throw IOException(apiErrorMessage(response, getString(R.string.feed_load_failed)))
                    }
                    response.body() ?: throw IOException(getString(R.string.feed_load_failed))
                }
                val reelPage = if (reelsExhausted) {
                    null
                } else {
                    val response = ApiClient.service.getReels(PAGE_SIZE, nextReelCursor)
                    if (!response.isSuccessful) {
                        throw IOException(apiErrorMessage(response, getString(R.string.feed_load_failed)))
                    }
                    response.body() ?: throw IOException(getString(R.string.feed_load_failed))
                }
                postPage?.let {
                    nextPostCursor = it.nextCursor
                    postsExhausted = it.nextCursor.isNullOrBlank()
                }
                reelPage?.let {
                    nextReelCursor = it.nextCursor
                    reelsExhausted = it.nextCursor.isNullOrBlank()
                }
                val posts = buildList {
                    postPage?.posts?.forEach { add("post" to it) }
                    reelPage?.reels?.forEach { add("reel" to it) }
                }
                    .sortedByDescending { (_, response) -> response.createdAt.toEpochMillis() }
                    .mapNotNull { (contentType, response) -> response.toPostModel(contentType) }
                feedAdapter?.submitPosts(posts, append = !refresh)
                if (feedAdapter?.postCount == 0) {
                    showFeedState(getString(R.string.feed_empty))
                } else {
                    hideFeedState()
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                val message = exception.message
                    ?.takeIf(String::isNotBlank)
                    ?: getString(R.string.feed_load_failed)
                if (feedAdapter?.postCount == 0) {
                    showFeedState(message)
                } else {
                    Log.w(TAG, "Could not load the next Home feed page.", exception)
                    Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show()
                }
            } finally {
                loadingPosts = false
                _binding?.swipeRefreshLayout?.isRefreshing = false
            }
        }
    }

    private fun toggleLike(post: PostModel) {
        if (!pendingInteractions.add("like:${post.contentKey}")) return
        val liked = !post.isLiked
        val updated = post.copy(
            isLiked = liked,
            likeCount = (post.likeCount + if (liked) 1 else -1).coerceAtLeast(0),
        )
        feedAdapter?.updatePost(updated)
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = if (liked) {
                    ApiClient.service.likeContent(post.contentType + "s", post.id)
                } else {
                    ApiClient.service.unlikeContent(post.contentType + "s", post.id)
                }
                if (!response.isSuccessful) {
                    throw IOException(apiErrorMessage(response, getString(R.string.profile_action_failed)))
                }
                val result = response.body()
                    ?: throw IOException(getString(R.string.profile_action_failed))
                feedAdapter?.updatePost(
                    updated.copy(
                        isLiked = result.liked ?: liked,
                        likeCount = result.likeCount ?: updated.likeCount,
                    ),
                )
            } catch (exception: CancellationException) {
                feedAdapter?.updatePost(post)
                throw exception
            } catch (exception: Exception) {
                feedAdapter?.updatePost(post)
                Toast.makeText(
                    requireContext(),
                    exception.message ?: getString(R.string.profile_action_failed),
                    Toast.LENGTH_LONG,
                ).show()
            } finally {
                pendingInteractions.remove("like:${post.contentKey}")
            }
        }
    }

    private fun toggleBookmark(post: PostModel) {
        if (!pendingInteractions.add("bookmark:${post.contentKey}")) return
        val saved = !post.isBookmarked
        val updated = post.copy(isBookmarked = saved)
        feedAdapter?.updatePost(updated)
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = if (saved) {
                    ApiClient.service.saveContent(post.contentType + "s", post.id)
                } else {
                    ApiClient.service.unsaveContent(post.contentType + "s", post.id)
                }
                if (!response.isSuccessful) {
                    throw IOException(apiErrorMessage(response, getString(R.string.profile_action_failed)))
                }
                val result = response.body()
                    ?: throw IOException(getString(R.string.profile_action_failed))
                feedAdapter?.updatePost(updated.copy(isBookmarked = result.saved ?: saved))
            } catch (exception: CancellationException) {
                feedAdapter?.updatePost(post)
                throw exception
            } catch (exception: Exception) {
                feedAdapter?.updatePost(post)
                Toast.makeText(
                    requireContext(),
                    exception.message ?: getString(R.string.profile_action_failed),
                    Toast.LENGTH_LONG,
                ).show()
            } finally {
                pendingInteractions.remove("bookmark:${post.contentKey}")
            }
        }
    }

    private fun toggleRepost(post: PostModel) {
        if (!pendingInteractions.add("repost:${post.contentKey}")) return
        val reposted = !post.isReposted
        val updated = post.copy(
            isReposted = reposted,
            repostCount = (post.repostCount + if (reposted) 1 else -1).coerceAtLeast(0),
        )
        feedAdapter?.updatePost(updated)
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = if (reposted) {
                    ApiClient.service.repostContent(post.contentType + "s", post.id)
                } else {
                    ApiClient.service.undoRepostContent(post.contentType + "s", post.id)
                }
                if (!response.isSuccessful) {
                    throw IOException(apiErrorMessage(response, getString(R.string.profile_action_failed)))
                }
                val result = response.body()
                    ?: throw IOException(getString(R.string.profile_action_failed))
                feedAdapter?.updatePost(
                    updated.copy(
                        isReposted = result.reposted ?: reposted,
                        repostCount = result.repostCount ?: updated.repostCount,
                    ),
                )
            } catch (exception: CancellationException) {
                feedAdapter?.updatePost(post)
                throw exception
            } catch (exception: Exception) {
                feedAdapter?.updatePost(post)
                Toast.makeText(
                    requireContext(),
                    exception.message ?: getString(R.string.profile_action_failed),
                    Toast.LENGTH_LONG,
                ).show()
            } finally {
                pendingInteractions.remove("repost:${post.contentKey}")
            }
        }
    }

    private fun followAuthor(post: PostModel) {
        if (post.authorId.isBlank() || !pendingInteractions.add("follow:${post.authorId}")) return
        val updated = post.copy(isFollowing = true)
        feedAdapter?.updatePost(updated)
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.followUser(post.authorId)
                if (!response.isSuccessful) {
                    throw IOException(apiErrorMessage(response, getString(R.string.profile_action_failed)))
                }
                feedAdapter?.updatePost(updated.copy(isFollowing = response.body()?.following ?: true))
            } catch (exception: CancellationException) {
                feedAdapter?.updatePost(post)
                throw exception
            } catch (exception: Exception) {
                feedAdapter?.updatePost(post)
                Toast.makeText(
                    requireContext(),
                    exception.message ?: getString(R.string.profile_action_failed),
                    Toast.LENGTH_LONG,
                ).show()
            } finally {
                pendingInteractions.remove("follow:${post.authorId}")
            }
        }
    }

    private fun loadStories() {
        if (loadingStories) return
        loadingStories = true
        headerAdapter?.setStoriesState(getString(R.string.loading_stories))
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val profileResponse = ApiClient.service.getMyProfile()
                if (!profileResponse.isSuccessful) {
                    throw IOException(apiErrorMessage(profileResponse, getString(R.string.stories_load_failed)))
                }
                val profile = profileResponse.body()?.user
                    ?: throw IOException(getString(R.string.stories_load_failed))
                val storiesResponse = ApiClient.service.getStories()
                if (!storiesResponse.isSuccessful) {
                    throw IOException(apiErrorMessage(storiesResponse, getString(R.string.stories_load_failed)))
                }
                val stories = storiesResponse.body()?.stories
                    ?: throw IOException(getString(R.string.stories_load_failed))
                headerAdapter?.setStories(stories.toStoryModels(profile.id ?: profile._id, profile.username, profile.avatarUrl))
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                Log.w(TAG, "Could not load Home stories.", exception)
                headerAdapter?.setStories(
                    emptyList(),
                    exception.message ?: getString(R.string.stories_load_failed),
                )
                Toast.makeText(
                    requireContext(),
                    exception.message ?: getString(R.string.stories_load_failed),
                    Toast.LENGTH_LONG,
                ).show()
            } finally {
                loadingStories = false
            }
        }
    }

    private fun List<StoryResponse>.toStoryModels(
        currentUserId: String?,
        currentUsername: String?,
        currentAvatarUrl: String?,
    ): List<StoryModel> {
        val groupedStories = filter { !it.id.isNullOrBlank() && !it.owner?.id.isNullOrBlank() }
            .groupBy { it.owner?.id.orEmpty() }
        val ownGroup = groupedStories.entries.firstOrNull { (ownerId, items) ->
            ownerId == currentUserId ||
                items.firstOrNull()?.owner?.username.equals(currentUsername, ignoreCase = true)
        }
        val ownStories = ownGroup?.value.orEmpty()
        val ownerId = currentUserId ?: ownGroup?.key ?: YOUR_STORY_OWNER_ID
        val yourStory = StoryModel(
            ownerId = ownerId,
            username = getString(R.string.your_story),
            avatarUrl = currentAvatarUrl.orEmpty(),
            storyIds = ownStories.mapNotNull { it.id },
            hasNewStory = ownStories.mapNotNull { it.id }.any { it !in viewedStoryIds },
            isYourStory = true,
        )
        val others = groupedStories
            .filter { (groupOwnerId, items) ->
                groupOwnerId != ownGroup?.key &&
                    !items.firstOrNull()?.owner?.username.equals(currentUsername, ignoreCase = true)
            }
            .values
            .mapNotNull { items ->
                val owner = items.firstOrNull()?.owner ?: return@mapNotNull null
                val storyIds = items.mapNotNull { it.id }
                StoryModel(
                    ownerId = owner.id.orEmpty(),
                    username = owner.username.orEmpty(),
                    avatarUrl = owner.avatarUrl.orEmpty(),
                    storyIds = storyIds,
                    hasNewStory = storyIds.any { it !in viewedStoryIds },
                )
            }
        return listOf(yourStory) + others
    }

    private fun openStoryGroup(story: StoryModel) {
        if (story.storyIds.isEmpty()) {
            Toast.makeText(
                requireContext(),
                R.string.story_creation_unavailable,
                Toast.LENGTH_SHORT,
            ).show()
            return
        }
        viewedStoryIds.addAll(story.storyIds)
        headerAdapter?.markStoryViewed(story.ownerId)
        StoryViewerDialogFragment.newInstance(story.storyIds, story.username)
            .show(parentFragmentManager, STORY_VIEWER_TAG)
    }

    private fun loadUnreadBadges() {
        loadUnreadBadge(binding.notificationsBadge, binding.btnHeaderNotifications, "notifications") {
            ApiClient.service.getUnreadNotificationCount()
        }
        loadUnreadBadge(binding.messagesBadge, binding.btnHeaderMessages, "messages") {
            ApiClient.service.getUnreadMessageCount()
        }
    }

    private fun loadUnreadBadge(
        badge: TextView,
        actionButton: View,
        label: String,
        request: suspend () -> Response<UnreadCountResponse>,
    ) {
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = request()
                if (!response.isSuccessful) {
                    throw IOException(apiErrorMessage(response, getString(R.string.unread_count_failed)))
                }
                val count = response.body()?.unreadCount
                    ?: throw IOException(getString(R.string.unread_count_failed))
                if (_binding == null) return@launch
                if (count > 0) {
                    badge.text = if (count > MAX_BADGE_COUNT) "$MAX_BADGE_COUNT+" else count.toString()
                    badge.visibility = View.VISIBLE
                    actionButton.contentDescription =
                        getString(R.string.unread_action_label, label, count)
                } else {
                    badge.visibility = View.GONE
                    actionButton.contentDescription = label
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                Log.w(TAG, "Could not load $label unread count.", exception)
            }
        }
    }

    private fun showFeedState(message: String) {
        headerAdapter?.setFeedState(message)
    }

    private fun hideFeedState() {
        headerAdapter?.setFeedState(null)
    }

    override fun onDestroyView() {
        feedAdapter?.releaseVideos()
        feedAdapter = null
        headerAdapter = null
        _binding = null
        super.onDestroyView()
    }

    private fun bindingOrNull() = _binding

    private fun PostResponse.toPostModel(contentType: String): PostModel? {
        val postId = id?.takeIf(String::isNotBlank) ?: return null
        val author = owner ?: return null
        val media = media ?: return null
        val authorId = author.id?.takeIf(String::isNotBlank) ?: return null
        val username = author.username?.takeIf(String::isNotBlank) ?: return null
        val mediaUrl = media.thumbnailUrl?.takeIf(String::isNotBlank)
            ?: media.secureUrl?.takeIf(String::isNotBlank).orEmpty()
        return PostModel(
            id = postId,
            contentType = contentType,
            authorId = authorId,
            authorName = author.displayName?.takeIf(String::isNotBlank) ?: username,
            authorUsername = username,
            authorAvatarUrl = author.avatarUrl.orEmpty(),
            location = location,
            imageUrl = mediaUrl,
            videoUrl = media.secureUrl?.takeIf { media.resourceType == "video" },
            mediaWidth = media.width,
            mediaHeight = media.height,
            isFollowing = isFollowing == true,
            caption = caption.orEmpty(),
            likeCount = likeCount ?: 0,
            commentCount = commentCount ?: 0,
            repostCount = repostCount ?: 0,
            isLiked = isLiked == true,
            isBookmarked = isSaved == true,
            isReposted = isReposted == true,
            timestamp = createdAt.toRelativeTime(),
        )
    }

    private fun String?.toEpochMillis(): Long {
        if (isNullOrBlank()) return 0L
        return try {
            Instant.parse(this).toEpochMilli()
        } catch (_: DateTimeParseException) {
            0L
        }
    }

    private fun String?.toRelativeTime(): String {
        if (isNullOrBlank()) return ""
        val timestamp = try {
            Instant.parse(this).toEpochMilli()
        } catch (_: DateTimeParseException) {
            return this
        }
        return DateUtils.getRelativeTimeSpanString(
            timestamp,
            System.currentTimeMillis(),
            DateUtils.MINUTE_IN_MILLIS,
        ).toString()
    }

    private companion object {
        const val TAG = "HomeFeed"
        const val PAGE_SIZE = 30
        const val PREFETCH_THRESHOLD = 5
        const val MAX_BADGE_COUNT = 99
        const val YOUR_STORY_OWNER_ID = "your-story"
        const val STORY_VIEWER_TAG = "home-story-viewer"
    }
}
