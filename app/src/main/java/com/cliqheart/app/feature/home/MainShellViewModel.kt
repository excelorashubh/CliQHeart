package com.cliqheart.app.feature.home

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.StoryResponse
import com.cliqheart.app.core.network.UserResponse
import com.cliqheart.app.core.security.SecureTokenStore
import com.google.gson.Gson
import com.google.gson.JsonParseException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.IOException

data class HomeStoriesState(
    val stories: List<StoryResponse> = emptyList(),
    val isLoading: Boolean = true,
    val errorMessage: String? = null,
    val lastSuccessAt: Long = 0L,
    val lastAttemptAt: Long = 0L,
)

class MainShellViewModel(application: Application) : AndroidViewModel(application) {
    private val tokenStore = SecureTokenStore(application)
    private val preferences = application.getSharedPreferences(STORIES_CACHE, 0)
    private val gson = Gson()

    private val _currentUser = MutableStateFlow(tokenStore.readSession()?.currentUser)
    val currentUser: StateFlow<UserResponse?> = _currentUser.asStateFlow()
    private val _profileError = MutableStateFlow<String?>(null)
    val profileError: StateFlow<String?> = _profileError.asStateFlow()

    private val _stories = MutableStateFlow(HomeStoriesState())
    val stories: StateFlow<HomeStoriesState> = _stories.asStateFlow()

    private var currentUserKey: String? = null
    private var profileJob: Job? = null
    private var profileLastAttemptAt = 0L
    private var storiesJob: Job? = null
    private var refreshAfterCurrentRequest = false
    private var initialStoriesRequestedForKey: String? = null

    fun initialize() {
        val cachedUser = tokenStore.readSession()?.currentUser
        val cachedUserId = cachedUser?.id?.takeIf(String::isNotBlank)
            ?: cachedUser?._id?.takeIf(String::isNotBlank)
        val nextUserKey = cachedUserId ?: cachedUser?.username ?: NO_USER_CACHE_KEY
        if (nextUserKey != currentUserKey) {
            storiesJob?.cancel()
            refreshAfterCurrentRequest = false
            currentUserKey = nextUserKey
            initialStoriesRequestedForKey = null
            _currentUser.value = cachedUser
            _stories.value = readCachedStories(nextUserKey)
        } else if (_currentUser.value != cachedUser) {
            _currentUser.value = cachedUser
        }

        if (_currentUser.value == null) loadProfileIfMissing()
        if (initialStoriesRequestedForKey != nextUserKey) {
            initialStoriesRequestedForKey = nextUserKey
            requestStories()
        } else {
            refreshStoriesIfStale()
        }
    }

    fun updateCurrentUser(user: UserResponse) {
        if (_currentUser.value == user) return
        val userId = user.id?.takeIf(String::isNotBlank)
            ?: user._id?.takeIf(String::isNotBlank)
            ?: user.username
        if (userId != currentUserKey) {
            currentUserKey = userId
            _stories.value = readCachedStories(userId)
        }
        tokenStore.saveCurrentUser(user)
        _currentUser.value = user
        _profileError.value = null
    }

    fun refreshStoriesIfStale() {
        val state = _stories.value
        val now = System.currentTimeMillis()
        if (state.lastAttemptAt > 0 && now - state.lastAttemptAt < STORIES_REFRESH_INTERVAL_MS) return
        requestStories()
    }

    fun refreshStories() {
        requestStories()
    }

    fun synchronizeAfterReconnect() {
        val state = _stories.value
        if (!state.isLoading && state.errorMessage != null) {
            requestStories()
        } else {
            refreshStoriesIfStale()
        }
        refreshProfileIfMissing()
    }

    fun refreshProfileIfMissing() {
        if (_currentUser.value == null) loadProfileIfMissing()
    }

