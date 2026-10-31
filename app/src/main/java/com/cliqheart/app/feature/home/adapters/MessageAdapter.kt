package com.cliqheart.app.feature.home.adapters

import android.view.Gravity
import android.view.LayoutInflater
import android.widget.LinearLayout
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.R
import com.cliqheart.app.core.network.MessageResponse
import com.cliqheart.app.databinding.ItemMessageBinding
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

class MessageAdapter(
    private val currentUserId: String?,
    private val onRetry: (MessageResponse) -> Unit,
) : RecyclerView.Adapter<MessageAdapter.MessageViewHolder>() {
    private val messages = mutableListOf<MessageResponse>()

    fun submitMessages(results: List<MessageResponse>) {
        messages.clear()
        results.forEach(::upsert)
        notifyDataSetChanged()
    }

    fun addMessage(message: MessageResponse) {
        val oldPosition = findMessage(message)
        if (oldPosition >= 0) {
            messages[oldPosition] = merge(messages[oldPosition], message)
            notifyItemChanged(oldPosition)
        } else {
            messages.add(message)
            notifyItemInserted(messages.lastIndex)
        }

    }

    fun messagesSnapshot(): List<MessageResponse> = messages.toList()

    fun markDelivery(messageId: String, deliveredAt: String?, readAt: String? = null) {
        update(messageId) { it.copy(deliveredAt = deliveredAt ?: it.deliveredAt, readAt = readAt ?: it.readAt) }
    }

    fun markRead(messageIds: List<String>, readAt: String?) {
        messageIds.forEach { id -> update(id) { it.copy(readAt = readAt ?: it.readAt) } }
    }

    fun updateFailed(clientMessageId: String) {
        val index = messages.indexOfFirst { it.clientMessageId == clientMessageId }
        if (index < 0) return
        messages[index] = messages[index].copy(sending = false, failed = true)
        notifyItemChanged(index)
    }

    fun markSending(clientMessageId: String) {
        val index = messages.indexOfFirst { it.clientMessageId == clientMessageId }
        if (index < 0) return
        messages[index] = messages[index].copy(sending = true, failed = false)
        notifyItemChanged(index)
    }

    private fun update(messageId: String, transform: (MessageResponse) -> MessageResponse) {
        val index = messages.indexOfFirst { it.id == messageId }
        if (index < 0) return
        messages[index] = transform(messages[index])
        notifyItemChanged(index)
    }

    private fun upsert(message: MessageResponse) {
        val index = findMessage(message)
        if (index >= 0) messages[index] = merge(messages[index], message) else messages.add(message)
    }

    private fun findMessage(message: MessageResponse): Int = messages.indexOfFirst {
        (message.id != null && it.id == message.id) ||
            (message.clientMessageId != null && it.clientMessageId == message.clientMessageId)
    }

    private fun merge(local: MessageResponse, server: MessageResponse): MessageResponse =
        server.copy(
            clientMessageId = server.clientMessageId ?: local.clientMessageId,
            sending = false,
            failed = false,
        )

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MessageViewHolder =
        MessageViewHolder(
            ItemMessageBinding.inflate(LayoutInflater.from(parent.context), parent, false),
            onRetry,
        )

    override fun onBindViewHolder(holder: MessageViewHolder, position: Int) {
        val previous = messages.getOrNull(position - 1)
        holder.bind(messages[position], previous, currentUserId)
    }

    override fun getItemCount(): Int = messages.size

    class MessageViewHolder(
        private val binding: ItemMessageBinding,
        private val onRetry: (MessageResponse) -> Unit,
    ) : RecyclerView.ViewHolder(binding.root) {
        fun bind(message: MessageResponse, previous: MessageResponse?, currentUserId: String?) {
            val context = binding.root.context
            val outgoing = message.senderId == currentUserId
            val date = localDate(message.createdAt)
            val previousDate = localDate(previous?.createdAt)
            binding.messageDateSeparator.visibility =
                if (date != null && date != previousDate) View.VISIBLE else View.GONE
            binding.messageDateSeparator.text = date?.format(DATE_FORMATTER).orEmpty()
            binding.messageBubble.layoutParams =
                (binding.messageBubble.layoutParams as LinearLayout.LayoutParams).apply {
                    gravity = if (outgoing) Gravity.END else Gravity.START
                    width = (context.resources.displayMetrics.widthPixels * MAX_BUBBLE_WIDTH_FRACTION)
                        .toInt()
                }
            binding.messageBubble.setBackgroundResource(
                if (outgoing) R.drawable.bg_message_outgoing else R.drawable.bg_message_incoming,
            )
            binding.messageBubble.gravity = if (outgoing) Gravity.END else Gravity.START
            binding.messageText.text = message.text.orEmpty()
            binding.messageTimestamp.text = formatTime(message.createdAt)
            binding.messageStatus.visibility = if (outgoing && !message.failed) View.VISIBLE else View.GONE
            binding.messageStatus.text = when {
                message.sending -> context.getString(R.string.message_sending)
                message.readAt != null -> context.getString(R.string.message_read)
                message.deliveredAt != null -> context.getString(R.string.message_delivered)
                outgoing -> context.getString(R.string.message_sent)
                else -> ""
            }
            binding.messageRetry.visibility = if (message.failed) View.VISIBLE else View.GONE
            binding.messageRetry.setOnClickListener { onRetry(message) }
        }
    }

    private companion object {
        const val MAX_BUBBLE_WIDTH_FRACTION = 0.78f
        val DATE_FORMATTER = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.getDefault())
        val TIME_FORMATTER = DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault())
    }
}

private fun localDate(value: String?): LocalDate? {
    if (value.isNullOrBlank()) return null
    return try {
        Instant.parse(value).atZone(ZoneId.systemDefault()).toLocalDate()
    } catch (_: DateTimeParseException) {
        null
    }
}

private fun formatTime(value: String?): String {
    if (value.isNullOrBlank()) return ""
    return try {
        Instant.parse(value).atZone(ZoneId.systemDefault()).format(
            DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault()),
        )
    } catch (_: DateTimeParseException) {
        ""
    }
}
