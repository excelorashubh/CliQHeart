package com.cliqheart.app.feature.home.adapters

import android.graphics.Rect
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.view.doOnLayout
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.R
import com.cliqheart.app.core.network.PostResponse
import com.cliqheart.app.databinding.ItemExploreTileBinding
import com.cliqheart.app.feature.home.RemoteImageLoader

data class ExploreTile(val content: PostResponse, val contentType: String) {
    val key: String get() = "$contentType:${content.id.orEmpty()}"
    val videoUrl: String?
        get() = content.media?.takeIf { it.resourceType == "video" }?.secureUrl
    val thumbnailUrl: String?
        get() = content.media?.let { media ->
            if (media.resourceType == "video") {
                media.thumbnailUrl
            } else {
                media.thumbnailUrl?.takeIf(String::isNotBlank)
                    ?: media.secureUrl?.takeIf(String::isNotBlank)
            }
        }
}

class ExploreGridAdapter(
    private val onTileClick: (ExploreTile) -> Unit,
    private val onCandidatesChanged: () -> Unit,
    private val onThumbnailResult: (ExploreTile, Boolean) -> Unit,
) : RecyclerView.Adapter<ExploreGridAdapter.TileViewHolder>() {
    private val items = mutableListOf<ExploreTile>()
    private val attachedHolders = mutableSetOf<TileViewHolder>()
    private val reportedThumbnailKeys = mutableSetOf<String>()

    data class PreviewTarget(
        val item: ExploreTile,
        val visibleFraction: Float,
        val thumbnailLoaded: Boolean,
    )

    class TileViewHolder(val binding: ItemExploreTileBinding) :
        RecyclerView.ViewHolder(binding.root) {
        var boundItem: ExploreTile? = null
        var thumbnailLoaded = false
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): TileViewHolder {
        val binding = ItemExploreTileBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false,
        )
        return TileViewHolder(binding)
    }

    override fun onBindViewHolder(holder: TileViewHolder, position: Int) {
        val item = items[position]
        holder.boundItem = item
        holder.thumbnailLoaded = false
        with(holder.binding) {
            root.doOnLayout { tile ->
                val targetHeight = (tile.width * TILE_HEIGHT_RATIO).toInt()
                if (tile.width > 0 && tile.layoutParams.height != targetHeight) {
                    tile.layoutParams = tile.layoutParams.apply { height = targetHeight }
                }
            }
            explorePreviewContainer.removeAllViews()
            explorePreviewContainer.visibility = View.GONE
            explorePlayIndicator.visibility = if (item.videoUrl.isNullOrBlank()) View.GONE else View.VISIBLE
            exploreReelBadge.visibility = if (item.contentType == "reel") View.VISIBLE else View.GONE
            val creatorName = item.content.owner?.displayName?.takeIf(String::isNotBlank)
                ?: item.content.owner?.username?.takeIf(String::isNotBlank)?.let { "@$it" }
            exploreCreator.text = creatorName
            exploreCreator.visibility = if (creatorName == null) View.GONE else View.VISIBLE
            root.contentDescription = root.context.getString(
                if (item.contentType == "reel") R.string.explore_reel_content
                else if (item.videoUrl != null) R.string.explore_video_content
                else R.string.explore_image_content,
            )
            root.setOnClickListener { onTileClick(item) }
            RemoteImageLoader.load(
                exploreThumbnail,
                item.thumbnailUrl,
                R.drawable.ic_cliqheart_logo,
            ) { bitmap ->
                if (holder.boundItem?.key == item.key) {
                    holder.thumbnailLoaded = bitmap != null
                    if (reportedThumbnailKeys.add(item.key)) {
                        onThumbnailResult(item, bitmap != null)
                    }
                    onCandidatesChanged()
                }
            }
        }
    }

    override fun onViewAttachedToWindow(holder: TileViewHolder) {
        super.onViewAttachedToWindow(holder)
        attachedHolders += holder
        onCandidatesChanged()
    }

    override fun onViewDetachedFromWindow(holder: TileViewHolder) {
        attachedHolders -= holder
        super.onViewDetachedFromWindow(holder)
        onCandidatesChanged()
    }

    override fun onViewRecycled(holder: TileViewHolder) {
        attachedHolders -= holder
        holder.boundItem = null
        holder.thumbnailLoaded = false
        holder.binding.explorePreviewContainer.removeAllViews()
        holder.binding.explorePreviewContainer.visibility = View.GONE
        super.onViewRecycled(holder)
    }

    override fun getItemCount(): Int = items.size

    fun submitItems(nextItems: List<ExploreTile>, append: Boolean = false) {
        if (!append) items.clear()
        val existingKeys = items.mapTo(mutableSetOf()) { it.key }
        items.addAll(nextItems.filter { existingKeys.add(it.key) })
        notifyDataSetChanged()
        onCandidatesChanged()
    }

    fun visibleVideoTargets(): List<PreviewTarget> = attachedHolders.mapNotNull { holder ->
        val item = holder.boundItem ?: return@mapNotNull null
        if (item.videoUrl.isNullOrBlank() || holder.binding.root.height <= 0) return@mapNotNull null
        val visibleBounds = Rect()
        val tile = holder.binding.root
        if (!tile.getGlobalVisibleRect(visibleBounds)) return@mapNotNull null
        val visibleFraction =
            (visibleBounds.width().toFloat() / tile.width.coerceAtLeast(1)) *
                (visibleBounds.height().toFloat() / tile.height.coerceAtLeast(1))
        PreviewTarget(
            item = item,
            visibleFraction = visibleFraction,
            thumbnailLoaded = holder.thumbnailLoaded,
        ).takeIf { visibleFraction >= MIN_VISIBLE_FRACTION }
    }

    fun showPreview(itemKey: String, playerView: View) {
        val holder = attachedHolders.firstOrNull { it.boundItem?.key == itemKey } ?: return
        val binding = holder.binding
        (playerView.parent as? ViewGroup)?.removeView(playerView)
        binding.explorePreviewContainer.removeAllViews()
        binding.explorePreviewContainer.addView(
            playerView,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        binding.explorePreviewContainer.visibility = View.VISIBLE
        binding.explorePlayIndicator.visibility = View.GONE
    }

    fun clearPreviews(playerView: View) {
        (playerView.parent as? ViewGroup)?.removeView(playerView)
        attachedHolders.forEach { holder ->
            holder.binding.explorePreviewContainer.removeAllViews()
            holder.binding.explorePreviewContainer.visibility = View.GONE
            if (holder.boundItem?.videoUrl != null) {
                holder.binding.explorePlayIndicator.visibility = View.VISIBLE
            }
        }
    }

    private companion object {
        const val TILE_HEIGHT_RATIO = 1.5f
        const val MIN_VISIBLE_FRACTION = 0.6f
    }
}
