package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.text.format.DateUtils
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.util.Log
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.ConcatAdapter
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.PagerSnapHelper
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.BuildConfig
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.EngagementContentRequest
import com.cliqheart.app.core.network.EngagementSyncRequest
import com.cliqheart.app.core.network.PostResponse
import com.cliqheart.app.core.network.UnreadCountResponse
import com.cliqheart.app.core.network.UserResponse
import com.cliqheart.app.core.security.SecureTokenStore
import com.cliqheart.app.core.ui.limitContentWidth
import com.cliqheart.app.databinding.FragmentHomeFeedBinding
import com.cliqheart.app.feature.home.MainShellViewModel
import com.cliqheart.app.feature.home.StoryViewerDialogFragment
import com.cliqheart.app.feature.home.getEffectiveAvatarUrl
import com.cliqheart.app.feature.home.toStoryModels
import com.cliqheart.app.feature.home.adapters.FeedAdapter
import com.cliqheart.app.feature.home.adapters.HomeFeedHeaderAdapter
import com.cliqheart.app.feature.home.apiErrorMessage
import com.cliqheart.app.feature.home.models.PostModel
import com.cliqheart.app.feature.home.models.StoryModel
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.IOException
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.LinkedHashSet
import retrofit2.Response

internal const val POST_PUBLISHED_REQUEST_KEY = "cliqheart.post.published"
internal const val STORY_PUBLISHED_REQUEST_KEY = "cliqheart.story.published"
internal const val COMMENT_COUNT_RESULT_KEY = "cliqheart.comment.count.updated"
internal const val ARG_COMMENT_CONTENT_ID = "content_id"
internal const val ARG_COMMENT_CONTENT_TYPE = "content_type"
internal const val ARG_COMMENT_COUNT = "comment_count"
internal const val STORY_VIEWED_RESULT_KEY = "cliqheart.story.viewed"

class HomeFeedFragment : Fragment() {
    private val isReelsMode: Boolean
        get() = arguments?.getBoolean(ARG_REELS_MODE) == true
    private var _binding: FragmentHomeFeedBinding? = null
    private val binding get() = requireNotNull(_binding)
    private var feedAdapter: FeedAdapter? = null
    private var headerAdapter: HomeFeedHeaderAdapter? = null
    private var nextPostCursor: String? = null
    private var nextReelCursor: String? = null
    private var postsExhausted = false
    private var reelsExhausted = false
    private var loadingPosts = false
    private val pendingInteractions = mutableSetOf<String>()
    private var storyItems: List<StoryModel> = emptyList()
    private val homeDataViewModel: MainShellViewModel by activityViewModels()
    private var realtimeSocket: Socket? = null
    private var refreshingSocketAuth = false
    private var notificationBadgeRevision = 0L
    private var messageBadgeRevision = 0L
    private val processedEngagementEventIds = LinkedHashSet<String>()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentHomeFeedBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        if (isReelsMode) {
            binding.root.setBackgroundColor(android.graphics.Color.BLACK)
            binding.swipeRefreshLayout.isEnabled = false
            binding.feedRecyclerView.setBackgroundColor(android.graphics.Color.BLACK)
            binding.homeHeader.visibility = View.GONE
            binding.feedRecyclerView.setPadding(0, 0, 0, 0)
            binding.reelsState.visibility = View.VISIBLE
            binding.reelsState.text = getString(R.string.loading_reels)
            binding.reelsState.setOnClickListener {
                if (!loadingPosts) loadPosts(refresh = true)
            }
        } else {
            view.limitContentWidth(680)
            binding.reelsState.visibility = View.GONE
        }
        setupFeed()

        binding.swipeRefreshLayout.setOnRefreshListener {
            loadPosts(refresh = true)
            if (!isReelsMode) {
                loadUnreadBadges()
                homeDataViewModel.refreshStories()
            }
        }
        binding.btnHeaderCreate.setOnClickListener {
            (parentFragment as? com.cliqheart.app.feature.home.MainShellFragment)?.openCreate()
        }
        binding.btnHeaderNotifications.setOnClickListener {
            (parentFragment as? com.cliqheart.app.feature.home.MainShellFragment)?.openActivity()
        }

