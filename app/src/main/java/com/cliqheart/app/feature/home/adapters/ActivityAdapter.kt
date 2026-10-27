package com.cliqheart.app.feature.home.adapters

import android.text.SpannableString
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StyleSpan
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.databinding.ItemActivityBinding
import com.cliqheart.app.feature.home.models.ActivityItemModel

class ActivityAdapter(
    private val items: List<ActivityItemModel>,
    private val onItemClick: (ActivityItemModel) -> Unit,
) : RecyclerView.Adapter<ActivityAdapter.ActivityViewHolder>() {

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
                activityPostThumbnail.visibility = View.GONE
            } else {
                activityFollowButton.visibility = View.GONE
                activityPostThumbnail.visibility = if (item.postImageUrl != null) View.VISIBLE else View.GONE
            }

            root.setOnClickListener {
                onItemClick(item)
            }
        }
    }

    override fun getItemCount(): Int = items.size
}