    private fun loadProfileIfMissing() {
        val now = System.currentTimeMillis()
        if (_currentUser.value != null || profileJob?.isActive == true ||
            now - profileLastAttemptAt < PROFILE_RETRY_INTERVAL_MS
        ) return
        profileLastAttemptAt = now
        _profileError.value = null
        profileJob = viewModelScope.launch {
            try {
                val response = ApiClient.service.getMyProfile()
                val user = response.body()?.user
                if (!response.isSuccessful || user == null) {
                    Log.w(TAG, "Could not load the current user profile (${response.code()}).")
                    _profileError.value = getApplication<Application>().getString(R.string.profile_load_failed)
                    return@launch
                }
                updateCurrentUser(user)
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                Log.w(TAG, "Could not load the current user profile.", exception)
                _profileError.value = getApplication<Application>().getString(R.string.profile_load_failed)
            }
        }
    }

    private fun requestStories() {
        if (storiesJob?.isActive == true) {
            refreshAfterCurrentRequest = true
            return
        }

        val startedAt = System.currentTimeMillis()
        _stories.value = _stories.value.copy(
            isLoading = true,
            errorMessage = null,
            lastAttemptAt = startedAt,
        )
        storiesJob = viewModelScope.launch {
            try {
                Log.i(TAG, "Stories request started.")
                val response = ApiClient.service.getStories()
                if (!response.isSuccessful) {
                    Log.w(TAG, "Stories request failed with HTTP ${response.code()}.")
                    throw IOException("Stories request failed (${response.code()}).")
                }
                val stories = response.body()?.stories
                    ?: throw IOException("Stories response body was empty.")
                Log.i(
                    TAG,
                    "Stories response received: httpStatus=${response.code()}, recordCount=${stories.size}.",
                )
                val completedAt = System.currentTimeMillis()
                _stories.value = HomeStoriesState(
                    stories = stories,
                    isLoading = false,
                    lastSuccessAt = completedAt,
                    lastAttemptAt = completedAt,
                )
                writeCachedStories(stories, completedAt)
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                Log.w(TAG, "Could not load Home stories.", exception)
                _stories.value = _stories.value.copy(
                    isLoading = false,
                    errorMessage = getApplication<Application>().getString(R.string.stories_load_failed),
                )
            } finally {
                storiesJob = null
                if (refreshAfterCurrentRequest) {
                    refreshAfterCurrentRequest = false
                    requestStories()
                }
            }
        }
    }

    private fun readCachedStories(userKey: String?): HomeStoriesState {
        if (userKey.isNullOrBlank() || userKey == NO_USER_CACHE_KEY) return HomeStoriesState()
        val serialized = preferences.getString(cacheKey(userKey), null)
            ?: return HomeStoriesState()
        return try {
            val cached = gson.fromJson(serialized, CachedStories::class.java)
                ?: return HomeStoriesState()
            HomeStoriesState(
                stories = cached.stories,
                isLoading = false,
                lastSuccessAt = cached.savedAt,
                lastAttemptAt = cached.savedAt,
            )
        } catch (exception: JsonParseException) {
            Log.w(TAG, "Could not parse cached Home stories.", exception)
            HomeStoriesState()
        }
    }

    private fun writeCachedStories(stories: List<StoryResponse>, savedAt: Long) {
        val userKey = currentUserKey
            ?.takeIf { it.isNotBlank() && it != NO_USER_CACHE_KEY }
            ?: return
        preferences.edit()
            .putString(cacheKey(userKey), gson.toJson(CachedStories(stories, savedAt)))
            .apply()
    }

    private fun cacheKey(userKey: String): String = "$STORIES_CACHE_PREFIX$userKey"

    private data class CachedStories(
        val stories: List<StoryResponse>,
        val savedAt: Long,
    )

    private companion object {
        const val TAG = "MainShellViewModel"
        const val STORIES_CACHE = "cliqheart_home_cache"
        const val STORIES_CACHE_PREFIX = "stories:"
        const val STORIES_REFRESH_INTERVAL_MS = 5 * 60 * 1000L
        const val PROFILE_RETRY_INTERVAL_MS = 5 * 60 * 1000L
        const val NO_USER_CACHE_KEY = "cliqheart-no-user"
    }
}
