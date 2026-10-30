package com.cliqheart.app.feature.home.adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.R
import com.cliqheart.app.databinding.ItemStoryBinding
import com.cliqheart.app.feature.home.RemoteImageLoader
import com.cliqheart.app.feature.home.models.StoryModel

class StoriesAdapter(
    private val onStoryClick: (StoryModel) -> Unit,
) : RecyclerView.Adapter<StoriesAdapter.StoryViewHolder>() {
    private val stories = mutableListOf<StoryModel>()

    inner class StoryViewHolder(val binding: ItemStoryBinding) :
        RecyclerView.ViewHolder(binding.root)

    fun submitStories(items: List<StoryModel>) {
        stories.clear()
        stories.addAll(items)
        notifyDataSetChanged()
    }

    fun markViewed(ownerId: String) {
        val index = stories.indexOfFirst { it.ownerId == ownerId }
        if (index < 0) return
        stories[index] = stories[index].copy(hasNewStory = false)
        notifyItemChanged(index)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): StoryViewHolder {
        val binding = ItemStoryBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false,
        )
        return StoryViewHolder(binding)
    }

    override fun onBindViewHolder(holder: StoryViewHolder, position: Int) {
        val story = stories[position]
        with(holder.binding) {
            storyUsername.text = story.username
            storyUsername.contentDescription = if (story.isYourStory) {
                root.context.getString(R.string.your_story)
            } else {
                root.context.getString(R.string.story_by_user, story.username)
            }
            addStoryBadge.visibility = if (story.isYourStory) View.VISIBLE else View.GONE
            storyRingFrame.background = when {
                story.hasNewStory && !story.isYourStory -> root.context.getDrawable(R.drawable.bg_story_ring)
                story.storyIds.isNotEmpty() && !story.isYourStory ->
                    root.context.getDrawable(R.drawable.bg_story_ring_viewed)
                else -> null
            }
            RemoteImageLoader.load(storyAvatar, story.avatarUrl, R.drawable.ic_profile)

            root.setOnClickListener {
                onStoryClick(story)
            }
        }
    }

    override fun getItemCount(): Int = stories.size
}
