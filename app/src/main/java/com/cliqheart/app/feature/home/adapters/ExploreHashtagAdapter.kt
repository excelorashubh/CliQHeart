package com.cliqheart.app.feature.home.adapters

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.R
import com.cliqheart.app.core.network.HashtagResponse
import com.cliqheart.app.databinding.ItemExploreHashtagBinding

class ExploreHashtagAdapter(
    private val onHashtagClick: (String) -> Unit,
) : RecyclerView.Adapter<ExploreHashtagAdapter.HashtagViewHolder>() {
    private val hashtags = mutableListOf<HashtagResponse>()

    class HashtagViewHolder(val binding: ItemExploreHashtagBinding) :
        RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): HashtagViewHolder {
        return HashtagViewHolder(
            ItemExploreHashtagBinding.inflate(LayoutInflater.from(parent.context), parent, false),
        )
    }

    override fun onBindViewHolder(holder: HashtagViewHolder, position: Int) {
        val hashtag = hashtags[position]
        val name = hashtag.name ?: hashtag.normalizedName.orEmpty()
        holder.binding.hashtagName.text = "#$name"
        holder.binding.hashtagUsage.text = hashtag.usageCount?.let {
            holder.binding.root.context.resources.getQuantityString(
                R.plurals.explore_hashtag_posts,
                it,
                it,
            )
        }.orEmpty()
        holder.binding.root.setOnClickListener { onHashtagClick(name) }
    }

    override fun getItemCount(): Int = hashtags.size

    fun submitHashtags(next: List<HashtagResponse>) {
        hashtags.clear()
        hashtags.addAll(next)
        notifyDataSetChanged()
    }
}