        parentFragmentManager.setFragmentResultListener(
            POST_PUBLISHED_REQUEST_KEY,
            viewLifecycleOwner,
        ) { _, _ ->
            if (!loadingPosts) loadPosts(refresh = true)
        }
        parentFragmentManager.setFragmentResultListener(
            STORY_PUBLISHED_REQUEST_KEY,
            viewLifecycleOwner,
        ) { _, _ -> homeDataViewModel.refreshStories() }
        parentFragmentManager.setFragmentResultListener(
            STORY_VIEWED_RESULT_KEY,
            viewLifecycleOwner,
        ) { _, _ -> homeDataViewModel.refreshStories() }
        parentFragmentManager.setFragmentResultListener(
            COMMENT_COUNT_RESULT_KEY,
            viewLifecycleOwner,
        ) { _, result ->
            val id = result.getString(ARG_COMMENT_CONTENT_ID) ?: return@setFragmentResultListener
            val type = result.getString(ARG_COMMENT_CONTENT_TYPE) ?: return@setFragmentResultListener
            val count = result.getInt(ARG_COMMENT_COUNT, -1)
            if (count >= 0) feedAdapter?.updateCommentCount(type, id, count)
        }

        observeHomeData()
        loadPosts(refresh = true)
    }

    private fun setupFeed() {
        val adapter = FeedAdapter(
            posts = emptyList(),
            onLikeClicked = ::toggleLike,
            onBookmarkClicked = ::toggleBookmark,
            onCommentClicked = { post ->
                CommentsBottomSheetFragment.newInstance(post.id, post.contentType)
                    .show(parentFragmentManager, COMMENTS_SHEET_TAG)
            },
            onRepostClicked = ::toggleRepost,
            onFollowClicked = ::followAuthor,
            reelsMode = isReelsMode,
        )
        feedAdapter = adapter
        if (isReelsMode) {
            headerAdapter = null
            binding.feedRecyclerView.layoutManager = LinearLayoutManager(requireContext())
            binding.feedRecyclerView.adapter = adapter
            PagerSnapHelper().attachToRecyclerView(binding.feedRecyclerView)
        } else {
            val header = HomeFeedHeaderAdapter(
                onFeedRetry = {
                    if (!loadingPosts) loadPosts(refresh = true)
                },
                onStoryClick = ::openStoryGroup,
                onStoriesRetry = homeDataViewModel::refreshStories,
            )
            headerAdapter = header
            if (storyItems.isEmpty()) {
                storyItems = listOf(createYourStoryModel(homeDataViewModel.currentUser.value))
            }
            header.setStories(
                storyItems,
                stateMessage = getString(R.string.loading_stories),
                loading = true,
            )
            binding.feedRecyclerView.layoutManager = LinearLayoutManager(requireContext())
            binding.feedRecyclerView.adapter = ConcatAdapter(header, adapter)
        }
        binding.feedRecyclerView.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                feedAdapter?.updateVisibleVideoPlayback()
                if (dy <= 0 || loadingPosts || isFeedExhausted()) return
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
        disconnectRealtime()
        feedAdapter?.pauseVideos()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        loadUnreadBadges()
        connectRealtime()
        bindingOrNull()?.feedRecyclerView?.post {
            feedAdapter?.updateVisibleVideoPlayback()
        }
    }

    fun onTabSelected() {
        loadUnreadBadges()
        connectRealtime()
        bindingOrNull()?.feedRecyclerView?.post {
            feedAdapter?.updateVisibleVideoPlayback()
        }
    }

    fun pauseFeedPlayback() {
        feedAdapter?.pauseVideos()
    }

    fun refreshUnreadCounts() {
        if (_binding != null) loadUnreadBadges()
    }

    private fun loadPosts(refresh: Boolean) {
        if (loadingPosts || (!refresh && isFeedExhausted())) return
        loadingPosts = true
        if (refresh) {
            nextPostCursor = null
            nextReelCursor = null
            postsExhausted = false
            reelsExhausted = false
        }
        if (refresh && feedAdapter?.postCount == 0) {
            showFeedState(
                getString(if (isReelsMode) R.string.loading_reels else R.string.loading_posts),
            )
        }
        if (refresh) binding.swipeRefreshLayout.isRefreshing = true

        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val postPage = if (isReelsMode || postsExhausted) {
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
                    showFeedState(
                        getString(if (isReelsMode) R.string.reels_empty else R.string.feed_empty),
                    )
                } else {
                    hideFeedState()
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                val message = if (isReelsMode) {
                    getString(R.string.reels_load_failed)
                } else {
                    exception.message
                        ?.takeIf(String::isNotBlank)
                        ?: getString(R.string.feed_load_failed)
                }
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

    private fun observeHomeData() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                combine(
                    homeDataViewModel.currentUser,
                    homeDataViewModel.stories,
                ) { user, state -> user to state }
                    .collect { (user, state) ->
                        storyItems = state.stories.toStoryModels(
                            currentUserId = user?.id?.takeIf(String::isNotBlank) ?: user?._id,
                            currentUsername = user?.username,
                            currentAvatarUrl = user.getEffectiveAvatarUrl(),
                            yourStoryLabel = getString(R.string.your_story),
                        )
                        if (state.lastSuccessAt > 0) {
                            val mappedStoryCount = storyItems.sumOf { it.storyIds.size }
                            Log.i(
                                TAG,
                                "Stories mapped: responseCount=${state.stories.size}, " +
                                    "mappedRecordCount=$mappedStoryCount, " +
                                    "otherOwnerCount=${storyItems.count { !it.isYourStory }}.",
                            )
                        }
                        headerAdapter?.setStories(
                            storyItems,
                            state.errorMessage,
                            state.isLoading,
                        )
                    }
            }
        }
    }

    private fun createYourStoryModel(user: UserResponse?): StoryModel {
        val ownerId = user?.id?.takeIf(String::isNotBlank)
            ?: user?._id?.takeIf(String::isNotBlank)
            ?: YOUR_STORY_OWNER_ID
        return StoryModel(
            ownerId = ownerId,
            username = getString(R.string.your_story),
            avatarUrl = user.getEffectiveAvatarUrl(),
            storyIds = emptyList(),
            isYourStory = true,
        )
    }

    private fun openStoryGroup(story: StoryModel) {
        if (story.storyIds.isEmpty()) {
            if (story.isYourStory) {
                StoryCreationDialogFragment().show(parentFragmentManager, STORY_CREATION_TAG)
            }
            return
        }
        StoryViewerDialogFragment.newInstance(story.storyIds, story.username)
            .show(parentFragmentManager, STORY_VIEWER_TAG)
    }

    private fun connectRealtime() {
        if (_binding == null || realtimeSocket != null) return
        val accessToken = SecureTokenStore(requireContext()).readSession()?.accessToken
            ?.takeIf(String::isNotBlank)
            ?: return
        val endpoint = android.net.Uri.parse(BuildConfig.API_BASE_URL)
            .buildUpon()
            .path("/")
            .clearQuery()
            .fragment(null)
            .build()
            .toString()
        val options = IO.Options().apply {
            auth = mapOf("token" to accessToken)
            reconnection = true
            reconnectionAttempts = Int.MAX_VALUE
            reconnectionDelay = SOCKET_RECONNECT_DELAY_MS
            reconnectionDelayMax = SOCKET_RECONNECT_MAX_DELAY_MS
            transports = arrayOf(WebSocket.NAME)
        }
        try {
            val socket = IO.socket(endpoint, options)
            realtimeSocket = socket
            socket.on(Socket.EVENT_CONNECT) {
                runOnMainThread {
                    if (realtimeSocket === socket) {
                        synchronizeEngagement()
                        loadUnreadBadges()
                        homeDataViewModel.synchronizeAfterReconnect()
                        (parentFragment as? com.cliqheart.app.feature.home.MainShellFragment)
                            ?.retryProfileAvatarIfNeeded()
                    }
                }
            }
            socket.on("unread:update") { arguments ->
                val payload = arguments.firstOrNull() as? JSONObject ?: return@on
                val count = payload.nonNegativeCount("count") ?: return@on
                runOnMainThread {
                    if (realtimeSocket === socket) {
                        (parentFragment as? com.cliqheart.app.feature.home.MainShellFragment)
                            ?.updateMessagesUnreadCount(count)
                        messageBadgeRevision += 1
                    }
                }
            }
            socket.on("notification:unread") { arguments ->
                val payload = arguments.firstOrNull() as? JSONObject ?: return@on
                val count = payload.nonNegativeCount("count") ?: return@on
                runOnMainThread {
                    if (realtimeSocket === socket) {
                        notificationBadgeRevision += 1
                        updateNotificationUnreadCount(count)
                    }
                }
            }
            socket.on("content:engagement") { arguments ->
                val payload = arguments.firstOrNull() as? JSONObject ?: return@on
                runOnMainThread {
                    if (realtimeSocket === socket) applyEngagementEvent(payload)
                }
            }
            socket.on(Socket.EVENT_CONNECT_ERROR) { arguments ->
                val message = arguments.firstOrNull()?.toString().orEmpty()
                if (message.contains("authentication required", ignoreCase = true) ||
                    message.contains("expired", ignoreCase = true)
                ) {
                    runOnMainThread { refreshRealtimeAuthentication(socket) }
                } else {
                    Log.w(TAG, "Home real-time connection failed: $message")
                }
            }
            socket.connect()
        } catch (exception: Exception) {
            realtimeSocket = null
            Log.w(TAG, "Could not start Home real-time connection.", exception)
        }
    }

    private fun refreshRealtimeAuthentication(socket: Socket) {
        if (refreshingSocketAuth || realtimeSocket !== socket) return
        refreshingSocketAuth = true
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.getMyProfile()
                if (!response.isSuccessful || response.body()?.user == null) {
                    throw IOException(apiErrorMessage(response, getString(R.string.profile_action_failed)))
                }
                disconnectRealtime()
                connectRealtime()
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                Log.w(TAG, "Could not refresh Home real-time authentication.", exception)
                disconnectRealtime()
            } finally {
                refreshingSocketAuth = false
            }
        }
    }

    private fun synchronizeEngagement() {
        val content = feedAdapter?.postsSnapshot().orEmpty()
            .map { EngagementContentRequest(it.id, it.contentType) }
            .distinctBy { "${it.contentType}:${it.contentId}" }
        if (content.isEmpty()) return
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.syncEngagement(EngagementSyncRequest(content))
                if (!response.isSuccessful) {
                    throw IOException(apiErrorMessage(response, getString(R.string.feed_load_failed)))
                }
                response.body()?.content?.forEach { item ->
                    feedAdapter?.updateEngagement(
                        contentType = item.contentType,
                        contentId = item.contentId,
                        likeCount = item.likeCount,
                        commentCount = item.commentCount,
                        repostCount = item.repostCount,
                        isLiked = item.isLiked,
                        isReposted = item.isReposted,
                    )
                } ?: throw IOException(getString(R.string.feed_load_failed))
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                Log.w(TAG, "Could not resynchronize Home engagement counts.", exception)
            }
        }
    }

    private fun applyEngagementEvent(payload: JSONObject) {
        val eventId = payload.optString("eventId").takeIf(String::isNotBlank) ?: return
        if (eventId in processedEngagementEventIds) return
        val contentId = payload.optString("contentId").takeIf(String::isNotBlank) ?: return
        val contentType = payload.optString("contentType")
            .takeIf { it == "post" || it == "reel" } ?: return
        val likeCount = payload.nonNegativeCount("likeCount") ?: return
        val commentCount = payload.nonNegativeCount("commentCount") ?: return
        val repostCount = payload.nonNegativeCount("repostCount") ?: return
        val action = payload.optString("action")
        val actorId = payload.optString("actorId")
        val viewerId = SecureTokenStore(requireContext()).readSession()?.currentUser.let { user ->
            user?.id?.takeIf(String::isNotBlank) ?: user?._id
        }
        val isLiked = when {
            actorId != viewerId -> null
            action == "like.created" -> true
            action == "like.deleted" -> false
            else -> null
        }
        val isReposted = when {
            actorId != viewerId -> null
            action == "repost.created" -> true
            action == "repost.deleted" -> false
            else -> null
        }
        processedEngagementEventIds.add(eventId)
        if (processedEngagementEventIds.size > MAX_PROCESSED_ENGAGEMENT_EVENTS) {
            processedEngagementEventIds.remove(processedEngagementEventIds.first())
        }
        feedAdapter?.updateEngagement(
            contentType = contentType,
            contentId = contentId,
            likeCount = likeCount,
            commentCount = commentCount,
            repostCount = repostCount,
            isLiked = isLiked,
            isReposted = isReposted,
        )
    }

    private fun JSONObject.nonNegativeCount(name: String): Int? {
        if (!has(name) || isNull(name)) return null
        val value = optLong(name, -1)
        return value.takeIf { it in 0..Int.MAX_VALUE }?.toInt()
    }

    private fun runOnMainThread(action: () -> Unit) {
        activity?.runOnUiThread {
            if (_binding != null) action()
        }
    }

    private fun disconnectRealtime() {
        val socket = realtimeSocket ?: return
        realtimeSocket = null
        socket.off()
        socket.disconnect()
        socket.close()
    }

    private fun loadUnreadBadges() {
        val notificationRequestRevision = ++notificationBadgeRevision
        loadUnreadBadge(
            getString(R.string.notifications),
            notificationRequestRevision,
            { notificationBadgeRevision },
            ApiClient.service::getUnreadNotificationCount,
        ) {
            updateNotificationUnreadCount(it)
        }
        val messageRequestRevision = ++messageBadgeRevision
        loadUnreadBadge(
            getString(R.string.messages),
            messageRequestRevision,
            { messageBadgeRevision },
            ApiClient.service::getUnreadMessageCount,
        ) { count ->
            (parentFragment as? com.cliqheart.app.feature.home.MainShellFragment)
                ?.updateMessagesUnreadCount(count)
        }
    }

    private fun loadUnreadBadge(
        label: String,
        requestRevision: Long,
        currentRevision: () -> Long,
        request: suspend () -> Response<UnreadCountResponse>,
        updateCount: (Int) -> Unit,
    ) {
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = request()
                if (!response.isSuccessful) {
                    throw IOException(apiErrorMessage(response, getString(R.string.unread_count_failed)))
                }
                val count = response.body()?.unreadCount
                    ?: throw IOException(getString(R.string.unread_count_failed))
                if (count < 0) throw IOException(getString(R.string.unread_count_failed))
                if (_binding == null || requestRevision != currentRevision()) return@launch
                updateCount(count)
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                Log.w(TAG, "Could not load $label unread count.", exception)
            }
        }
    }

    private fun updateNotificationUnreadCount(count: Int) {
        val currentBinding = _binding ?: return
        val unreadCount = count.coerceAtLeast(0)
        if (unreadCount > 0) {
            currentBinding.notificationsBadge.text =
                if (unreadCount > MAX_BADGE_COUNT) "$MAX_BADGE_COUNT+" else unreadCount.toString()
            currentBinding.notificationsBadge.visibility = View.VISIBLE
            currentBinding.btnHeaderNotifications.contentDescription = getString(
                R.string.unread_action_label,
                getString(R.string.notifications),
                unreadCount,
            )
        } else {
            currentBinding.notificationsBadge.visibility = View.GONE
            currentBinding.btnHeaderNotifications.contentDescription =
                getString(R.string.notifications)
        }
    }

    private fun showFeedState(message: String) {
        if (isReelsMode) {
            bindingOrNull()?.reelsState?.apply {
                text = message
                visibility = View.VISIBLE
            }
            bindingOrNull()?.feedRecyclerView?.visibility = View.GONE
        } else {
            headerAdapter?.setFeedState(message)
        }
    }

    private fun hideFeedState() {
        if (isReelsMode) {
            bindingOrNull()?.reelsState?.visibility = View.GONE
            bindingOrNull()?.feedRecyclerView?.visibility = View.VISIBLE
        } else {
            headerAdapter?.setFeedState(null)
        }
    }

    private fun isFeedExhausted(): Boolean =
        if (isReelsMode) reelsExhausted else postsExhausted && reelsExhausted

    override fun onDestroyView() {
        disconnectRealtime()
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
        val mediaUrl = if (media.resourceType == "video") {
            media.thumbnailUrl?.takeIf(String::isNotBlank)
                ?: media.secureUrl?.takeIf(String::isNotBlank).orEmpty()
        } else {
            media.secureUrl?.takeIf(String::isNotBlank)
                ?: media.thumbnailUrl?.takeIf(String::isNotBlank).orEmpty()
        }
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
            videoFormat = media.format?.takeIf { media.resourceType == "video" },
            mediaWidth = media.width,
            mediaHeight = media.height,
            isFollowing = isFollowing == true,
            caption = caption.orEmpty(),
            likeCount = likeCount?.takeIf { it >= 0 } ?: return null,
            commentCount = commentCount?.takeIf { it >= 0 } ?: return null,
            repostCount = repostCount?.takeIf { it >= 0 } ?: return null,
            isLiked = isLiked == true,
            isBookmarked = isSaved == true,
            isReposted = isReposted == true,
            timestamp = createdAt.toRelativeTime(),
            createdAtMillis = createdAt.toEpochMillis(),
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

    companion object {
        const val ARG_REELS_MODE = "reels_mode"
        const val TAG = "HomeFeed"
        const val PAGE_SIZE = 30
        const val PREFETCH_THRESHOLD = 5
        const val MAX_BADGE_COUNT = 99
        const val MAX_PROCESSED_ENGAGEMENT_EVENTS = 256
        const val SOCKET_RECONNECT_DELAY_MS = 1_000L
        const val SOCKET_RECONNECT_MAX_DELAY_MS = 10_000L
        const val YOUR_STORY_OWNER_ID = "your-story"
        const val STORY_VIEWER_TAG = "home-story-viewer"
        const val STORY_CREATION_TAG = "home-story-creation"
        const val COMMENTS_SHEET_TAG = "home-post-comments"

        fun newReelsInstance() = HomeFeedFragment().apply {
            arguments = Bundle().apply { putBoolean(ARG_REELS_MODE, true) }
        }
    }
}
