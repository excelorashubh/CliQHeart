package com.cliqheart.app.feature.home.tabs

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Outline
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.inputmethod.EditorInfo
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.BuildConfig
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.MessageCreateRequest
import com.cliqheart.app.core.network.MessageResponse
import com.cliqheart.app.core.security.SecureTokenStore
import com.cliqheart.app.databinding.FragmentChatBinding
import com.cliqheart.app.feature.home.MainShellViewModel
import com.cliqheart.app.feature.home.RemoteImageLoader
import com.cliqheart.app.feature.home.adapters.MessageAdapter
import com.cliqheart.app.feature.home.apiErrorMessage
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.gson.Gson
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.IOException
import java.util.UUID

class ChatFragment : Fragment() {
    private var _binding: FragmentChatBinding? = null
    private val binding get() = requireNotNull(_binding)
    private val shellViewModel: MainShellViewModel by activityViewModels()
    private val gson = Gson()
    private var conversationId: String? = null
    private var participantId: String? = null
    private var participantUsername: String? = null
    private lateinit var adapter: MessageAdapter
    private var realtimeSocket: Socket? = null
    private var typingJob: Job? = null
    private var typingSent = false
    private var loadingMessages = false
    private var hasMoreMessages = false
    private var nextMessageCursor: String? = null
    private var refreshingSocketAuth = false

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        _binding = FragmentChatBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        conversationId = arguments?.getString(ARG_CONVERSATION_ID)
        participantId = arguments?.getString(ARG_PARTICIPANT_ID)
        participantUsername = arguments?.getString(ARG_PARTICIPANT_USERNAME)
        val participantName = arguments?.getString(ARG_PARTICIPANT_NAME)
            ?: participantUsername?.let { "@$it" }
        binding.chatTitle.text = participantName ?: getString(R.string.conversation)
        binding.chatPresence.text = getString(R.string.message_status_generic)
        binding.chatAvatar.outlineProvider = CIRCULAR_OUTLINE
        binding.chatAvatar.clipToOutline = true
        RemoteImageLoader.load(
            binding.chatAvatar,
            arguments?.getString(ARG_PARTICIPANT_AVATAR),
            R.drawable.ic_profile,
        )
        binding.chatBackButton.setOnClickListener { findNavController().navigateUp() }
        binding.chatMoreButton.setOnClickListener { showConversationMenu() }
        binding.chatAvatar.setOnClickListener { openParticipantProfile() }

