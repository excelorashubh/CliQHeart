package com.cliqheart.app.feature.home.adapters

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.view.doOnLayout
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.databinding.ItemGridPostBinding
import com.cliqheart.app.feature.home.models.PostModel

class GridPostsAdapter(
    private val posts: List<PostModel>,
    private val onPostClick: (PostModel) -> Unit,
) : RecyclerView.Adapter<GridPostsAdapter.GridPostViewHolder>() {

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
            root.setOnClickListener {
                onPostClick(post)
            }
        }
    }

    override fun getItemCount(): Int = posts.size
}
