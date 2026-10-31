package com.cliqheart.app.feature.home.adapters

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Outline
import android.graphics.Rect
import android.graphics.Color
import android.net.Uri
import android.text.SpannableString
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.method.LinkMovementMethod
import android.text.style.ClickableSpan
import android.text.TextPaint
import android.text.style.StyleSpan
import android.util.Log
import android.view.GestureDetector
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.PopupMenu
import androidx.core.view.doOnLayout
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.R
import com.cliqheart.app.databinding.ItemPostBinding
import com.cliqheart.app.feature.home.RemoteImageLoader
import com.cliqheart.app.feature.home.models.PostModel
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

class FeedAdapter(
    posts: List<PostModel>,
    private val onLikeClicked: (PostModel) -> Unit,
    private val onBookmarkClicked: (PostModel) -> Unit,
    private val onCommentClicked: (PostModel) -> Unit,
    private val onRepostClicked: (PostModel) -> Unit,
    private val onFollowClicked: (PostModel) -> Unit,
    private val reelsMode: Boolean = false,
) : RecyclerView.Adapter<FeedAdapter.PostViewHolder>() {
    private val posts = posts.toMutableList()
    private val expandedCaptions = mutableSetOf<String>()
    private val attachedHolders = mutableSetOf<PostViewHolder>()
    private var player: ExoPlayer? = null
    private var activeVideoHolder: PostViewHolder? = null
    private var activeContentKey: String? = null
    val postCount: Int get() = posts.size
    fun postsSnapshot(): List<PostModel> = posts.toList()

    class PostViewHolder(val binding: ItemPostBinding) : RecyclerView.ViewHolder(binding.root) {
        var boundPost: PostModel? = null
        var videoSource: String? = null
        var videoHasFrame = false
        var isMuted = true
    }

    fun submitPosts(results: List<PostModel>, append: Boolean = false) {
        if (!append) posts.clear()
        val existingKeys = posts.mapTo(mutableSetOf()) { it.contentKey }
        posts.addAll(results.filter { existingKeys.add(it.contentKey) })
        posts.sortByDescending { it.createdAtMillis }
        notifyDataSetChanged()
    }

    fun updatePost(post: PostModel) {
        val position = posts.indexOfFirst { it.contentKey == post.contentKey }
        if (position < 0) return
        posts[position] = post
        notifyItemChanged(position)
    }

    fun updateCommentCount(contentType: String, postId: String, commentCount: Int) {
        val post = posts.firstOrNull { it.contentType == contentType && it.id == postId } ?: return
        updatePost(post.copy(commentCount = commentCount))
    }

    fun updateEngagement(
        contentType: String,
        contentId: String,
        likeCount: Int,
        commentCount: Int,
        repostCount: Int,
        isLiked: Boolean?,
        isReposted: Boolean?,
    ) {
        val post = posts.firstOrNull { it.contentType == contentType && it.id == contentId } ?: return
        updatePost(
            post.copy(
                likeCount = likeCount.coerceAtLeast(0),
                commentCount = commentCount.coerceAtLeast(0),
                repostCount = repostCount.coerceAtLeast(0),
                isLiked = isLiked ?: post.isLiked,
                isReposted = isReposted ?: post.isReposted,
            ),
        )
    }

    fun updateVisibleVideoPlayback() {
        val visibleHolder = attachedHolders
            .mapNotNull { holder ->
                val frame = holder.binding.postMediaFrame
                if (holder.boundPost?.videoUrl.isNullOrBlank() || frame.height <= 0) {
                    return@mapNotNull null
                }
                val visibleBounds = Rect()
                if (!frame.getGlobalVisibleRect(visibleBounds)) return@mapNotNull null
                val visibleFraction = visibleBounds.height().toFloat() / frame.height
                (holder to visibleFraction).takeIf { visibleFraction >= VISIBLE_VIDEO_FRACTION }
            }
            .maxByOrNull { it.second }
            ?.first
        attachedHolders.forEach { holder ->
            if (holder == visibleHolder) startVideo(holder) else pauseVideo(holder)
        }
    }

    fun pauseVideos() {
        attachedHolders.forEach(::pauseVideo)
    }

    fun releaseVideos() {
        attachedHolders.toList().forEach { holder ->
            pauseVideo(holder)
            holder.videoSource = null
            holder.videoHasFrame = false
        }
        attachedHolders.clear()
        player?.release()
        player = null
        activeVideoHolder = null
        activeContentKey = null
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PostViewHolder {
        val binding = ItemPostBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false,
        )
        if (reelsMode) {
            binding.root.layoutParams = RecyclerView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ).apply {
                bottomMargin = 0
            }
            binding.postMediaFrame.layoutParams =
                binding.postMediaFrame.layoutParams.apply {
                    height = ViewGroup.LayoutParams.MATCH_PARENT
                }
        }
        return PostViewHolder(binding)
    }

    override fun onBindViewHolder(holder: PostViewHolder, position: Int) {
        val post = posts[position]
        val context = holder.itemView.context
        if (reelsMode) {
            holder.itemView.doOnLayout { item ->
                val parentHeight = (item.parent as? View)?.height ?: 0
                if (parentHeight > 0 && item.layoutParams.height != parentHeight) {
                    item.layoutParams = item.layoutParams.apply {
                        height = parentHeight
                        if (this is ViewGroup.MarginLayoutParams) bottomMargin = 0
                    }
                }
            }
            holder.binding.root.setBackgroundColor(Color.BLACK)
            for (index in 0 until holder.binding.root.childCount) {
                val child = holder.binding.root.getChildAt(index)
                child.visibility = if (child == holder.binding.postMediaFrame) {
                    View.VISIBLE
                } else {
                    View.GONE
                }
            }
            holder.binding.reelOverlay.visibility = View.VISIBLE
            holder.binding.reelDoubleTapHeart.visibility = View.GONE
            holder.binding.reelPlayPauseIndicator.visibility = View.GONE
            holder.binding.postMediaImage.scaleType = android.widget.ImageView.ScaleType.CENTER_CROP
            holder.binding.postMediaVideo.resizeMode =
                androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            (holder.binding.btnMuteVideo.layoutParams as? android.widget.FrameLayout.LayoutParams)
                ?.let { params ->
                    params.gravity = Gravity.TOP or Gravity.END
                    params.topMargin = context.resources.getDimensionPixelSize(
                        R.dimen.reel_top_control_margin,
                    )
                    holder.binding.btnMuteVideo.layoutParams = params
                }
        }

        with(holder.binding) {
            holder.boundPost = post
            postMediaFrame.doOnLayout { frame ->
                if (reelsMode) {
                    val availableHeight = (frame.parent as? View)?.height ?: 0
                    if (availableHeight > 0 && frame.layoutParams.height != availableHeight) {
                        frame.layoutParams = frame.layoutParams.apply {
                            height = availableHeight
                        }
                    }
                    return@doOnLayout
                }
                val ratio = if (post.mediaWidth != null && post.mediaHeight != null &&
                    post.mediaWidth > 0 && post.mediaHeight > 0
                ) {
                    post.mediaHeight.toFloat() / post.mediaWidth.toFloat()
                } else {
                    0.75f
                }
                val maxHeight = if (reelsMode) {
                    (frame.resources.displayMetrics.heightPixels * 0.72f).toInt()
                } else {
                    (frame.resources.displayMetrics.heightPixels * 0.78f).toInt()
                }
                val desiredHeight = (frame.width * ratio).toInt().coerceAtMost(maxHeight)
                if (frame.layoutParams.height != desiredHeight) {
                    frame.layoutParams = frame.layoutParams.apply { height = desiredHeight }
                }
            }

            postAuthorName.text = post.authorName
            postAuthorUsername.text = context.getString(R.string.username_at, post.authorUsername)
            postAuthorAvatar.outlineProvider = CIRCULAR_AVATAR_OUTLINE
            postAuthorAvatar.clipToOutline = true
            RemoteImageLoader.load(postAuthorAvatar, post.authorAvatarUrl, R.drawable.ic_profile)
            RemoteImageLoader.load(postMediaImage, post.imageUrl, R.drawable.bg_media_placeholder)
            bindVideo(holder, post)

            postFollowButton.visibility = if (post.isFollowing) View.GONE else View.VISIBLE
            postFollowButton.setOnClickListener { onFollowClicked(post) }
            if (reelsMode) bindReelOverlay(holder, post)
            if (!post.location.isNullOrBlank()) {
                postLocation.text = post.location
                postLocation.visibility = View.VISIBLE
            } else {
                postLocation.visibility = View.GONE
            }

            postLikeCount.text = compactCount(post.likeCount)
            postLikeCount.contentDescription =
                context.getString(R.string.likes_count, compactCount(post.likeCount))
            postTimestamp.text = post.timestamp
            postCommentCount.text = compactCount(post.commentCount)
            postCommentCount.contentDescription =
                context.getString(R.string.comments_count, compactCount(post.commentCount))
            postCommentsPreview.text = context.getString(R.string.view_comments)
            postRepostCount.text = compactCount(post.repostCount)
            postRepostCount.contentDescription =
                context.getString(R.string.reposts_count, compactCount(post.repostCount))

            val captionText = SpannableStringBuilder()
            val username = SpannableString(post.authorUsername + " ")
            username.setSpan(
                StyleSpan(android.graphics.Typeface.BOLD),
                0,
                username.length,
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
            captionText.append(username)
            captionText.append(post.caption)
            postCaption.text = captionText
            val isCaptionExpanded = expandedCaptions.contains(post.contentKey)
            postCaption.maxLines = if (isCaptionExpanded) Int.MAX_VALUE else CAPTION_MAX_LINES
            postCaptionToggle.visibility =
                if (post.caption.length > CAPTION_COLLAPSE_LENGTH) View.VISIBLE else View.GONE
            postCaptionToggle.setText(
                if (isCaptionExpanded) R.string.caption_less else R.string.caption_more,
            )
            postCaptionToggle.setOnClickListener {
                if (!expandedCaptions.add(post.contentKey)) {
                    expandedCaptions.remove(post.contentKey)
                }
                val bindingPosition = holder.bindingAdapterPosition
                if (bindingPosition != RecyclerView.NO_POSITION) notifyItemChanged(bindingPosition)
            }

            updateLikeButton(this, post.isLiked)
            updateBookmarkButton(this, post.isBookmarked)
            btnRepost.setColorFilter(
                context.getColor(if (post.isReposted) R.color.heart_primary else R.color.heart_text),
            )
            btnLike.contentDescription = context.getString(
                if (post.isLiked) R.string.unlike_count else R.string.like_count,
                compactCount(post.likeCount),
            )
            btnBookmark.contentDescription = context.getString(
                if (post.isBookmarked) R.string.remove_bookmark else R.string.bookmark,
            )
            btnRepost.contentDescription = context.getString(
                if (post.isReposted) R.string.undo_repost else R.string.repost,
            )

            btnLike.setOnClickListener {
                animateAction(btnLike)
                onLikeClicked(post)
            }
            btnBookmark.setOnClickListener {
                animateAction(btnBookmark)
                onBookmarkClicked(post)
            }
            btnComment.setOnClickListener { onCommentClicked(post) }
            postCommentsPreview.setOnClickListener { onCommentClicked(post) }
            btnRepost.setOnClickListener { onRepostClicked(post) }

            val mediaGestureDetector = GestureDetector(
                context,
                object : GestureDetector.SimpleOnGestureListener() {
                    override fun onDown(event: android.view.MotionEvent): Boolean = true

                    override fun onDoubleTap(event: android.view.MotionEvent): Boolean {
                        if (reelsMode) showDoubleTapLike(holder, post)
                        else if (!post.isLiked) onLikeClicked(post)
                        return true
                    }

                    override fun onSingleTapConfirmed(event: android.view.MotionEvent): Boolean {
                        if (reelsMode) toggleVideoPlayback(holder)
                        return reelsMode
                    }
                },
            )
            postMediaImage.setOnTouchListener { _, event ->
                mediaGestureDetector.onTouchEvent(event)
            }
            postMediaVideo.setOnTouchListener { _, event ->
                mediaGestureDetector.onTouchEvent(event)
            }

            btnShare.setOnClickListener {
                sharePost(post, context)
            }

            postMoreButton.setOnClickListener {
                PopupMenu(context, postMoreButton).apply {
                    menu.add(0, MENU_SHARE, 0, R.string.share)
                    menu.add(
                        0,
                        MENU_REPOST,
                        1,
                        if (post.isReposted) R.string.undo_repost else R.string.repost,
                    )
                    setOnMenuItemClickListener { item ->
                        when (item.itemId) {
                            MENU_SHARE -> sharePost(post, context)
                            MENU_REPOST -> onRepostClicked(post)
                        }
                        true
                    }
                }.show()
            }
        }
    }

    private fun bindReelOverlay(holder: PostViewHolder, post: PostModel) {
        val binding = holder.binding
        val context = binding.root.context
        binding.reelCreatorAvatar.outlineProvider = CIRCULAR_AVATAR_OUTLINE
        binding.reelCreatorAvatar.clipToOutline = true
        RemoteImageLoader.load(
            binding.reelCreatorAvatar,
            post.authorAvatarUrl,
            R.drawable.ic_profile,
        )
        binding.reelCreatorUsername.text = context.getString(
            R.string.username_at,
            post.authorUsername,
        )
        val openCreator = View.OnClickListener { openCreatorProfile(post, context) }
        binding.reelCreatorAvatar.setOnClickListener(openCreator)
        binding.reelCreatorUsername.setOnClickListener(openCreator)
        binding.reelFollowButton.visibility = if (post.isFollowing) View.GONE else View.VISIBLE
        binding.reelFollowButton.setOnClickListener { onFollowClicked(post) }
        binding.reelCaption.text = linkifyCaption(post.caption, context)
        binding.reelCaption.movementMethod = LinkMovementMethod.getInstance()
        binding.reelCaption.maxLines = if (expandedCaptions.contains(post.contentKey)) {
            Int.MAX_VALUE
        } else {
            REEL_CAPTION_MAX_LINES
        }
        binding.reelCaptionToggle.visibility = if (
            post.caption.length > REEL_CAPTION_COLLAPSE_LENGTH
        ) View.VISIBLE else View.GONE
        binding.reelCaptionToggle.setText(
            if (expandedCaptions.contains(post.contentKey)) {
                R.string.caption_less
            } else {
                R.string.caption_more
            },
        )
        binding.reelCaptionToggle.setOnClickListener {
            if (!expandedCaptions.add(post.contentKey)) expandedCaptions.remove(post.contentKey)
            val position = holder.bindingAdapterPosition
            if (position != RecyclerView.NO_POSITION) notifyItemChanged(position)
        }
        binding.reelLocation.text = post.location
        binding.reelLocation.visibility =
            if (post.location.isNullOrBlank()) View.GONE else View.VISIBLE
        binding.reelLikeCount.text = compactCount(post.likeCount)
        binding.reelCommentCount.text = compactCount(post.commentCount)
        binding.reelRepostCount.text = compactCount(post.repostCount)
        binding.reelLikeCount.contentDescription =
            context.getString(R.string.likes_count, compactCount(post.likeCount))
        binding.reelCommentCount.contentDescription =
            context.getString(R.string.comments_count, compactCount(post.commentCount))
        binding.reelRepostCount.contentDescription =
            context.getString(R.string.reposts_count, compactCount(post.repostCount))

        binding.reelBtnLike.setImageResource(
            if (post.isLiked) R.drawable.ic_heart_selected else R.drawable.ic_heart_outline,
        )
        binding.reelBtnLike.imageTintList = ColorStateList.valueOf(
            context.getColor(if (post.isLiked) R.color.heart_primary else android.R.color.white),
        )
        binding.reelBtnLike.contentDescription = context.getString(
            if (post.isLiked) R.string.unlike_count else R.string.like_count,
            compactCount(post.likeCount),
        )
        binding.reelBtnLike.setOnClickListener {
            animateAction(binding.reelBtnLike)
            onLikeClicked(post)
        }
        binding.reelBtnComment.setOnClickListener { onCommentClicked(post) }
        binding.reelBtnRepost.setColorFilter(
            context.getColor(if (post.isReposted) R.color.heart_primary else android.R.color.white),
        )
        binding.reelBtnRepost.contentDescription =
            context.getString(if (post.isReposted) R.string.undo_repost else R.string.repost)
        binding.reelBtnRepost.setOnClickListener { onRepostClicked(post) }
        binding.reelBtnShare.setOnClickListener { sharePost(post, context) }
        binding.reelBtnBookmark.setImageResource(
            if (post.isBookmarked) R.drawable.ic_bookmark_selected else R.drawable.ic_bookmark,
        )
        binding.reelBtnBookmark.setColorFilter(
            context.getColor(if (post.isBookmarked) R.color.heart_primary else android.R.color.white),
        )
        binding.reelBtnBookmark.contentDescription = context.getString(
            if (post.isBookmarked) R.string.remove_saved_reel else R.string.save_reel,
        )
        binding.reelBookmarkLabel.setText(
            if (post.isBookmarked) R.string.saved else R.string.bookmark,
        )
        binding.reelBtnBookmark.setOnClickListener { onBookmarkClicked(post) }
        binding.reelBtnMore.setOnClickListener { showReelMoreMenu(binding, post) }
    }

    private fun showReelMoreMenu(binding: ItemPostBinding, post: PostModel) {
        val context = binding.root.context
        PopupMenu(context, binding.reelBtnMore).apply {
            menu.add(
                0,
                MENU_REPOST,
                0,
                if (post.isReposted) R.string.undo_repost else R.string.repost,
            )
            menu.add(
                0,
                MENU_BOOKMARK,
                1,
                if (post.isBookmarked) R.string.remove_saved_reel else R.string.save_reel,
            )
            menu.add(0, MENU_SHARE, 2, R.string.share)
            menu.add(0, MENU_CREATOR_PROFILE, 3, R.string.view_creator_profile)
            setOnMenuItemClickListener { item ->
                when (item.itemId) {
                    MENU_SHARE -> sharePost(post, context)
                    MENU_REPOST -> onRepostClicked(post)
                    MENU_BOOKMARK -> onBookmarkClicked(post)
                    MENU_CREATOR_PROFILE -> openCreatorProfile(post, context)
                }
                true
            }
        }.show()
    }

    private fun linkifyCaption(caption: String, context: android.content.Context): CharSequence {
        val text = SpannableStringBuilder(caption)
        val linkPattern = Regex("#([\\p{L}\\p{N}_]+)|@([\\p{L}\\p{N}_.]+)")
        linkPattern.findAll(caption).forEach { match ->
            val isHashtag = match.groups[1] != null
            val value = match.groups[1]?.value ?: match.groups[2]?.value ?: return@forEach
            text.setSpan(
                object : ClickableSpan() {
                    override fun onClick(widget: View) {
                        val path = if (isHashtag) {
                            "/explore/tags/${Uri.encode(value)}"
                        } else {
                            "/profile/${Uri.encode(value)}"
                        }
                        openWebPath(path, context)
                    }

                    override fun updateDrawState(drawState: TextPaint) {
                        drawState.color = context.getColor(android.R.color.white)
                        drawState.isUnderlineText = false
                    }
                },
                match.range.first,
                match.range.last + 1,
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
        }
        return text
    }

    private fun openCreatorProfile(post: PostModel, context: android.content.Context) {
        openWebPath("/profile/${Uri.encode(post.authorId)}", context)
    }

    private fun openWebPath(path: String, context: android.content.Context) {
        context.startActivity(
            Intent(
                Intent.ACTION_VIEW,
                Uri.parse("https://cliqhearts.onrender.com$path"),
            ),
        )
    }

    private fun showDoubleTapLike(holder: PostViewHolder, post: PostModel) {
        if (!post.isLiked) onLikeClicked(post)
        val heart = holder.binding.reelDoubleTapHeart
        heart.animate().cancel()
        heart.visibility = View.VISIBLE
        heart.scaleX = 0.4f
        heart.scaleY = 0.4f
        heart.alpha = 0f
        heart.animate()
            .scaleX(1f)
            .scaleY(1f)
            .alpha(1f)
            .setDuration(180)
            .withEndAction {
                heart.animate()
                    .alpha(0f)
                    .setStartDelay(450)
                    .setDuration(220)
                    .withEndAction { heart.visibility = View.GONE }
                    .start()
            }
            .start()
    }

    private fun toggleVideoPlayback(holder: PostViewHolder) {
        val mediaPlayer = player
        if (activeVideoHolder != holder || mediaPlayer == null) {
            startVideo(holder)
            return
        }
        val indicator = holder.binding.reelPlayPauseIndicator
        val shouldPlay = !mediaPlayer.isPlaying
        if (shouldPlay) mediaPlayer.play() else mediaPlayer.pause()
        indicator.setImageResource(
            if (shouldPlay) R.drawable.ic_play_video else R.drawable.ic_pause_video,
        )
        indicator.contentDescription = holder.itemView.context.getString(
            if (shouldPlay) R.string.play_video else R.string.pause_video,
        )
        indicator.animate().cancel()
        indicator.visibility = View.VISIBLE
        indicator.alpha = 0f
        indicator.animate()
            .alpha(1f)
            .setDuration(120)
            .withEndAction {
                indicator.animate()
                    .alpha(0f)
                    .setStartDelay(450)
                    .setDuration(220)
                    .withEndAction { indicator.visibility = View.GONE }
                    .start()
            }
            .start()
    }

    private fun sharePost(post: PostModel, context: android.content.Context) {
        val shareText = if (post.contentType == "reel") {
            "Check out @${post.authorUsername}'s Reel on CliQHeart: " +
                "https://cliqhearts.onrender.com/reels/${Uri.encode(post.id)}"
        } else {
            context.getString(
                R.string.share_post_text,
                post.authorUsername,
                post.caption,
            )
        }
        val shareIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, context.getString(R.string.share_post))
            putExtra(Intent.EXTRA_TEXT, shareText)
        }
        context.startActivity(Intent.createChooser(shareIntent, context.getString(R.string.share)))
    }

    override fun onViewAttachedToWindow(holder: PostViewHolder) {
        super.onViewAttachedToWindow(holder)
        attachedHolders.add(holder)
        holder.itemView.post { updateVisibleVideoPlayback() }
    }

    override fun onViewDetachedFromWindow(holder: PostViewHolder) {
        pauseVideo(holder)
        attachedHolders.remove(holder)
        super.onViewDetachedFromWindow(holder)
    }

    override fun onViewRecycled(holder: PostViewHolder) {
        pauseVideo(holder)
        holder.videoSource = null
        holder.videoHasFrame = false
        holder.boundPost = null
        attachedHolders.remove(holder)
        super.onViewRecycled(holder)
    }

    private fun bindVideo(holder: PostViewHolder, post: PostModel) {
        val videoUrl = post.videoUrl
        with(holder.binding) {
            val context = root.context
            if (videoUrl.isNullOrBlank()) {
                pauseVideo(holder)
                postMediaVideo.player = null
                postMediaVideo.visibility = View.INVISIBLE
                btnMuteVideo.visibility = View.GONE
                postVideoLoading.visibility = View.GONE
                postVideoError.visibility = View.GONE
                postMediaImage.visibility = View.VISIBLE
                holder.videoSource = null
                holder.videoHasFrame = false
                return
            }
            val uri = Uri.parse(videoUrl)
            if (uri.scheme != "https" || uri.host.isNullOrBlank()) {
                pauseVideo(holder)
                postMediaVideo.player = null
                postMediaVideo.visibility = View.INVISIBLE
                btnMuteVideo.visibility = View.GONE
                postVideoLoading.visibility = View.GONE
                postVideoError.visibility = View.VISIBLE
                postMediaImage.visibility = View.VISIBLE
                holder.videoSource = null
                return
            }

            val isNewSource = holder.videoSource != videoUrl
            if (isNewSource) {
                holder.isMuted = true
                holder.videoHasFrame = false
            }
            postMediaVideo.player = if (activeVideoHolder == holder) player else null
            postMediaVideo.resizeMode = if (reelsMode) {
                androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            } else {
                androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT
            }
            postMediaImage.visibility = if (holder.videoHasFrame) View.GONE else View.VISIBLE
            postMediaVideo.visibility = if (holder.videoHasFrame) View.VISIBLE else View.INVISIBLE
            postVideoError.visibility = View.GONE
            postVideoLoading.visibility = if (activeVideoHolder == holder &&
                player?.playbackState == Player.STATE_BUFFERING
            ) View.VISIBLE else View.GONE
            btnMuteVideo.visibility = View.VISIBLE
            btnMuteVideo.setImageResource(
                if (holder.isMuted) R.drawable.ic_volume_muted else R.drawable.ic_volume_up,
            )
            btnMuteVideo.contentDescription = context.getString(
                if (holder.isMuted) R.string.unmute_video else R.string.mute_video,
            )
            btnMuteVideo.setOnClickListener {
                holder.isMuted = !holder.isMuted
                val volume = if (holder.isMuted) 0f else 1f
                if (activeVideoHolder == holder) player?.volume = volume
                btnMuteVideo.setImageResource(
                    if (holder.isMuted) R.drawable.ic_volume_muted else R.drawable.ic_volume_up,
                )
                btnMuteVideo.contentDescription = context.getString(
                    if (holder.isMuted) R.string.unmute_video else R.string.mute_video,
                )
            }
            btnRetryVideo.setOnClickListener { startVideo(holder, retry = true) }
            if (isNewSource) holder.videoSource = videoUrl
            postMediaFrame.post { updateVisibleVideoPlayback() }
        }
    }

    private fun startVideo(holder: PostViewHolder, retry: Boolean = false) {
        val post = holder.boundPost ?: return
        val videoUrl = post.videoUrl?.takeIf(String::isNotBlank) ?: return
        val context = holder.itemView.context
        val exoPlayer = player ?: ExoPlayer.Builder(context).build().also { created ->
            created.repeatMode = Player.REPEAT_MODE_ONE
            created.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    updateActiveVideoState(playbackState)
                }

                override fun onPlayerError(error: PlaybackException) {
                    Log.w(TAG, "Post video playback failed.", error)
                    activeVideoHolder?.let { active ->
                        active.binding.postVideoLoading.visibility = View.GONE
                        active.binding.postMediaVideo.visibility = View.INVISIBLE
                        active.binding.postMediaImage.visibility = View.VISIBLE
                        active.binding.postVideoError.visibility = View.VISIBLE
                    }
                }
            })
            player = created
        }

        if (activeVideoHolder != holder) {
            activeVideoHolder?.binding?.postMediaVideo?.player = null
            holder.binding.postMediaVideo.player = exoPlayer
            activeVideoHolder = holder
        }
        exoPlayer.volume = if (holder.isMuted) 0f else 1f
        val shouldReload = retry || activeContentKey != post.contentKey ||
            exoPlayer.playerError != null || holder.videoSource != videoUrl
        if (shouldReload) {
            activeContentKey = post.contentKey
            holder.videoSource = videoUrl
            holder.videoHasFrame = false
            holder.binding.postVideoError.visibility = View.GONE
            holder.binding.postMediaVideo.visibility = View.INVISIBLE
            holder.binding.postMediaImage.visibility = View.VISIBLE
            val mediaItemBuilder = MediaItem.Builder().setUri(videoUrl)
            when (post.videoFormat?.lowercase(Locale.ROOT)) {
                "mp4" -> mediaItemBuilder.setMimeType(MimeTypes.VIDEO_MP4)
                "mov" -> mediaItemBuilder.setMimeType("video/quicktime")
            }
            exoPlayer.setMediaItem(mediaItemBuilder.build())
            exoPlayer.prepare()
        }
        exoPlayer.playWhenReady = true
    }

    private fun pauseVideo(holder: PostViewHolder) {
        if (activeVideoHolder != holder) return
        player?.pause()
        holder.binding.postMediaVideo.player = null
        holder.binding.postVideoLoading.visibility = View.GONE
        activeVideoHolder = null
    }

    private fun updateActiveVideoState(playbackState: Int) {
        val holder = activeVideoHolder ?: return
        val binding = holder.binding
        when (playbackState) {
            Player.STATE_BUFFERING -> {
                binding.postVideoLoading.visibility = View.VISIBLE
                binding.postVideoError.visibility = View.GONE
            }
            Player.STATE_READY -> {
                holder.videoHasFrame = true
                binding.postVideoLoading.visibility = View.GONE
                binding.postVideoError.visibility = View.GONE
                binding.postMediaImage.visibility = View.GONE
                binding.postMediaVideo.visibility = View.VISIBLE
            }
            Player.STATE_IDLE -> binding.postVideoLoading.visibility = View.GONE
            Player.STATE_ENDED -> player?.seekToDefaultPosition()
        }
    }

    private fun updateLikeButton(binding: ItemPostBinding, isLiked: Boolean) {
        binding.btnLike.setImageResource(
            if (isLiked) R.drawable.ic_heart_selected else R.drawable.ic_heart_outline,
        )
        binding.btnLike.imageTintList = ColorStateList.valueOf(
            binding.root.context.getColor(
                if (isLiked) R.color.heart_primary else R.color.heart_text,
            ),
        )
    }

    private fun updateBookmarkButton(binding: ItemPostBinding, isBookmarked: Boolean) {
        binding.btnBookmark.setImageResource(
            if (isBookmarked) R.drawable.ic_bookmark_selected else R.drawable.ic_bookmark,
        )
        binding.btnBookmark.imageTintList = ColorStateList.valueOf(
            binding.root.context.getColor(
                if (isBookmarked) R.color.heart_primary else R.color.heart_text,
            ),
        )
    }

    private fun compactCount(value: Int): String {
        val count = value.coerceAtLeast(0)
        val (divisor, suffix) = when {
            count >= 1_000_000_000 -> 1_000_000_000.0 to "B"
            count >= 1_000_000 -> 1_000_000.0 to "M"
            count >= 1_000 -> 1_000.0 to "K"
            else -> return count.toString()
        }
        val formatter = DecimalFormat("#.#", DecimalFormatSymbols.getInstance(Locale.getDefault()))
        return formatter.format(count / divisor) + suffix
    }

    private fun animateAction(view: View) {
        view.animate().cancel()
        view.scaleX = 1f
        view.scaleY = 1f
        view.animate()
            .scaleX(1.16f)
            .scaleY(1.16f)
            .setDuration(100)
            .withEndAction {
                view.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
            }
            .start()
    }

    override fun getItemCount(): Int = posts.size

    private companion object {
        const val TAG = "FeedAdapter"
        const val CAPTION_COLLAPSE_LENGTH = 160
        const val CAPTION_MAX_LINES = 3
        const val REEL_CAPTION_COLLAPSE_LENGTH = 180
        const val REEL_CAPTION_MAX_LINES = 4
        val CIRCULAR_AVATAR_OUTLINE = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                outline.setOval(0, 0, view.width, view.height)
            }
        }

        const val VISIBLE_VIDEO_FRACTION = 0.6f
        const val MENU_SHARE = 1
        const val MENU_REPOST = 2
        const val MENU_BOOKMARK = 3
        const val MENU_CREATOR_PROFILE = 4
    }
}
