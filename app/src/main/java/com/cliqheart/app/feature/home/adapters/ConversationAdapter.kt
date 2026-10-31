package com.cliqheart.app.feature.home.adapters

import android.graphics.Outline
import android.text.format.DateUtils
import android.view.LayoutInflater
import android.view.View
import android.view.ViewOutlineProvider
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ConversationResponse
import com.cliqheart.app.databinding.ItemConversationBinding
import com.cliqheart.app.feature.home.RemoteImageLoader
import java.time.Instant
import java.time.format.DateTimeParseException

class ConversationAdapter(
    private val currentUserId: String?,
    private val onSelected: (ConversationResponse) -> Unit,
) : RecyclerView.Adapter<ConversationAdapter.ConversationViewHolder>() {
    private var allConversations = emptyList<ConversationResponse>()
    private var conversations = emptyList<ConversationResponse>()

    fun submitConversations(results: List<ConversationResponse>, query: String = "") {
        allConversations = results.distinctBy { it.id }.sortedByDescending {
            parseTime(it.lastMessageAt ?: it.lastMessage?.createdAt)
        }
        filter(query)
    }

    fun appendConversations(results: List<ConversationResponse>, query: String = "") {
        allConversations = (allConversations + results)
            .distinctBy { it.id }
            .sortedByDescending { parseTime(it.lastMessageAt ?: it.lastMessage?.createdAt) }
        filter(query)
    }

    fun filter(query: String) {
        val normalized = query.trim().removePrefix("@").lowercase()
        conversations = if (normalized.isEmpty()) {
            allConversations
        } else {
            allConversations.filter { item ->
                val user = item.participant
                listOfNotNull(user?.displayName, user?.username, item.lastMessage?.text)
                    .any { it.lowercase().contains(normalized) }
            }
        }
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ConversationViewHolder =
        ConversationViewHolder(
            ItemConversationBinding.inflate(LayoutInflater.from(parent.context), parent, false),
            currentUserId,
            onSelected,
        )

    override fun onBindViewHolder(holder: ConversationViewHolder, position: Int) {
        holder.bind(conversations[position])
    }

    override fun getItemCount(): Int = conversations.size

    class ConversationViewHolder(
        private val binding: ItemConversationBinding,
        private val currentUserId: String?,
        private val onSelected: (ConversationResponse) -> Unit,
    ) : RecyclerView.ViewHolder(binding.root) {
        fun bind(conversation: ConversationResponse) {
            val context = binding.root.context
            val user = conversation.participant
            binding.conversationName.text = user?.displayName
                ?.takeIf(String::isNotBlank)
                ?: user?.username?.let { "@$it" }
                ?: context.getString(R.string.conversation)
            binding.conversationAvatar.outlineProvider = CIRCULAR_OUTLINE
            binding.conversationAvatar.clipToOutline = true
            RemoteImageLoader.load(
                binding.conversationAvatar,
                user?.avatarUrl,
                R.drawable.ic_profile,
            )
            val preview = conversation.lastMessage?.text.orEmpty()
            binding.conversationPreview.text =
                if (conversation.lastMessage?.senderId == currentUserId && preview.isNotBlank()) {
                    context.getString(R.string.last_message_you, preview)
                } else {
                    preview
                }
            binding.conversationTime.text = relativeTime(
                conversation.lastMessageAt ?: conversation.lastMessage?.createdAt,
            )
            val unreadCount = conversation.unreadCount.coerceAtLeast(0)
            binding.conversationUnread.visibility = if (unreadCount > 0) View.VISIBLE else View.GONE
            binding.conversationUnread.text = if (unreadCount > 99) "99+" else unreadCount.toString()
            binding.conversationUnread.contentDescription =
                if (unreadCount > 0) context.resources.getQuantityString(
                    R.plurals.unread_messages_count,
                    unreadCount,
                    unreadCount,
                ) else null
            binding.root.setOnClickListener { onSelected(conversation) }
        }

        private fun relativeTime(value: String?): String {
            val timestamp = parseTime(value)
            if (timestamp <= 0L) return ""
            return DateUtils.getRelativeTimeSpanString(
                timestamp,
                System.currentTimeMillis(),
                DateUtils.MINUTE_IN_MILLIS,
                DateUtils.FORMAT_ABBREV_RELATIVE,
            ).toString()
        }
    }

    private companion object {
        val CIRCULAR_OUTLINE = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                outline.setOval(0, 0, view.width, view.height)
            }
        }
    }
}

private fun parseTime(value: String?): Long {
    if (value.isNullOrBlank()) return 0L
    return try {
        Instant.parse(value).toEpochMilli()
    } catch (_: DateTimeParseException) {
        0L
    }
}
