package com.cliqheart.app.feature.home.adapters

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.core.network.ConversationResponse
import com.cliqheart.app.databinding.ItemConversationBinding

class ConversationAdapter(
    private val onSelected: (ConversationResponse) -> Unit,
) : RecyclerView.Adapter<ConversationAdapter.ConversationViewHolder>() {
    private val conversations = mutableListOf<ConversationResponse>()

    fun submitConversations(results: List<ConversationResponse>) {
        conversations.clear()
        conversations.addAll(results)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ConversationViewHolder {
        return ConversationViewHolder(
            ItemConversationBinding.inflate(LayoutInflater.from(parent.context), parent, false),
            onSelected,
        )
    }

    override fun onBindViewHolder(holder: ConversationViewHolder, position: Int) {
        holder.bind(conversations[position])
    }

    override fun getItemCount(): Int = conversations.size

    class ConversationViewHolder(
        private val binding: ItemConversationBinding,
        private val onSelected: (ConversationResponse) -> Unit,
    ) : RecyclerView.ViewHolder(binding.root) {
        fun bind(conversation: ConversationResponse) {
            val user = conversation.participant
            binding.conversationName.text = user?.displayName ?: user?.username?.let { "@$it" } ?: "Conversation"
            binding.conversationPreview.text = conversation.lastMessage?.text.orEmpty()
            binding.root.setOnClickListener { onSelected(conversation) }
        }
    }
}
