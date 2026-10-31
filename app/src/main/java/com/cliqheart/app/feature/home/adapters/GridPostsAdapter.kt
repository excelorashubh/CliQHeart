package com.cliqheart.app.feature.home.adapters

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.view.doOnLayout
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.R
import com.cliqheart.app.core.network.PostResponse
import com.cliqheart.app.databinding.ItemGridPostBinding
import com.cliqheart.app.feature.home.RemoteImageLoader

class GridPostsAdapter(
    private val onPostClick: (PostResponse) -> Unit,
) : RecyclerView.Adapter<GridPostsAdapter.GridPostViewHolder>() {
    private val posts = mutableListOf<PostResponse>()

    class GridPostViewHolder(val binding: ItemGridPostBinding) :
        RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): GridPostViewHolder {
        val binding = ItemGridPostBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false,
        )
        return GridPostViewHolder(binding)
    }

    override fun onBindViewHolder(holder: GridPostViewHolder, position: Int) {
        val post = posts[position]
        with(holder.binding) {
            root.doOnLayout { tile ->
                if (tile.layoutParams.height != tile.width) {
                    tile.layoutParams = tile.layoutParams.apply {
                        height = tile.width
                    }
                }
            }
            val media = post.media
            val imageUrl = media?.thumbnailUrl?.takeIf(String::isNotBlank)
                ?: media?.secureUrl?.takeIf(String::isNotBlank)
            RemoteImageLoader.load(gridPostImage, imageUrl, R.drawable.ic_cliqheart_logo)
            root.setOnClickListener {
                onPostClick(post)
            }
        }
    }

    override fun getItemCount(): Int = posts.size

    fun submitPosts(nextPosts: List<PostResponse>) {
        posts.clear()
        posts.addAll(nextPosts)
        notifyDataSetChanged()
    }
}