        val currentUserId = SecureTokenStore(requireContext()).readSession()?.currentUser.let { user ->
            user?.id?.takeIf(String::isNotBlank) ?: user?._id
        }
        adapter = MessageAdapter(currentUserId, ::retryMessage)
        val layoutManager = LinearLayoutManager(requireContext()).apply { stackFromEnd = true }
        binding.messagesRecycler.layoutManager = layoutManager
        binding.messagesRecycler.adapter = adapter
        binding.messagesRecycler.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                if (dy < 0 && !loadingMessages && hasMoreMessages &&
                    layoutManager.findFirstVisibleItemPosition() <= PAGINATION_THRESHOLD
                ) {
                    loadMessages(older = true)
                }
            }
        })

        binding.sendMessageButton.setOnClickListener { sendMessage() }
        binding.emojiButton.setOnClickListener {
            val cursor = binding.messageInput.selectionStart.coerceAtLeast(0)
            binding.messageInput.text?.insert(cursor, "\uD83D\uDE0A")
        }
        binding.messageInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                sendMessage()
                true
            } else {
                false
            }
        }
        binding.messageInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                updateTypingState(!s.isNullOrBlank())
                persistDraft(s?.toString().orEmpty())
            }
            override fun afterTextChanged(s: Editable?) = Unit
        })
        restoreDraft()
        loadMessages()
        connectRealtime()
    }

    private fun loadMessages(older: Boolean = false) {
        val id = conversationId
        if (id.isNullOrBlank() || loadingMessages) {
            if (id.isNullOrBlank()) showFailure()
            return
        }
        loadingMessages = true
        if (!older && adapter.itemCount == 0) {
            binding.chatState.text = getString(R.string.loading_messages)
            binding.chatState.visibility = View.VISIBLE
        }
        val previousCount = adapter.itemCount
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.getMessages(
                    conversationId = id,
                    limit = MESSAGE_PAGE_SIZE,
                    before = if (older) nextMessageCursor else null,
                )
                if (!response.isSuccessful) {
                    throw IOException(apiErrorMessage(response, getString(R.string.chat_failed)))
                }
                val page = response.body() ?: throw IOException(getString(R.string.chat_failed))
                hasMoreMessages = page.hasMore
                nextMessageCursor = page.nextCursor
                adapter.submitMessages(
                    if (older) page.messages + adapter.messagesSnapshot() else page.messages,
                )
                binding.chatState.visibility = View.GONE
                if (older) {
                    binding.messagesRecycler.scrollToPosition(
                        (page.messages.size).coerceAtLeast(0),
                    )
                } else if (page.messages.isNotEmpty()) {
                    binding.messagesRecycler.scrollToPosition(adapter.itemCount - 1)
                    markConversationRead(id)
                }
                if (previousCount == 0 && page.messages.isEmpty()) {
                    binding.chatState.text = getString(R.string.chat_empty)
                    binding.chatState.visibility = View.VISIBLE
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                showFailure(exception.message ?: getString(R.string.chat_failed))
            } finally {
                loadingMessages = false
            }
        }
    }

    private fun markConversationRead(id: String) {
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.markConversationRead(id)
                if (!response.isSuccessful) {
                    Log.w(TAG, "Could not mark conversation as read (HTTP ${response.code()}).")
                    return@launch
                }
                val unreadResponse = ApiClient.service.getUnreadMessageCount()
                if (unreadResponse.isSuccessful) {
                    unreadResponse.body()?.unreadCount?.let(shellViewModel::updateMessagesUnreadCount)
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                Log.w(TAG, "Could not mark conversation as read.")
            }
        }
    }

    private fun sendMessage(retry: MessageResponse? = null) {
        val id = conversationId ?: return
        val text = retry?.text ?: binding.messageInput.text?.toString()?.trim().orEmpty()
        if (text.isEmpty()) return
        val clientMessageId = retry?.clientMessageId ?: UUID.randomUUID().toString()
        if (retry == null) {
            adapter.addMessage(
                MessageResponse(
                    senderId = SecureTokenStore(requireContext()).readSession()?.currentUser.let { user ->
                        user?.id?.takeIf(String::isNotBlank) ?: user?._id
                    },
                    text = text,
                    createdAt = java.time.Instant.now().toString(),
                    clientMessageId = clientMessageId,
                    sending = true,
                ),
            )
            binding.messagesRecycler.scrollToPosition(adapter.itemCount - 1)
        } else {
            adapter.markSending(clientMessageId)
        }
        setComposerEnabled(false)
        stopTyping()
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.sendMessage(
                    id,
                    MessageCreateRequest(text, clientMessageId),
                )
                val message = response.body()?.message
                if (!response.isSuccessful || message == null) {
                    throw IOException(apiErrorMessage(response, getString(R.string.chat_failed)))
                }
                adapter.addMessage(message)
                if (retry == null) {
                    binding.messageInput.text?.clear()
                    persistDraft("")
                }
                binding.messagesRecycler.scrollToPosition(adapter.itemCount - 1)
            } catch (exception: CancellationException) {
                adapter.updateFailed(clientMessageId)
                throw exception
            } catch (exception: Exception) {
                adapter.updateFailed(clientMessageId)
                Toast.makeText(
                    requireContext(),
                    exception.message ?: getString(R.string.chat_failed),
                    Toast.LENGTH_SHORT,
                ).show()
            } finally {
                setComposerEnabled(true)
            }
        }
    }

    private fun retryMessage(message: MessageResponse) {
        if (message.failed) sendMessage(message)
    }

    private fun connectRealtime() {
        if (realtimeSocket != null) return
        val session = SecureTokenStore(requireContext()).readSession()
        val token = session?.accessToken?.takeIf(String::isNotBlank) ?: return
        val endpoint = Uri.parse(BuildConfig.API_BASE_URL)
            .buildUpon()
            .path("/")
            .clearQuery()
            .fragment(null)
            .build()
            .toString()
        val options = IO.Options().apply {
            auth = mapOf("token" to token)
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
                runOnMainThread(socket) {
                    conversationId?.let { socket.emit("conversation:join", it) }
                    loadMessages()
                }
            }
            socket.on("message:new") { args ->
                val payload = args.firstOrNull() as? JSONObject ?: return@on
                handleSocketMessage(socket, payload)
            }
            socket.on("message:sent") { args ->
                val payload = args.firstOrNull() as? JSONObject ?: return@on
                handleSocketMessage(socket, payload)
            }
            socket.on("message:delivered") { args ->
                val payload = args.firstOrNull() as? JSONObject ?: return@on
                if (payload.optString("conversationId") != conversationId) return@on
                val messageId = payload.optString("messageId").takeIf(String::isNotBlank) ?: return@on
                runOnMainThread(socket) {
                    adapter.markDelivery(messageId, payload.optString("deliveredAt"))
                }
            }
            socket.on("message:read") { args ->
                val payload = args.firstOrNull() as? JSONObject ?: return@on
                if (payload.optString("conversationId") != conversationId) return@on
                val ids = payload.optJSONArray("messageIds") ?: return@on
                val messageIds = buildList {
                    for (index in 0 until ids.length()) {
                        ids.optString(index).takeIf(String::isNotBlank)?.let(::add)
                    }
                }
                runOnMainThread(socket) {
                    adapter.markRead(messageIds, payload.optString("readAt"))
                }
            }
            socket.on("typing:start") { args ->
                val payload = args.firstOrNull() as? JSONObject ?: return@on
                if (payload.optString("conversationId") == conversationId &&
                    payload.optString("userId") != currentUserId()
                ) {
                    runOnMainThread(socket) { binding.chatPresence.text = getString(R.string.typing_indicator) }
                }
            }
            socket.on("typing:stop") { args ->
                val payload = args.firstOrNull() as? JSONObject ?: return@on
                if (payload.optString("conversationId") == conversationId) {
                    runOnMainThread(socket) {
                        binding.chatPresence.text = getString(R.string.message_status_generic)
                    }
                }
            }
            socket.on(Socket.EVENT_CONNECT_ERROR) { args ->
                val message = args.firstOrNull()?.toString().orEmpty()
                if (message.contains("authentication required", ignoreCase = true) ||
                    message.contains("expired", ignoreCase = true)
                ) {
                    refreshSocketAuthentication(socket)
                } else {
                    Log.w(TAG, "Chat real-time connection unavailable.")
                }
            }
            socket.connect()
        } catch (exception: Exception) {
            realtimeSocket = null
            Log.w(TAG, "Could not start chat real-time connection.")
        }
    }

    private fun handleSocketMessage(socket: Socket, payload: JSONObject) {
        if (payload.optString("conversationId") != conversationId) return
        val messageJson = payload.optJSONObject("message") ?: return
        val message = try {
            gson.fromJson(messageJson.toString(), MessageResponse::class.java)
        } catch (_: Exception) {
            return
        } ?: return
        runOnMainThread(socket) {
            adapter.addMessage(message)
            if (message.senderId != currentUserId()) {
                val id = message.id
                if (!id.isNullOrBlank()) {
                    socket.emit(
                        "message:delivered",
                        JSONObject().put("conversationId", conversationId).put("messageId", id),
                    )
                }
                markConversationRead(conversationId.orEmpty())
                binding.messagesRecycler.scrollToPosition(adapter.itemCount - 1)
            }
        }
    }

    private fun refreshSocketAuthentication(socket: Socket) {
        if (refreshingSocketAuth || realtimeSocket !== socket) return
        refreshingSocketAuth = true
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.getMyProfile()
                if (!response.isSuccessful || response.body()?.user == null) {
                    throw IOException("Session refresh failed.")
                }
                closeRealtime()
                connectRealtime()
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                closeRealtime()
            } finally {
                refreshingSocketAuth = false
            }
        }
    }

    private fun updateTypingState(isTyping: Boolean) {
        val socket = realtimeSocket ?: return
        val id = conversationId ?: return
        if (!socket.connected()) return
        if (isTyping && !typingSent) {
            typingSent = true
            socket.emit("typing:start", id)
        }
        typingJob?.cancel()
        if (!isTyping) {
            stopTyping()
        } else {
            typingJob = viewLifecycleOwner.lifecycleScope.launch {
                delay(TYPING_STOP_DELAY_MS)
                stopTyping()
            }
        }
    }

    private fun stopTyping() {
        typingJob?.cancel()
        typingJob = null
        val socket = realtimeSocket
        val id = conversationId
        if (typingSent && socket?.connected() == true && !id.isNullOrBlank()) {
            socket.emit("typing:stop", id)
        }
        typingSent = false
    }

    private fun currentUserId(): String? =
        SecureTokenStore(requireContext()).readSession()?.currentUser.let { user ->
            user?.id?.takeIf(String::isNotBlank) ?: user?._id
        }

    private fun runOnMainThread(socket: Socket, action: () -> Unit) {
        val activity = activity ?: return
        activity.runOnUiThread {
            if (realtimeSocket === socket && _binding != null) action()
        }
    }

    private fun setComposerEnabled(enabled: Boolean) {
        _binding?.let { current ->
            current.sendMessageButton.isEnabled = enabled
            current.messageInput.isEnabled = enabled
        }
    }

    private fun showConversationMenu() {
        val username = participantUsername?.takeIf(String::isNotBlank) ?: return
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.message_menu_title)
            .setItems(arrayOf(getString(R.string.copy_username))) { _, _ ->
                val clipboard = requireContext().getSystemService(Context.CLIPBOARD_SERVICE)
                    as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("username", "@$username"))
                Toast.makeText(requireContext(), R.string.username_copied, Toast.LENGTH_SHORT).show()
            }
            .show()
    }

    private fun openParticipantProfile() {
        val id = participantId ?: return
        findNavController().navigate(
            R.id.profileDetailFragment,
            Bundle().apply { putString(ARG_PROFILE_USER_ID, id) },
        )
    }

    private fun draftPreferences() = requireContext().getSharedPreferences(DRAFT_PREFERENCES, 0)

    private fun draftKey(): String? {
        val conversation = conversationId ?: return null
        val user = currentUserId() ?: return null
        return "$user:$conversation"
    }

    private fun restoreDraft() {
        val key = draftKey() ?: return
        val draft = draftPreferences().getString(key, null) ?: return
        binding.messageInput.setText(draft)
        binding.messageInput.setSelection(draft.length)
    }

    private fun persistDraft(text: String) {
        val key = draftKey() ?: return
        draftPreferences().edit().putString(key, text).apply()
    }

    private fun showFailure(message: String = getString(R.string.chat_failed)) {
        binding.chatState.text = message
        binding.chatState.visibility = View.VISIBLE
        binding.chatState.setOnClickListener { loadMessages() }
    }

    private fun closeRealtime() {
        val socket = realtimeSocket ?: return
        stopTyping()
        conversationId?.let { socket.emit("conversation:leave", it) }
        realtimeSocket = null
        socket.off()
        socket.disconnect()
        socket.close()
    }

    override fun onDestroyView() {
        closeRealtime()
        _binding = null
        super.onDestroyView()
    }

    private companion object {
        const val TAG = "ChatFragment"
        const val ARG_CONVERSATION_ID = "conversationId"
        const val ARG_PARTICIPANT_ID = "participantId"
        const val ARG_PARTICIPANT_NAME = "participantName"
        const val ARG_PARTICIPANT_USERNAME = "participantUsername"
        const val ARG_PARTICIPANT_AVATAR = "participantAvatar"
        const val ARG_PROFILE_USER_ID = "userId"
        const val DRAFT_PREFERENCES = "message_drafts"
        const val MESSAGE_PAGE_SIZE = 30
        const val PAGINATION_THRESHOLD = 1
        const val TYPING_STOP_DELAY_MS = 1_800L
        const val SOCKET_RECONNECT_DELAY_MS = 1_000L
        const val SOCKET_RECONNECT_MAX_DELAY_MS = 10_000L
        val CIRCULAR_OUTLINE = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                outline.setOval(0, 0, view.width, view.height)
            }
        }
    }
}
