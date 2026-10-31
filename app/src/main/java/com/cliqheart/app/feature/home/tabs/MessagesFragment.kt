package com.cliqheart.app.feature.home.tabs

import android.graphics.Outline
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.ConversationCreateRequest
import com.cliqheart.app.core.network.UserResponse
import com.cliqheart.app.core.security.SecureTokenStore
import com.cliqheart.app.databinding.FragmentMessagesBinding
import com.cliqheart.app.feature.home.MainShellViewModel
import com.cliqheart.app.feature.home.RemoteImageLoader
import com.cliqheart.app.feature.home.adapters.ConversationAdapter
import com.cliqheart.app.feature.home.adapters.UserSearchAdapter
import com.cliqheart.app.feature.home.apiErrorMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.IOException

class MessagesFragment : Fragment() {
    private var _binding: FragmentMessagesBinding? = null
    private val binding get() = requireNotNull(_binding)
    private val shellViewModel: MainShellViewModel by activityViewModels()
    private lateinit var adapter: ConversationAdapter
    private var conversationsLoading = false
    private var hasMoreConversations = false
    private var nextConversationCursor: String? = null
    private var newMessageDialog: AlertDialog? = null
    private var userSearchJob: Job? = null

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        _binding = FragmentMessagesBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val session = SecureTokenStore(requireContext()).readSession()
        val currentUserId = session?.currentUser?.id ?: session?.currentUser?._id
        val avatar = session?.currentUser?.avatarUrl
        binding.inboxAvatar.outlineProvider = CIRCULAR_OUTLINE
        binding.inboxAvatar.clipToOutline = true
        RemoteImageLoader.load(binding.inboxAvatar, avatar, R.drawable.ic_profile)

