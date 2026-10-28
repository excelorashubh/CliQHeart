package com.cliqheart.app.feature.home.adapters

import android.view.Gravity
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.core.network.MessageResponse
import com.cliqheart.app.databinding.ItemMessageBinding

class MessageAdapter(
    private val currentUserId: String?,
) : RecyclerView.Adapter<MessageAdapter.MessageViewHolder>() {
    private val messages = mutableListOf<MessageResponse>()

    fun submitMessages(results: List<MessageResponse>) {
        messages.clear()
        messages.addAll(results)
        notifyDataSetChanged()
    }

    fun addMessage(message: MessageResponse) {
        messages.add(message)
        notifyItemInserted(messages.lastIndex)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MessageViewHolder {
        return MessageViewHolder(ItemMessageBinding.inflate(LayoutInflater.from(parent.context), parent, false))
    }

    override fun onBindViewHolder(holder: MessageViewHolder, position: Int) {
        holder.bind(messages[position], currentUserId)
    }

    override fun getItemCount(): Int = messages.size

    class MessageViewHolder(private val binding: ItemMessageBinding) : RecyclerView.ViewHolder(binding.root) {
        fun bind(message: MessageResponse, currentUserId: String?) {
            binding.messageText.text = message.text.orEmpty()
            binding.messageText.gravity =
                if (message.senderId == currentUserId) Gravity.END else Gravity.START
        }
    }
}
