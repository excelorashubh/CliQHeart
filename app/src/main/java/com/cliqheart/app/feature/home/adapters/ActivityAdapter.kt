package com.cliqheart.app.feature.home.adapters

import android.text.SpannableString
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StyleSpan
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.R
import com.cliqheart.app.databinding.ItemActivityBinding
import com.cliqheart.app.feature.home.RemoteImageLoader
import com.cliqheart.app.feature.home.models.ActivityItemModel

class ActivityAdapter(
    private val onFollowClick: (ActivityItemModel) -> Unit,
    private val onItemClick: (ActivityItemModel) -> Unit,
) : RecyclerView.Adapter<ActivityAdapter.ActivityViewHolder>() {
    private val items = mutableListOf<ActivityItemModel>()

    class ActivityViewHolder(val binding: ItemActivityBinding) :
        RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ActivityViewHolder {
        val binding = ItemActivityBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false,
        )
        return ActivityViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ActivityViewHolder, position: Int) {
        val item = items[position]
        with(holder.binding) {
            val ssb = SpannableStringBuilder()
            val userSpannable = SpannableString(item.username + " ")
            userSpannable.setSpan(
                StyleSpan(android.graphics.Typeface.BOLD),
                0,
                userSpannable.length,
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
            ssb.append(userSpannable)
            ssb.append(item.actionText)
            ssb.append("  ").append(item.timeAgo)
            activityText.text = ssb

            if (item.isFollowAction) {
                activityFollowButton.visibility = View.VISIBLE
                activityFollowButton.setOnClickListener { onFollowClick(item) }
                activityPostThumbnail.visibility = View.GONE
            } else {
                activityFollowButton.visibility = View.GONE
                activityFollowButton.setOnClickListener(null)
                activityPostThumbnail.visibility = if (item.postImageUrl != null) View.VISIBLE else View.GONE
            }
            RemoteImageLoader.load(activityAvatar, item.avatarUrl, R.drawable.ic_profile)
            item.postImageUrl?.let {
                RemoteImageLoader.load(activityPostThumbnail, it, R.drawable.ic_cliqheart_logo)
            }

            root.setOnClickListener {
                onItemClick(item)
            }
        }
    }

    override fun getItemCount(): Int = items.size

    fun submitItems(nextItems: List<ActivityItemModel>, append: Boolean = false) {
        if (!append) items.clear()
        val knownIds = items.mapTo(mutableSetOf()) { it.id }
        items.addAll(nextItems.filter { it.id !in knownIds })
        notifyDataSetChanged()
    }

    fun markFollowed(itemId: String) {
        val index = items.indexOfFirst { it.id == itemId }
        if (index < 0) return
        items[index] = items[index].copy(isFollowAction = false)
        notifyItemChanged(index)
    }

    fun markRead(itemId: String) {
        val index = items.indexOfFirst { it.id == itemId }
        if (index < 0 || items[index].isRead) return
        items[index] = items[index].copy(isRead = true)
        notifyItemChanged(index)
    }
}
