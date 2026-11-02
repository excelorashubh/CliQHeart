package com.cliqheart.app.feature.home.tabs

import android.content.Context
import android.net.ConnectivityManager
import android.os.Bundle
import android.os.PowerManager
import android.util.Log
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.core.widget.doAfterTextChanged
import androidx.fragment.app.Fragment
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.ConversationCreateRequest
import com.cliqheart.app.core.network.PostResponse
import com.cliqheart.app.core.network.UserResponse
import com.cliqheart.app.core.ui.limitContentWidth
import com.cliqheart.app.databinding.FragmentDiscoverBinding
import com.cliqheart.app.feature.home.adapters.ExploreGridAdapter
import com.cliqheart.app.feature.home.adapters.ExploreHashtagAdapter
import com.cliqheart.app.feature.home.adapters.ExploreTile
import com.cliqheart.app.feature.home.adapters.UserSearchAdapter
import com.cliqheart.app.feature.home.apiErrorMessage
import com.google.android.material.button.MaterialButton
import com.google.gson.Gson
import com.google.gson.JsonParseException
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.ArrayDeque
import java.text.Normalizer
import kotlin.random.Random

class DiscoverFragment : Fragment() {
    private var _binding: FragmentDiscoverBinding? = null
    private val binding get() = requireNotNull(_binding)
    private var searchJob: Job? = null
    private var searchGeneration = 0L
    private var searchLoading = false
    private var nextSearchCursor: String? = null
    private var searchExhausted = false
    private var nextUserCursor: String? = null
    private var userSearchLoading = false
    private var userSearchExhausted = false
    private var exploreJob: Job? = null
    private var exploreLoading = false
    private var exploreLoaded = false
    private var exploreExhausted = false
    private var nextExploreCursor: String? = null
    private var exploreItems: List<ExploreTile> = emptyList()
    private var filter = ExploreFilter.EXPLORE
    private var selectedHashtag: String? = null
    private var gridAdapter: ExploreGridAdapter? = null
    private lateinit var usersAdapter: UserSearchAdapter
    private lateinit var hashtagsAdapter: ExploreHashtagAdapter
    private var previewPlayer: ExoPlayer? = null
    private var previewPlayerView: PlayerView? = null
    private var activePreviewKey: String? = null
    private var lastVisiblePreviewKeys: Set<String> = emptySet()
    private val recentPreviewKeys = ArrayDeque<String>()
    private val failedPreviewKeys = mutableSetOf<String>()
    private val reportedThumbnailKeys = mutableSetOf<String>()
    private var thumbnailSuccessCount = 0
    private var thumbnailFailureCount = 0
    private val gson = Gson()

    private enum class ExploreFilter(val buttonId: Int) {
        EXPLORE(R.id.filter_explore),
        PEOPLE(R.id.filter_people),
        VIDEOS(R.id.filter_videos),
        POSTS(R.id.filter_posts),
        TAGS(R.id.filter_tags),
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentDiscoverBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        view.limitContentWidth(MAX_CONTENT_WIDTH_DP)
        gridAdapter = ExploreGridAdapter(::openContent, ::schedulePreviewSelection) { tile, loaded ->
            if (reportedThumbnailKeys.add(tile.key)) {
                if (loaded) thumbnailSuccessCount += 1 else thumbnailFailureCount += 1
                Log.i(
                    TAG,
                    "Explore thumbnail result=${if (loaded) "success" else "failure"} " +
                        "successCount=$thumbnailSuccessCount failureCount=$thumbnailFailureCount",
                )
            }
        }
        usersAdapter = UserSearchAdapter(::startConversation, ::openProfile)
        hashtagsAdapter = ExploreHashtagAdapter(::openHashtag)

        binding.exploreGrid.layoutManager = GridLayoutManager(requireContext(), GRID_SPAN_COUNT)
        binding.exploreGrid.adapter = gridAdapter
        binding.searchUsersRecycler.layoutManager = LinearLayoutManager(requireContext())
        binding.searchUsersRecycler.adapter = usersAdapter
        binding.searchTagsRecycler.layoutManager = LinearLayoutManager(requireContext())
        binding.searchTagsRecycler.adapter = hashtagsAdapter

