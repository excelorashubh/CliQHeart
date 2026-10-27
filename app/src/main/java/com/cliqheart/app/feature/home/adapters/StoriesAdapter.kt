package com.cliqheart.app.feature.home.adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.databinding.ItemStoryBinding
import com.cliqheart.app.feature.home.models.StoryModel

class StoriesAdapter(
    private val stories: List<StoryModel>,
    private val onStoryClick: (StoryModel) -> Unit,
) : RecyclerView.Adapter<StoriesAdapter.StoryViewHolder>() {

    inner class StoryViewHolder(val binding: ItemStoryBinding) :
        RecyclerView.ViewHolder(binding.root)

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
            addStoryBadge.visibility = if (story.isYourStory) View.VISIBLE else View.GONE
            storyRingFrame.alpha = if (story.hasNewStory || story.isYourStory) 1.0f else 0.5f

            root.setOnClickListener {
                onStoryClick(story)
            }
        }
    }

    override fun getItemCount(): Int = stories.size
}