        adapter = ConversationAdapter(currentUserId) { conversation ->
            val id = conversation.id ?: return@ConversationAdapter
            val user = conversation.participant
            navigateToChat(
                id,
                user?.id ?: user?._id,
                user?.displayName,
                user?.username,
                user?.avatarUrl,
            )
        }
        binding.conversationsRecycler.layoutManager = LinearLayoutManager(requireContext())
        binding.conversationsRecycler.adapter = adapter
        binding.conversationsRecycler.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                if (dy > 0 && !conversationsLoading && hasMoreConversations) {
                    val manager = recyclerView.layoutManager as? LinearLayoutManager ?: return
                    if (manager.findLastVisibleItemPosition() >=
                        manager.itemCount - CONVERSATION_PREFETCH_THRESHOLD
                    ) loadConversations(append = true)
                }
            }
        })
        binding.messagesState.setOnClickListener {
            if (!conversationsLoading) loadConversations()
        }
        binding.conversationSearch.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                adapter.filter(s?.toString().orEmpty())
                updateEmptyState()
            }
            override fun afterTextChanged(s: Editable?) = Unit
        })
        binding.newMessageButton.setOnClickListener { showNewMessageDialog() }

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                shellViewModel.messageInboxEvents.collect {
                    if (!conversationsLoading) loadConversations()
                }
            }
        }
        loadConversations()
    }

    private fun loadConversations(append: Boolean = false) {
        if (conversationsLoading) return
        if (append && !hasMoreConversations) return
        conversationsLoading = true
        if (!append && adapter.itemCount == 0) {
            binding.messagesState.text = getString(R.string.loading_messages)
            binding.messagesState.visibility = View.VISIBLE
        }
        val cursor = if (append) nextConversationCursor else null
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.getConversations(
                    limit = CONVERSATION_PAGE_SIZE,
                    after = cursor,
                )
                if (!response.isSuccessful) {
                    showFailure(apiErrorMessage(response, getString(R.string.messages_failed)))
                    return@launch
                }
                val page = response.body()
                    ?: throw IOException(getString(R.string.messages_failed))
                hasMoreConversations = page.hasMore
                nextConversationCursor = page.nextCursor
                if (append) {
                    adapter.appendConversations(
                        page.conversations,
                        binding.conversationSearch.text.toString(),
                    )
                } else {
                    adapter.submitConversations(
                        page.conversations,
                        binding.conversationSearch.text.toString(),
                    )
                }
                updateEmptyState()
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                showFailure(exception.message ?: getString(R.string.messages_failed))
            } finally {
                conversationsLoading = false
            }
        }
    }

    private fun updateEmptyState() {
        if (!::adapter.isInitialized) return
        binding.messagesState.visibility = if (adapter.itemCount == 0) View.VISIBLE else View.GONE
        if (adapter.itemCount == 0) {
            binding.messagesState.text = if (binding.conversationSearch.text.isNullOrBlank()) {
                getString(R.string.messages_empty)
            } else {
                getString(R.string.messages_search_empty)
            }
        }
    }

    private fun showFailure(message: String) {
        binding.messagesState.text = message
        binding.messagesState.visibility = View.VISIBLE
        binding.messagesState.setOnClickListener { loadConversations() }
    }

    private fun showNewMessageDialog() {
        if (newMessageDialog?.isShowing == true) return
        val context = requireContext()
        val content = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), dp(12))
        }
        val query = EditText(context).apply {
            hint = getString(R.string.search_people)
            setSingleLine(true)
            setPadding(dp(14), 0, dp(14), 0)
            background = androidx.core.content.ContextCompat.getDrawable(
                context,
                R.drawable.bg_message_search,
            )
        }
        val state = TextView(context).apply {
            text = getString(R.string.search_people_prompt)
            setPadding(dp(4), dp(10), dp(4), dp(10))
            setTextColor(context.getColor(R.color.heart_muted))
        }
        val people = RecyclerView(context).apply {
            layoutManager = LinearLayoutManager(context)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(360),
            )
        }
        content.addView(query, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(48),
        ))
        content.addView(state)
        content.addView(people)

        val userAdapter = UserSearchAdapter(
            onMessage = {},
            onProfile = { user -> startConversation(user) },
            showMessageButton = false,
        )
        people.adapter = userAdapter
        newMessageDialog = MaterialAlertDialogBuilder(context)
            .setTitle(R.string.new_message_title)
            .setView(content)
            .setNegativeButton(android.R.string.cancel, null)
            .create()
            .also { it.show() }

        query.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                userSearchJob?.cancel()
                val term = s?.toString()?.trim().orEmpty()
                userAdapter.submitUsers(emptyList())
                if (term.length < MIN_QUERY_LENGTH) {
                    state.text = getString(R.string.search_people_prompt)
                    return
                }
                userSearchJob = viewLifecycleOwner.lifecycleScope.launch {
                    delay(SEARCH_DEBOUNCE_MS)
                    state.text = getString(R.string.searching_people)
                    state.visibility = View.VISIBLE
                    try {
                        val response = ApiClient.service.searchUsers(term)
                        if (!response.isSuccessful) {
                            throw IOException(apiErrorMessage(response, getString(R.string.search_people_failed)))
                        }
                        val users = response.body()?.users.orEmpty()
                        userAdapter.submitUsers(users)
                        state.visibility = if (users.isEmpty()) View.VISIBLE else View.GONE
                        if (users.isEmpty()) state.text = getString(R.string.search_no_results)
                    } catch (exception: CancellationException) {
                        throw exception
                    } catch (exception: Exception) {
                        state.text = exception.message ?: getString(R.string.search_people_failed)
                        state.visibility = View.VISIBLE
                    }
                }
            }
            override fun afterTextChanged(s: Editable?) = Unit
        })
        newMessageDialog?.setOnDismissListener {
            userSearchJob?.cancel()
            userSearchJob = null
        }
    }

    private fun startConversation(user: UserResponse) {
        val participantId = user.id?.takeIf(String::isNotBlank)
            ?: user._id?.takeIf(String::isNotBlank)
            ?: return
        newMessageDialog?.dismiss()
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.createConversation(
                    ConversationCreateRequest(participantId),
                )
                val conversationId = response.body()?.conversation?.id
                if (!response.isSuccessful || conversationId.isNullOrBlank()) {
                    throw IOException(apiErrorMessage(response, getString(R.string.messages_failed)))
                }
                navigateToChat(
                    conversationId,
                    participantId,
                    user.displayName,
                    user.username,
                    user.avatarUrl,
                )
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                showFailure(exception.message ?: getString(R.string.messages_failed))
            }
        }
    }

    private fun navigateToChat(
        conversationId: String,
        participantId: String?,
        displayName: String?,
        username: String?,
        avatarUrl: String?,
    ) {
        findNavController().navigate(
            R.id.chatFragment,
            Bundle().apply {
                putString(ARG_CONVERSATION_ID, conversationId)
                putString(ARG_PARTICIPANT_ID, participantId)
                putString(ARG_PARTICIPANT_NAME, displayName)
                putString(ARG_PARTICIPANT_USERNAME, username)
                putString(ARG_PARTICIPANT_AVATAR, avatarUrl)
            },
        )
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onDestroyView() {
        userSearchJob?.cancel()
        newMessageDialog?.dismiss()
        newMessageDialog = null
        _binding = null
        super.onDestroyView()
    }

    private companion object {
        const val ARG_CONVERSATION_ID = "conversationId"
        const val ARG_PARTICIPANT_ID = "participantId"
        const val ARG_PARTICIPANT_NAME = "participantName"
        const val ARG_PARTICIPANT_USERNAME = "participantUsername"
        const val ARG_PARTICIPANT_AVATAR = "participantAvatar"
        const val MIN_QUERY_LENGTH = 2
        const val SEARCH_DEBOUNCE_MS = 300L
        const val CONVERSATION_PAGE_SIZE = 30
        const val CONVERSATION_PREFETCH_THRESHOLD = 5
        val CIRCULAR_OUTLINE = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                outline.setOval(0, 0, view.width, view.height)
            }
        }
    }
}