        restoreCachedExplore()
        renderRecentSearches()
        renderFilter()
        updateAutoplayButton()
        binding.autoplayButton.setOnClickListener {
            val enabled = !preferences().getBoolean(KEY_AUTOPLAY_ENABLED, true)
            preferences().edit().putBoolean(KEY_AUTOPLAY_ENABLED, enabled).apply()
            updateAutoplayButton()
            if (enabled) schedulePreviewSelection() else pausePreview()
        }
        binding.filterExplore.setOnClickListener { selectFilter(ExploreFilter.EXPLORE) }
        binding.filterPeople.setOnClickListener { selectFilter(ExploreFilter.PEOPLE) }
        binding.filterVideos.setOnClickListener { selectFilter(ExploreFilter.VIDEOS) }
        binding.filterPosts.setOnClickListener { selectFilter(ExploreFilter.POSTS) }
        binding.filterTags.setOnClickListener { selectFilter(ExploreFilter.TAGS) }
        binding.searchClearButton.setOnClickListener {
            filter = ExploreFilter.EXPLORE
            renderFilter()
            binding.searchEditText.setText("")
            binding.searchEditText.requestFocus()
        }
        binding.clearRecentSearches.setOnClickListener {
            preferences().edit().remove(KEY_RECENT_SEARCHES).apply()
            renderRecentSearches()
        }
        binding.searchEditText.doAfterTextChanged { editable ->
            val query = editable?.toString().orEmpty()
            if (selectedHashtag != null && !query.trim().equals("#$selectedHashtag", ignoreCase = true)) {
                selectedHashtag = null
            }
            binding.searchClearButton.visibility = if (query.isBlank()) View.GONE else View.VISIBLE
            renderRecentSearches()
            search(query)
        }
        binding.searchEditText.setOnEditorActionListener { _, actionId, event ->
            if (
                actionId == EditorInfo.IME_ACTION_SEARCH ||
                event?.keyCode == KeyEvent.KEYCODE_ENTER
            ) {
                val query = binding.searchEditText.text?.toString().orEmpty().trim()
                saveRecentSearch(query)
                search(query, immediate = true)
                (requireContext().getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                    .hideSoftInputFromWindow(binding.searchEditText.windowToken, 0)
                true
            } else {
                false
            }
        }
        binding.searchState.setOnClickListener {
            val query = binding.searchEditText.text?.toString().orEmpty()
            if (query.isBlank()) loadExplore(refresh = true) else search(query, immediate = true)
        }
        binding.exploreRefresh.setOnRefreshListener {
            val query = binding.searchEditText.text?.toString().orEmpty().trim()
            if (query.isBlank() && filter == ExploreFilter.EXPLORE) {
                loadExplore(refresh = true)
            } else {
                search(query, immediate = true)
            }
        }
        binding.exploreGrid.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                schedulePreviewSelection(rotateOnScroll = dy != 0)
                val layoutManager = recyclerView.layoutManager as? GridLayoutManager ?: return
                if (layoutManager.findLastVisibleItemPosition() < layoutManager.itemCount - PREFETCH_THRESHOLD) {
                    return
                }
                if (binding.searchEditText.text.isNullOrBlank() && filter == ExploreFilter.EXPLORE) {
                    loadExplore(refresh = false)
                } else if (filter == ExploreFilter.EXPLORE || filter == ExploreFilter.VIDEOS ||
                    filter == ExploreFilter.POSTS
                ) {
                    loadMoreContentSearch()
                }
            }
        })
        binding.searchUsersRecycler.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                val layoutManager = recyclerView.layoutManager as? LinearLayoutManager ?: return
                if (layoutManager.findLastVisibleItemPosition() >=
                    layoutManager.itemCount - USER_PREFETCH_THRESHOLD
                ) {
                    loadMoreUsers()
                }
            }
        })

        renderExploreMode()
        if (gridAdapter?.itemCount == 0) showStatus(getString(R.string.explore_loading))
        loadExplore(refresh = true)
    }

    private fun selectFilter(nextFilter: ExploreFilter) {
        if (filter == nextFilter) return
        filter = nextFilter
        if (nextFilter != ExploreFilter.EXPLORE) selectedHashtag = null
        renderFilter()
        val query = binding.searchEditText.text?.toString().orEmpty()
        search(query, immediate = true)
    }

    private fun renderFilter() {
        ExploreFilter.entries.forEach { category ->
            val button = binding.root.findViewById<MaterialButton>(category.buttonId)
            val selected = category == filter
            button.isSelected = selected
            button.backgroundTintList = ContextCompat.getColorStateList(
                requireContext(),
                if (selected) R.color.heart_primary else R.color.heart_surface,
            )
            button.setTextColor(
                ContextCompat.getColor(
                    requireContext(),
                    if (selected) R.color.heart_on_primary else R.color.heart_muted,
                ),
            )
        }
    }

    private fun search(rawQuery: String, immediate: Boolean = false) {
        searchJob?.cancel()
        val query = normalizeSearchQuery(rawQuery)
        val generation = ++searchGeneration
        nextSearchCursor = null
        searchExhausted = false
        nextUserCursor = null
        userSearchExhausted = false
        searchLoading = false
        userSearchLoading = false
        if (query.isBlank()) {
            if (filter == ExploreFilter.EXPLORE) {
                renderExploreMode()
                gridAdapter?.submitItems(exploreItems)
                if (!exploreLoaded) loadExplore(refresh = true)
            } else {
                clearSearchResults()
                renderEmptySearchPrompt()
            }
            return
        }
        if (query.length < MIN_QUERY_LENGTH) {
            clearSearchResults()
            showStatus(getString(R.string.explore_search_prompt))
            renderCurrentResultsMode()
            return
        }
        clearSearchResults()
        renderCurrentResultsMode()
        searchLoading = true
        showStatus(getString(R.string.explore_searching))
        searchJob = viewLifecycleOwner.lifecycleScope.launch {
            if (!immediate) delay(SEARCH_DEBOUNCE_MS)
            try {
                when (filter) {
                    ExploreFilter.PEOPLE -> loadPeopleSearch(query, generation, append = false)
                    ExploreFilter.TAGS -> loadHashtagSearch(query, generation)
                    ExploreFilter.EXPLORE,
                    ExploreFilter.VIDEOS,
                    ExploreFilter.POSTS,
                    -> loadContentSearch(query, generation, append = false)
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                if (isCurrentSearch(generation, query)) {
                    Log.w(TAG, "Search request failed category=${exception.javaClass.simpleName}")
                    showStatus(getString(R.string.explore_search_failed))
                }
            } finally {
                if (generation == searchGeneration) {
                    searchLoading = false
                    userSearchLoading = false
                    _binding?.exploreRefresh?.isRefreshing = false
                }
            }
        }
    }

    private suspend fun loadContentSearch(query: String, generation: Long, append: Boolean) {
        Log.i(
            TAG,
            "Content search request started queryLength=${query.length} " +
                "category=${filter.name.lowercase()} append=$append",
        )
        val requestedType = when (filter) {
            ExploreFilter.VIDEOS -> "videos"
            ExploreFilter.POSTS -> "posts"
            else -> "all"
        }
        val selectedTag = selectedHashtag?.takeIf {
            filter == ExploreFilter.EXPLORE && query.equals("#$it", ignoreCase = true)
        }
        val after = if (append) nextSearchCursor else null
        val posts: List<PostResponse>
        val nextCursor: String?
        var responseStatus = 0
        if (selectedTag != null) {
            val response = ApiClient.service.getHashtagResults(selectedTag, PAGE_SIZE, after)
            if (!isCurrentSearch(generation, query)) return
            responseStatus = response.code()
            if (!response.isSuccessful) {
                Log.i(TAG, "Content search response status=$responseStatus backendCount=0")
                showStatus(apiErrorMessage(response, getString(R.string.explore_search_failed)))
                return
            }
            val body = response.body()
            if (body == null) {
                showStatus(getString(R.string.explore_search_failed))
                return
            }
            posts = body.items
            nextCursor = body.nextCursor
        } else {
            val response = ApiClient.service.searchContent(
                query = query,
                type = requestedType,
                limit = PAGE_SIZE,
                after = after,
            )
            if (!isCurrentSearch(generation, query)) return
            responseStatus = response.code()
            if (!response.isSuccessful) {
                Log.i(TAG, "Content search response status=$responseStatus backendCount=0")
                showStatus(apiErrorMessage(response, getString(R.string.explore_search_failed)))
                return
            }
            val body = response.body()
            if (body == null) {
                showStatus(getString(R.string.explore_search_failed))
                return
            }
            posts = body.items
            nextCursor = body.nextCursor
        }
        val results = posts.map { post ->
            ExploreTile(post, post.contentType ?: if (requestedType == "reels") "reel" else "post")
        }.filter { tile ->
            filter != ExploreFilter.VIDEOS || tile.videoUrl != null
        }
        Log.i(
            TAG,
            "Content search response status=$responseStatus backendCount=${posts.size} " +
                "mappedCount=${results.size} discardedCount=${posts.size - results.size} " +
                "discardedReason=${if (filter == ExploreFilter.VIDEOS) "missing_video_media" else "none"}",
        )
        gridAdapter?.submitItems(results, append)
        Log.i(TAG, "Content search adapterCount=${gridAdapter?.itemCount ?: 0}")
        nextSearchCursor = nextCursor
        searchExhausted = nextCursor.isNullOrBlank()
        renderContentState(results.isEmpty() && !append)
        schedulePreviewSelection()
    }

    private suspend fun loadPeopleSearch(query: String, generation: Long, append: Boolean) {
        Log.i(TAG, "People search request started queryLength=${query.length} append=$append")
        val response = ApiClient.service.searchUsers(
            query = query,
            limit = PAGE_SIZE,
            after = if (append) nextUserCursor else null,
        )
        if (!isCurrentSearch(generation, query)) return
        Log.i(
            TAG,
            "People search response status=${response.code()} backendCount=${response.body()?.users?.size ?: 0}",
        )
        if (!response.isSuccessful) {
            showStatus(apiErrorMessage(response, getString(R.string.explore_search_failed)))
            return
        }
        val body = response.body()
        if (body == null) {
            showStatus(getString(R.string.explore_search_failed))
            return
        }
        if (append) usersAdapter.appendUsers(body.users) else usersAdapter.submitUsers(body.users)
        Log.i(TAG, "People search adapterCount=${usersAdapter.itemCount}")
        nextUserCursor = body.nextCursor
        userSearchExhausted = body.nextCursor.isNullOrBlank()
        if (body.users.isEmpty() && !append) showStatus(getString(R.string.explore_people_empty))
        else hideStatus()
    }

    private suspend fun loadHashtagSearch(query: String, generation: Long) {
        val response = ApiClient.service.searchHashtags(query)
        if (!isCurrentSearch(generation, query)) return
        if (!response.isSuccessful) {
            showStatus(apiErrorMessage(response, getString(R.string.explore_search_failed)))
            return
        }
        val hashtags = response.body()?.hashtags
        if (hashtags == null) {
            showStatus(getString(R.string.explore_search_failed))
            return
        }
        hashtagsAdapter.submitHashtags(hashtags)
        if (hashtags.isEmpty()) showStatus(getString(R.string.explore_tags_empty))
        else hideStatus()
    }

    private fun loadMoreContentSearch() {
        val query = normalizeSearchQuery(binding.searchEditText.text?.toString().orEmpty())
        if (
            query.length < MIN_QUERY_LENGTH ||
            searchLoading ||
            searchExhausted ||
            nextSearchCursor.isNullOrBlank()
        ) return
        searchLoading = true
        val generation = searchGeneration
        searchJob = viewLifecycleOwner.lifecycleScope.launch {
            try {
                loadContentSearch(query, generation, append = true)
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                if (isCurrentSearch(generation, query)) {
                    Log.w(TAG, "Could not load another search page category=${exception.javaClass.simpleName}")
                    showStatus(getString(R.string.explore_search_failed))
                }
            } finally {
                if (generation == searchGeneration) searchLoading = false
            }
        }
    }

    private fun loadMoreUsers() {
        val query = normalizeSearchQuery(binding.searchEditText.text?.toString().orEmpty())
        if (
            filter != ExploreFilter.PEOPLE ||
            query.length < MIN_QUERY_LENGTH ||
            userSearchLoading ||
            userSearchExhausted ||
            nextUserCursor.isNullOrBlank()
        ) return
        userSearchLoading = true
        val generation = searchGeneration
        searchJob = viewLifecycleOwner.lifecycleScope.launch {
            try {
                loadPeopleSearch(query, generation, append = true)
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                if (isCurrentSearch(generation, query)) {
                    Log.w(
                        TAG,
                        "Could not load another people-search page category=${exception.javaClass.simpleName}",
                    )
                    showStatus(getString(R.string.explore_search_failed))
                }
            } finally {
                if (generation == searchGeneration) userSearchLoading = false
            }
        }
    }

    private fun loadExplore(refresh: Boolean) {
        if (exploreLoading || (!refresh && exploreExhausted)) return
        if (!refresh && exploreLoaded && nextExploreCursor.isNullOrBlank()) return
        exploreJob?.cancel()
        exploreLoading = true
        if (refresh) {
            nextExploreCursor = null
            exploreExhausted = false
        }
        if (gridAdapter?.itemCount == 0) showStatus(getString(R.string.explore_loading))
        exploreJob = viewLifecycleOwner.lifecycleScope.launch {
            try {
                Log.i(TAG, "Explore request started refresh=$refresh")
                val response = ApiClient.service.getExplore(
                    limit = PAGE_SIZE,
                    after = if (refresh) null else nextExploreCursor,
                )
                if (!response.isSuccessful) {
                    Log.i(TAG, "Explore response status=${response.code()} backendCount=0")
                    showStatus(apiErrorMessage(response, getString(R.string.explore_load_failed)))
                    return@launch
                }
                val body = response.body()
                if (body == null) {
                    showStatus(getString(R.string.explore_load_failed))
                    return@launch
                }
                val backendPostCount = body.items.count { it.contentType == "post" }
                val backendReelCount = body.items.count { it.contentType == "reel" }
                val items = body.items.map { post ->
                    ExploreTile(post, post.contentType ?: "post")
                }
                Log.i(
                    TAG,
                    "Explore response status=${response.code()} posts=$backendPostCount " +
                        "reels=$backendReelCount total=${body.items.size} mapped=${items.size}",
                )
                gridAdapter?.submitItems(items, append = !refresh)
                Log.i(TAG, "Explore adapterCount=${gridAdapter?.itemCount ?: 0}")
                exploreItems = if (refresh) {
                    items
                } else {
                    val keys = exploreItems.mapTo(mutableSetOf()) { it.key }
                    exploreItems + items.filter { keys.add(it.key) }
                }
                if (refresh) failedPreviewKeys.clear()
                nextExploreCursor = body.nextCursor
                exploreExhausted = body.nextCursor.isNullOrBlank()
                exploreLoaded = true
                persistExplore(items, append = !refresh)
                preferences().edit()
                    .putString(KEY_EXPLORE_CURSOR, nextExploreCursor)
                    .apply()
                if (gridAdapter?.itemCount == 0) showStatus(getString(R.string.explore_grid_empty))
                else hideStatus()
                schedulePreviewSelection()
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                Log.w(TAG, "Explore feed request failed category=${exception.javaClass.simpleName}")
                showStatus(getString(R.string.explore_load_failed))
            } finally {
                exploreLoading = false
                _binding?.exploreRefresh?.isRefreshing = false
            }
        }
    }

    private fun restoreCachedExplore() {
        val json = preferences().getString(KEY_EXPLORE_CACHE, null) ?: return
        try {
            val listType = object : TypeToken<List<PostResponse>>() {}.type
            val cachedItems: List<PostResponse> = gson.fromJson(json, listType) ?: emptyList()
            if (cachedItems.isNotEmpty()) {
                exploreItems = cachedItems.map { post -> ExploreTile(post, post.contentType ?: "post") }
                gridAdapter?.submitItems(exploreItems)
                nextExploreCursor = preferences().getString(KEY_EXPLORE_CURSOR, null)
                exploreLoaded = true
                hideStatus()
            }
        } catch (exception: JsonParseException) {
            Log.w(TAG, "Cached Explore content could not be decoded.", exception)
            preferences().edit().remove(KEY_EXPLORE_CACHE).apply()
        }
    }

    private fun persistExplore(items: List<ExploreTile>, append: Boolean) {
        val allItems = if (append) {
            val existingJson = preferences().getString(KEY_EXPLORE_CACHE, null)
            val existing = if (existingJson.isNullOrBlank()) {
                emptyList()
            } else {
                val listType = object : TypeToken<List<PostResponse>>() {}.type
                try {
                    gson.fromJson<List<PostResponse>>(existingJson, listType).orEmpty()
                } catch (exception: JsonParseException) {
                    Log.w(TAG, "Discarding unreadable Explore cache before update.", exception)
                    emptyList()
                }
            }
            val keys = existing.mapTo(mutableSetOf()) { "${it.contentType}:${it.id}" }
            existing + items.map(ExploreTile::content).filter { keys.add("${it.contentType}:${it.id}") }
        } else {
            items.map(ExploreTile::content)
        }
        preferences().edit().putString(KEY_EXPLORE_CACHE, gson.toJson(allItems)).apply()
    }

    private fun renderRecentSearches() {
        val query = binding.searchEditText.text?.toString().orEmpty()
        val recent = readRecentSearches()
        binding.recentSearchesSection.visibility =
            if (query.isBlank() && recent.isNotEmpty()) View.VISIBLE else View.GONE
        binding.recentSearchChips.removeAllViews()
        recent.forEach { term ->
            val chip = TextView(requireContext()).apply {
                text = term
                setTextColor(ContextCompat.getColor(context, R.color.heart_text))
                textSize = 12f
                setPadding(dp(12), dp(7), dp(12), dp(7))
                background = ContextCompat.getDrawable(context, R.drawable.bg_search_history_chip)
                setOnClickListener {
                    filter = ExploreFilter.EXPLORE
                    renderFilter()
                    binding.searchEditText.setText(term)
                    binding.searchEditText.setSelection(binding.searchEditText.text?.length ?: 0)
                }
            }
            val params = ViewGroup.MarginLayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply {
                marginStart = dp(4)
                marginEnd = dp(4)
                bottomMargin = dp(6)
            }
            binding.recentSearchChips.addView(chip, params)
        }
    }

    private fun saveRecentSearch(query: String) {
        if (query.length < MIN_QUERY_LENGTH) return
        val next = (listOf(query) + readRecentSearches().filterNot { it.equals(query, true) })
            .take(MAX_RECENT_SEARCHES)
        preferences().edit().putString(KEY_RECENT_SEARCHES, gson.toJson(next)).apply()
        renderRecentSearches()
    }

    private fun readRecentSearches(): List<String> {
        val json = preferences().getString(KEY_RECENT_SEARCHES, null) ?: return emptyList()
        return try {
            val listType = object : TypeToken<List<String>>() {}.type
            gson.fromJson<List<String>>(json, listType).orEmpty()
        } catch (exception: JsonParseException) {
            Log.w(TAG, "Recent searches could not be decoded.", exception)
            preferences().edit().remove(KEY_RECENT_SEARCHES).apply()
            emptyList()
        }
    }

    private fun renderCurrentResultsMode() {
        when (filter) {
            ExploreFilter.PEOPLE -> {
                binding.exploreRefresh.visibility = View.GONE
                binding.searchUsersRecycler.visibility = View.VISIBLE
                binding.searchTagsRecycler.visibility = View.GONE
            }
            ExploreFilter.TAGS -> {
                binding.exploreRefresh.visibility = View.GONE
                binding.searchUsersRecycler.visibility = View.GONE
                binding.searchTagsRecycler.visibility = View.VISIBLE
            }
            else -> renderExploreMode()
        }
        schedulePreviewSelection()
    }

    private fun renderExploreMode() {
        binding.exploreRefresh.visibility = View.VISIBLE
        binding.searchUsersRecycler.visibility = View.GONE
        binding.searchTagsRecycler.visibility = View.GONE
    }

    private fun renderEmptySearchPrompt() {
        clearSearchResults()
        renderCurrentResultsMode()
        if (filter == ExploreFilter.EXPLORE) {
            if (gridAdapter?.itemCount == 0) showStatus(getString(R.string.explore_grid_empty))
            else hideStatus()
        } else {
            showStatus(getString(R.string.explore_search_prompt))
        }
    }

    private fun clearSearchResults() {
        gridAdapter?.submitItems(emptyList())
        usersAdapter.submitUsers(emptyList())
        hashtagsAdapter.submitHashtags(emptyList())
        schedulePreviewSelection()
    }

    private fun renderContentState(noResults: Boolean) {
        if (noResults && gridAdapter?.itemCount == 0) showStatus(getString(R.string.explore_empty))
        else hideStatus()
    }

    private fun showStatus(message: String) {
        binding.searchState.text = message
        binding.searchState.visibility = View.VISIBLE
    }

    private fun hideStatus() {
        binding.searchState.visibility = View.GONE
    }

    private fun isCurrentSearch(generation: Long, query: String): Boolean =
        _binding != null &&
            generation == searchGeneration &&
            normalizeSearchQuery(binding.searchEditText.text?.toString().orEmpty()) == query

    private fun normalizeSearchQuery(value: String): String =
        Normalizer.normalize(value.trim().replace(Regex("\\s+"), " "), Normalizer.Form.NFKC)
            .replace(Regex("^@+"), "")
            .trim()

    private fun openHashtag(name: String) {
        saveRecentSearch("#$name")
        filter = ExploreFilter.EXPLORE
        selectedHashtag = name
        renderFilter()
        binding.searchEditText.setText("#$name")
        binding.searchEditText.setSelection(binding.searchEditText.text?.length ?: 0)
    }

    private fun openContent(tile: ExploreTile) {
        val isReel = tile.contentType == "reel"
        val contentId = tile.content.id?.takeIf(String::isNotBlank) ?: return
        if (isReel) {
            pausePreview()
            (parentFragment as? com.cliqheart.app.feature.home.MainShellFragment)
                ?.openReelInViewer(contentId)
            return
        }
        pausePreview()
        (parentFragment as? com.cliqheart.app.feature.home.MainShellFragment)
            ?.openPostInFeed(contentId)
    }

    private fun openProfile(user: UserResponse) {
        val id = user.id ?: user._id ?: return
        findNavController().navigate(
            R.id.profileDetailFragment,
            Bundle().apply { putString(ARG_PROFILE_USER_ID, id) },
        )
    }

    private fun startConversation(user: UserResponse) {
        val participantId = user.id ?: user._id
        if (participantId.isNullOrBlank()) {
            showStatus(getString(R.string.explore_search_failed))
            return
        }
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.createConversation(
                    ConversationCreateRequest(participantId),
                )
                val conversationId = response.body()?.conversation?.id
                if (!response.isSuccessful || conversationId.isNullOrBlank()) {
                    showStatus(apiErrorMessage(response, getString(R.string.explore_search_failed)))
                    return@launch
                }
                findNavController().navigate(
                    R.id.chatFragment,
                    Bundle().apply { putString(ARG_CONVERSATION_ID, conversationId) },
                )
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                Log.w(TAG, "Could not open a conversation from search category=${exception.javaClass.simpleName}")
                showStatus(getString(R.string.explore_search_failed))
            }
        }
    }

    private fun schedulePreviewSelection(rotateOnScroll: Boolean = false) {
        bindingOrNull()?.exploreGrid?.post { updatePreviewSelection(rotateOnScroll) }
    }

    private fun updatePreviewSelection(rotateOnScroll: Boolean = false) {
        val adapter = gridAdapter ?: return
        if (_binding == null) {
            pausePreview()
            return
        }
        if (
            !lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) ||
            !preferences().getBoolean(KEY_AUTOPLAY_ENABLED, true) ||
            isSystemAutoplayRestricted()
        ) {
            pausePreview()
            updateAutoplayButton()
            return
        }
        val visibleTargets = adapter.visibleVideoTargets()
            .filter { it.thumbnailLoaded && it.item.key !in failedPreviewKeys }
        val visibleKeys = visibleTargets.mapTo(mutableSetOf()) { it.item.key }
        val visibleSetChanged = visibleKeys != lastVisiblePreviewKeys
        lastVisiblePreviewKeys = visibleKeys
        val activeTarget = visibleTargets.firstOrNull { it.item.key == activePreviewKey }
        if (
            activeTarget != null &&
            previewPlayer?.playWhenReady == true &&
            previewPlayer?.playbackState != Player.STATE_ENDED &&
            !(rotateOnScroll && visibleSetChanged && visibleTargets.size > 1)
        ) return
        if (activePreviewKey != null) clearActivePreview()
        if (visibleTargets.isEmpty()) return

        val alternatives = visibleTargets.filter { it.item.key != activePreviewKey }
        val availableTargets = if (alternatives.isNotEmpty()) alternatives else visibleTargets
        val notRecentlyPlayed = availableTargets.filter { it.item.key !in recentPreviewKeys }
        val selectionPool = notRecentlyPlayed.ifEmpty { availableTargets }
        val selected = selectionPool[Random.nextInt(selectionPool.size)]
        val videoUrl = selected.item.videoUrl ?: return
        val player = getPreviewPlayer()
        val playerView = requireNotNull(previewPlayerView)
        adapter.showPreview(selected.item.key, playerView)
        activePreviewKey = selected.item.key
        recentPreviewKeys.addLast(selected.item.key)
        while (recentPreviewKeys.size > RECENT_PREVIEW_HISTORY) recentPreviewKeys.removeFirst()
        player.apply {
            stop()
            clearMediaItems()
            setMediaItem(MediaItem.fromUri(videoUrl))
            prepare()
            playWhenReady = true
            play()
        }
    }

    private fun getPreviewPlayer(): ExoPlayer =
        previewPlayer ?: ExoPlayer.Builder(requireContext()).build().also { player ->
            player.repeatMode = Player.REPEAT_MODE_OFF
            player.volume = 0f
            player.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (playbackState == Player.STATE_ENDED) {
                        clearActivePreview()
                        schedulePreviewSelection()
                    }
                }

                override fun onPlayerError(error: PlaybackException) {
                    val failedKey = activePreviewKey
                    if (failedKey != null) failedPreviewKeys += failedKey
                    Log.w(TAG, "Explore preview playback failed.", error)
                    clearActivePreview()
                    schedulePreviewSelection()
                }
            })
            previewPlayerView = PlayerView(requireContext()).apply {
                useController = false
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                setShutterBackgroundColor(android.graphics.Color.BLACK)
                this.player = player
            }
            previewPlayer = player
        }

    private fun clearActivePreview() {
        previewPlayer?.run {
            playWhenReady = false
            stop()
            clearMediaItems()
        }
        previewPlayerView?.let { playerView ->
            playerView.player = null
            gridAdapter?.clearPreviews(playerView)
            previewPlayer?.let { playerView.player = it }
        }
        activePreviewKey = null
    }

    private fun pausePreview() {
        clearActivePreview()
    }

    private fun isSystemAutoplayRestricted(): Boolean {
        val context = context ?: return true
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val connectivityManager =
            context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        return powerManager.isPowerSaveMode ||
            connectivityManager.restrictBackgroundStatus ==
            ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED ||
            connectivityManager.isActiveNetworkMetered ||
            connectivityManager.activeNetwork == null
    }

    private fun updateAutoplayButton() {
        val enabled = preferences().getBoolean(KEY_AUTOPLAY_ENABLED, true)
        binding.autoplayButton.setText(
            if (enabled) R.string.autoplay_enabled else R.string.autoplay_disabled,
        )
        binding.autoplayButton.contentDescription =
            if (enabled && isSystemAutoplayRestricted()) {
                getString(R.string.explore_autoplay_paused)
            } else {
                getString(if (enabled) R.string.autoplay_enabled else R.string.autoplay_disabled)
            }
    }

    private fun preferences() =
        requireContext().getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun bindingOrNull() = _binding

    override fun onPause() {
        pausePreview()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        schedulePreviewSelection()
    }

    override fun onDestroyView() {
        searchJob?.cancel()
        exploreJob?.cancel()
        previewPlayerView?.let { playerView ->
            playerView.player = null
            gridAdapter?.clearPreviews(playerView)
        }
        previewPlayer?.release()
        previewPlayer = null
        previewPlayerView = null
        gridAdapter = null
        _binding = null
        super.onDestroyView()
    }

    private companion object {
        const val TAG = "DiscoverFragment"
        const val PREFERENCES_NAME = "explore_preferences"
        const val KEY_EXPLORE_CACHE = "cached_explore_items"
        const val KEY_EXPLORE_CURSOR = "cached_explore_cursor"
        const val KEY_RECENT_SEARCHES = "recent_searches"
        const val KEY_AUTOPLAY_ENABLED = "autoplay_enabled"
        const val MIN_QUERY_LENGTH = 2
        const val SEARCH_DEBOUNCE_MS = 300L
        const val PAGE_SIZE = 30
        const val PREFETCH_THRESHOLD = 8
        const val USER_PREFETCH_THRESHOLD = 5
        const val MAX_RECENT_SEARCHES = 8
        const val RECENT_PREVIEW_HISTORY = 3
        const val GRID_SPAN_COUNT = 4
        const val MAX_CONTENT_WIDTH_DP = 720
        const val ARG_CONVERSATION_ID = "conversationId"
        const val ARG_PROFILE_USER_ID = "profileUserId"
    }
}
