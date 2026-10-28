package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.databinding.FragmentMessagesBinding
import com.cliqheart.app.feature.home.apiErrorMessage
import com.cliqheart.app.feature.home.adapters.ConversationAdapter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class MessagesFragment : Fragment() {
    private var _binding: FragmentMessagesBinding? = null
    private val binding get() = requireNotNull(_binding)
    private lateinit var adapter: ConversationAdapter

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        _binding = FragmentMessagesBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        adapter = ConversationAdapter { conversation ->
            val id = conversation.id ?: return@ConversationAdapter
            findNavController().navigate(
                R.id.chatFragment,
                Bundle().apply { putString(ARG_CONVERSATION_ID, id) },
            )
        }
        binding.conversationsRecycler.layoutManager = LinearLayoutManager(requireContext())
        binding.conversationsRecycler.adapter = adapter
        loadConversations()
    }

    private fun loadConversations() {
        binding.messagesState.text = getString(R.string.loading_messages)
        binding.messagesState.visibility = View.VISIBLE
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.getConversations()
                if (!response.isSuccessful) {
                    showFailure(apiErrorMessage(response, getString(R.string.messages_failed)))
                    return@launch
                }
                val conversations = response.body()?.conversations.orEmpty()
                adapter.submitConversations(conversations)
                binding.messagesState.visibility = if (conversations.isEmpty()) View.VISIBLE else View.GONE
                if (conversations.isEmpty()) binding.messagesState.text = getString(R.string.messages_empty)
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                showFailure()
            }
        }
    }

    private fun showFailure(message: String = getString(R.string.messages_failed)) {
        binding.messagesState.text = message
        binding.messagesState.visibility = View.VISIBLE
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    private companion object {
        const val ARG_CONVERSATION_ID = "conversationId"
    }
}
