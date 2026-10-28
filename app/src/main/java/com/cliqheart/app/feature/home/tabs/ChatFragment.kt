package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.MessageCreateRequest
import com.cliqheart.app.core.security.SecureTokenStore
import com.cliqheart.app.databinding.FragmentChatBinding
import com.cliqheart.app.feature.home.adapters.MessageAdapter
import com.cliqheart.app.feature.home.apiErrorMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class ChatFragment : Fragment() {
    private var _binding: FragmentChatBinding? = null
    private val binding get() = requireNotNull(_binding)
    private var conversationId: String? = null
    private lateinit var adapter: MessageAdapter

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        _binding = FragmentChatBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        conversationId = arguments?.getString(ARG_CONVERSATION_ID)
        adapter = MessageAdapter(SecureTokenStore(requireContext()).readSession()?.currentUser?.id)
        binding.messagesRecycler.layoutManager = LinearLayoutManager(requireContext()).apply {
            stackFromEnd = true
        }
        binding.messagesRecycler.adapter = adapter
        binding.sendMessageButton.setOnClickListener { sendMessage() }
        binding.messageInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                sendMessage()
                true
            } else {
                false
            }
        }
        loadMessages()
    }

    private fun loadMessages() {
        val id = conversationId
        if (id.isNullOrBlank()) {
            showFailure()
            return
        }
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.getMessages(id)
                if (!response.isSuccessful) {
                    showFailure(apiErrorMessage(response, getString(R.string.chat_failed)))
                    return@launch
                }
                val messages = response.body()?.messages.orEmpty()
                adapter.submitMessages(messages)
                binding.chatState.visibility = View.GONE
                if (messages.isNotEmpty()) binding.messagesRecycler.scrollToPosition(messages.lastIndex)
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                showFailure()
            }
        }
    }

    private fun sendMessage() {
        val id = conversationId ?: return
        val text = binding.messageInput.text?.toString()?.trim().orEmpty()
        if (text.isEmpty()) return
        binding.sendMessageButton.isEnabled = false
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.sendMessage(id, MessageCreateRequest(text))
                val message = response.body()?.message
                if (!response.isSuccessful || message == null) {
                    Toast.makeText(
                        requireContext(),
                        apiErrorMessage(response, getString(R.string.chat_failed)),
                        Toast.LENGTH_SHORT,
                    ).show()
                    return@launch
                }
                adapter.addMessage(message)
                binding.messageInput.setText("")
                binding.messagesRecycler.scrollToPosition(adapter.itemCount - 1)
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                Toast.makeText(requireContext(), R.string.chat_failed, Toast.LENGTH_SHORT).show()
            } finally {
                if (_binding != null) binding.sendMessageButton.isEnabled = true
            }
        }
    }

    private fun showFailure(message: String = getString(R.string.chat_failed)) {
        binding.chatState.text = message
        binding.chatState.visibility = View.VISIBLE
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    private companion object {
        const val ARG_CONVERSATION_ID = "conversationId"
    }
}
