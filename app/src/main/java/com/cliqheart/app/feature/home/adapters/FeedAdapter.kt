package com.cliqheart.app.feature.home.adapters

import android.content.Intent
import android.text.SpannableString
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StyleSpan
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.view.doOnLayout
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.R
import com.cliqheart.app.databinding.ItemPostBinding
import com.cliqheart.app.feature.home.models.PostModel

class FeedAdapter(
    private val posts: List<PostModel>,
    private val onLikeClicked: (PostModel) -> Unit,
    private val onBookmarkClicked: (PostModel) -> Unit,
    private val onCommentClicked: (PostModel) -> Unit,
) : RecyclerView.Adapter<FeedAdapter.PostViewHolder>() {

    class PostViewHolder(val binding: ItemPostBinding) :
        RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PostViewHolder {
        val binding = ItemPostBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false,
        )
        return PostViewHolder(binding)
    }

    override fun onBindViewHolder(holder: PostViewHolder, position: Int) {
        val post = posts[position]
        val context = holder.itemView.context

        with(holder.binding) {
            postMediaFrame.doOnLayout { frame ->
                val desiredHeight = (frame.width * 3f / 4f).toInt()
                if (frame.layoutParams.height != desiredHeight) {
                    frame.layoutParams = frame.layoutParams.apply {
                        height = desiredHeight
                    }
                }
            }
            postAuthorName.text = post.authorName
            if (!post.location.isNullOrBlank()) {
                postLocation.text = post.location
                postLocation.visibility = View.VISIBLE
            } else {
                postLocation.visibility = View.GONE
            }

            postLikeCount.text = context.getString(R.string.likes_count, post.likeCount.toString())
            postTimestamp.text = post.timestamp
            postCommentsPreview.text = context.getString(R.string.view_all_comments, post.commentCount)

            val ssb = SpannableStringBuilder()
            val usernameSpannable = SpannableString(post.authorUsername + " ")
            usernameSpannable.setSpan(
                StyleSpan(android.graphics.Typeface.BOLD),
                0,
                usernameSpannable.length,
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
            ssb.append(usernameSpannable)
            ssb.append(post.caption)
            postCaption.text = ssb

            updateLikeButton(this, post.isLiked)
            updateBookmarkButton(this, post.isBookmarked)

            btnLike.setOnClickListener {
                post.isLiked = !post.isLiked
                post.likeCount += if (post.isLiked) 1 else -1
                postLikeCount.text = context.getString(R.string.likes_count, post.likeCount.toString())
                updateLikeButton(this, post.isLiked)
                onLikeClicked(post)
            }

            btnBookmark.setOnClickListener {
                post.isBookmarked = !post.isBookmarked
                updateBookmarkButton(this, post.isBookmarked)
                onBookmarkClicked(post)
            }

            btnComment.setOnClickListener {
                onCommentClicked(post)
            }

            btnShare.setOnClickListener {
                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_SUBJECT, "CliQHeart Post")
                    putExtra(
                        Intent.EXTRA_TEXT,
                        "Check out this post by @${post.authorUsername} on CliQHeart: ${post.caption}",
                    )
                }
                context.startActivity(Intent.createChooser(shareIntent, "Share post via"))
            }
        }
    }

    private fun updateLikeButton(binding: ItemPostBinding, isLiked: Boolean) {
        binding.btnLike.setImageResource(
            if (isLiked) R.drawable.ic_heart_selected else R.drawable.ic_activity,
        )
    }

    private fun updateBookmarkButton(binding: ItemPostBinding, isBookmarked: Boolean) {
        binding.btnBookmark.setImageResource(
            if (isBookmarked) R.drawable.ic_bookmark_selected else R.drawable.ic_bookmark,
        )
    }

    override fun getItemCount(): Int = posts.size
}
