package com.cliqheart.app.feature.home.adapters

import android.view.LayoutInflater
import android.view.ViewGroup
import android.view.View
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.databinding.ItemHomeFeedHeaderBinding
import com.cliqheart.app.feature.home.models.StoryModel

class HomeFeedHeaderAdapter(
    private val onFeedRetry: () -> Unit,
    private val onStoryClick: (StoryModel) -> Unit,
    private val onStoriesRetry: () -> Unit,
) : RecyclerView.Adapter<HomeFeedHeaderAdapter.HeaderViewHolder>() {
    private var feedStateMessage: String? = null
    private var stories: List<StoryModel> = emptyList()
    private var storiesStateMessage: String? = null
    private var storiesLoading = false
    private var storiesAdapter: StoriesAdapter? = null

    class HeaderViewHolder(val binding: ItemHomeFeedHeaderBinding) :
        RecyclerView.ViewHolder(binding.root)

    fun setFeedState(message: String?) {
        feedStateMessage = message
        notifyItemChanged(0)
    }

    fun setStories(
        items: List<StoryModel>,
        stateMessage: String? = null,
        loading: Boolean = false,
    ) {
        stories = items
        storiesStateMessage = stateMessage
        storiesLoading = loading
        storiesAdapter?.submitStories(items, loading)
        notifyItemChanged(0)
    }

    fun setStoriesState(message: String) {
        storiesStateMessage = message
        storiesLoading = true
        storiesAdapter?.submitStories(stories, loading = true)
        notifyItemChanged(0)
    }

    fun markStoryViewed(ownerId: String) {
        storiesAdapter?.markViewed(ownerId)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): HeaderViewHolder {
        val binding = ItemHomeFeedHeaderBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false,
        )
        return HeaderViewHolder(binding)
    }

    override fun onBindViewHolder(holder: HeaderViewHolder, position: Int) {
        with(holder.binding) {
            storiesRecyclerView.layoutManager = LinearLayoutManager(
                root.context,
                LinearLayoutManager.HORIZONTAL,
                false,
            )
            storiesAdapter ?: StoriesAdapter(onStoryClick).also {
                storiesAdapter = it
                storiesRecyclerView.adapter = it
                it.submitStories(stories, storiesLoading)
            }
            storiesRecyclerView.visibility = View.VISIBLE
            val hasOtherStories = stories.any { !it.isYourStory }
            val emptyMessage = storiesStateMessage ?: if (!hasOtherStories && !storiesLoading) {
                root.context.getString(com.cliqheart.app.R.string.stories_empty)
            } else {
                null
            }
            storiesEmptyState.visibility = if (emptyMessage == null) View.GONE else View.VISIBLE
            storiesEmptyState.text = emptyMessage.orEmpty()
            storiesEmptyState.setOnClickListener { onStoriesRetry() }
            feedState.text = feedStateMessage.orEmpty()
            feedState.visibility = if (feedStateMessage == null) {
                View.GONE
            } else {
                View.VISIBLE
            }
            feedState.setOnClickListener { onFeedRetry() }
        }
    }

    override fun getItemCount(): Int = 1
}
