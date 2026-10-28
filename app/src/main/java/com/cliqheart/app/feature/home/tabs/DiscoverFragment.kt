package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import androidx.core.widget.doAfterTextChanged
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.ConversationCreateRequest
import com.cliqheart.app.core.network.UserResponse
import com.cliqheart.app.core.ui.limitContentWidth
import com.cliqheart.app.databinding.FragmentDiscoverBinding
import com.cliqheart.app.feature.home.adapters.UserSearchAdapter
import com.cliqheart.app.feature.home.apiErrorMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class DiscoverFragment : Fragment() {
    private var _binding: FragmentDiscoverBinding? = null
    private val binding get() = requireNotNull(_binding)
    private var searchJob: Job? = null
    private lateinit var adapter: UserSearchAdapter

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentDiscoverBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        view.limitContentWidth(720)
        adapter = UserSearchAdapter(::startConversation, ::openProfile)
        binding.searchUsersRecycler.layoutManager = LinearLayoutManager(requireContext())
        binding.searchUsersRecycler.adapter = adapter
        binding.searchEditText.doAfterTextChanged { editable ->
            searchUsers(editable?.toString().orEmpty())
        }
        binding.searchEditText.setOnEditorActionListener { _, actionId, event ->
            if (
                actionId == EditorInfo.IME_ACTION_SEARCH ||
                event?.keyCode == KeyEvent.KEYCODE_ENTER
            ) {
                searchUsers(binding.searchEditText.text?.toString().orEmpty(), immediate = true)
                true
            } else {
                false
            }
        }
    }

    private fun searchUsers(rawQuery: String, immediate: Boolean = false) {
        searchJob?.cancel()
        val query = rawQuery.trim()
        if (query.length < MIN_QUERY_LENGTH) {
            adapter.submitUsers(emptyList())
            binding.searchState.text = getString(R.string.search_users_prompt)
            binding.searchState.visibility = View.VISIBLE
            return
        }
        searchJob = viewLifecycleOwner.lifecycleScope.launch {
            if (!immediate) delay(SEARCH_DEBOUNCE_MS)
            binding.searchState.text = getString(R.string.searching)
            binding.searchState.visibility = View.VISIBLE
            try {
                val response = ApiClient.service.searchUsers(query)
                if (!response.isSuccessful) {
                    showSearchFailure(apiErrorMessage(response, getString(R.string.search_failed)))
                    return@launch
                }
                val users = response.body()?.users.orEmpty()
                adapter.submitUsers(users)
                binding.searchState.visibility = if (users.isEmpty()) View.VISIBLE else View.GONE
                if (users.isEmpty()) binding.searchState.text = getString(R.string.search_no_results)
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                showSearchFailure()
            }
        }
    }

    private fun startConversation(user: UserResponse) {
        val participantId = user.id ?: user._id
        if (participantId.isNullOrBlank()) {
            showSearchFailure()
            return
        }

        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.createConversation(
                    ConversationCreateRequest(participantId),
                )
                val conversationId = response.body()?.conversation?.id
                if (!response.isSuccessful || conversationId.isNullOrBlank()) {
                    showSearchFailure(apiErrorMessage(response, getString(R.string.search_failed)))
                    return@launch
                }
                findNavController().navigate(
                    R.id.chatFragment,
                    Bundle().apply { putString(ARG_CONVERSATION_ID, conversationId) },
                )
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                showSearchFailure()
            }
        }
    }

    private fun openProfile(user: UserResponse) {
        val id = user.id ?: user._id ?: return
        findNavController().navigate(
            R.id.profileDetailFragment,
            Bundle().apply { putString(ARG_PROFILE_USER_ID, id) },
        )
    }

    private fun showSearchFailure(message: String = getString(R.string.search_failed)) {
        binding.searchState.text = message
        binding.searchState.visibility = View.VISIBLE
    }

    override fun onDestroyView() {
        searchJob?.cancel()
        _binding = null
        super.onDestroyView()
    }

    private companion object {
        const val ARG_CONVERSATION_ID = "conversationId"
        const val ARG_PROFILE_USER_ID = "profileUserId"
        const val MIN_QUERY_LENGTH = 2
        const val SEARCH_DEBOUNCE_MS = 300L
    }
}
