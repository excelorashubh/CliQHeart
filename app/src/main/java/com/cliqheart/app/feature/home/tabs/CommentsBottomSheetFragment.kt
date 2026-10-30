package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Toast
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.CommentCreateRequest
import com.cliqheart.app.core.network.CommentResponse
import com.cliqheart.app.databinding.DialogPostCommentsBinding
import com.cliqheart.app.databinding.ItemPostCommentBinding
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import retrofit2.Response
import java.io.IOException

class CommentsBottomSheetFragment : BottomSheetDialogFragment() {
    private var _binding: DialogPostCommentsBinding? = null
    private val binding get() = requireNotNull(_binding)
    private val contentId: String get() = requireArguments().getString(ARG_CONTENT_ID).orEmpty()
    private val contentType: String get() = requireArguments().getString(ARG_CONTENT_TYPE).orEmpty()
    private val collection: String get() = if (contentType == "reel") "reels" else "posts"
    private val commentsAdapter = CommentsAdapter()
    private var loading = false
    private var sending = false

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = DialogPostCommentsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.commentsRecyclerView.layoutManager = LinearLayoutManager(requireContext())
        binding.commentsRecyclerView.adapter = commentsAdapter
        binding.btnSendComment.setOnClickListener { sendComment() }
        binding.commentsState.setOnClickListener { loadComments() }
        loadComments()
    }

    override fun onStart() {
        super.onStart()
        dialog?.window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            (resources.displayMetrics.heightPixels * 0.82f).toInt(),
        )
        (dialog as? BottomSheetDialog)?.behavior?.apply {
            state = BottomSheetBehavior.STATE_EXPANDED
            skipCollapsed = true
        }
    }

    private fun loadComments() {
        if (loading) return
        loading = true
        binding.commentsLoading.visibility = View.VISIBLE
        binding.commentsState.visibility = View.GONE
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.getComments(collection, contentId)
                if (!response.isSuccessful) throw requestError(response, getString(R.string.comments_load_failed))
                val comments = response.body()?.comments
                    ?: throw IOException(getString(R.string.comments_load_failed))
                commentsAdapter.submitComments(comments)
                binding.commentsState.visibility = if (comments.isEmpty()) View.VISIBLE else View.GONE
                binding.commentsState.text = if (comments.isEmpty()) {
                    getString(R.string.comments_empty)
                } else {
                    ""
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                binding.commentsState.text = exception.message ?: getString(R.string.comments_load_failed)
                binding.commentsState.visibility = View.VISIBLE
            } finally {
                loading = false
                _binding?.commentsLoading?.visibility = View.GONE
            }
        }
    }

    private fun sendComment() {
        val text = binding.commentInput.text?.toString()?.trim().orEmpty()
        if (text.isBlank() || sending) return
        sending = true
        binding.btnSendComment.isEnabled = false
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.createComment(
                    collection,
                    contentId,
                    CommentCreateRequest(text),
                )
                if (!response.isSuccessful) throw requestError(response, getString(R.string.comment_send_failed))
                val result = response.body()
                    ?: throw IOException(getString(R.string.comment_send_failed))
                val comment = result.comment
                    ?: throw IOException(getString(R.string.comment_send_failed))
                commentsAdapter.appendComment(comment)
                binding.commentInput.text?.clear()
                binding.commentsState.visibility = View.GONE
                binding.commentsRecyclerView.scrollToPosition(commentsAdapter.itemCount - 1)
                result.commentCount?.let(::publishCommentCount)
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                Toast.makeText(
                    requireContext(),
                    exception.message ?: getString(R.string.comment_send_failed),
                    Toast.LENGTH_LONG,
                ).show()
            } finally {
                sending = false
                _binding?.btnSendComment?.isEnabled = true
            }
        }
    }

    private fun publishCommentCount(count: Int) {
        parentFragmentManager.setFragmentResult(
            COMMENT_COUNT_RESULT_KEY,
            Bundle().apply {
                putString(ARG_COMMENT_CONTENT_ID, contentId)
                putString(ARG_COMMENT_CONTENT_TYPE, contentType)
                putInt(ARG_COMMENT_COUNT, count)
            },
        )
    }

    private fun <T> requestError(response: Response<T>, fallback: String): IOException {
        val message = response.errorBody()?.use { body ->
            runCatching { JSONObject(body.string()).optString("error") }.getOrNull()
        }
        return IOException(message?.takeIf(String::isNotBlank) ?: fallback)
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    private class CommentsAdapter : RecyclerView.Adapter<CommentViewHolder>() {
        private val comments = mutableListOf<CommentResponse>()

        fun submitComments(items: List<CommentResponse>) {
            comments.clear()
            comments.addAll(items)
            notifyDataSetChanged()
        }

        fun appendComment(comment: CommentResponse) {
            comments.add(comment)
            notifyItemInserted(comments.lastIndex)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CommentViewHolder =
            CommentViewHolder(
                ItemPostCommentBinding.inflate(LayoutInflater.from(parent.context), parent, false),
            )

        override fun onBindViewHolder(holder: CommentViewHolder, position: Int) {
            val comment = comments[position]
            holder.binding.commentAuthor.text = comment.author?.displayName
                ?.takeIf(String::isNotBlank)
                ?: "@${comment.author?.username.orEmpty()}"
            holder.binding.commentText.text = comment.text.orEmpty()
        }

        override fun getItemCount(): Int = comments.size
    }

    private class CommentViewHolder(val binding: ItemPostCommentBinding) :
        RecyclerView.ViewHolder(binding.root)

    companion object {
        private const val ARG_CONTENT_ID = "content_id"
        private const val ARG_CONTENT_TYPE = "content_type"

        fun newInstance(contentId: String, contentType: String) =
            CommentsBottomSheetFragment().apply {
                arguments = Bundle().apply {
                    putString(ARG_CONTENT_ID, contentId)
                    putString(ARG_CONTENT_TYPE, contentType)
                }
            }
    }
}