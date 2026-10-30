package com.cliqheart.app.feature.home

import android.app.Dialog
import android.content.DialogInterface
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Toast
import androidx.fragment.app.DialogFragment
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.databinding.DialogStoryViewerBinding
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.io.IOException

class StoryViewerDialogFragment : DialogFragment() {
    private var _binding: DialogStoryViewerBinding? = null
    private val binding get() = requireNotNull(_binding)
    private val storyIds: List<String>
        get() = requireArguments().getStringArrayList(ARG_STORY_IDS).orEmpty()
    private val ownerLabel: String
        get() = requireArguments().getString(ARG_OWNER_LABEL).orEmpty()
    private var currentIndex = 0
    private var storyLoadJob: Job? = null
    private var videoPlayer: ExoPlayer? = null

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog =
        Dialog(requireContext(), theme)

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = DialogStoryViewerBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.storyOwner.text = ownerLabel
        binding.storyClose.setOnClickListener { dismiss() }
        binding.storyPrevious.setOnClickListener { showStory(currentIndex - 1) }
        binding.storyNext.setOnClickListener { showStory(currentIndex + 1) }
        binding.btnRetryStoryVideo.setOnClickListener { showStory(currentIndex) }
        showStory(currentIndex)
    }

    override fun onStart() {
        super.onStart()
        dialog?.window?.apply {
            setBackgroundDrawableResource(android.R.color.transparent)
            setLayout(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
            )
            statusBarColor = android.graphics.Color.BLACK
            navigationBarColor = android.graphics.Color.BLACK
        }
    }

    override fun onPause() {
        videoPlayer?.pause()
        super.onPause()
    }

    override fun onDismiss(dialog: DialogInterface) {
        parentFragmentManager.setFragmentResult(
            com.cliqheart.app.feature.home.tabs.STORY_VIEWED_RESULT_KEY,
            Bundle.EMPTY,
        )
        super.onDismiss(dialog)
    }

    override fun onResume() {
        super.onResume()
        videoPlayer?.play()
    }

    override fun onDestroyView() {
        storyLoadJob?.cancel()
        bindingOrNull()?.storyVideo?.player = null
        videoPlayer?.release()
        videoPlayer = null
        _binding = null
        super.onDestroyView()
    }

    private fun showStory(index: Int) {
        if (index !in storyIds.indices) {
            dismiss()
            return
        }
        storyLoadJob?.cancel()
        videoPlayer?.stop()
        videoPlayer?.clearMediaItems()
        currentIndex = index
        val viewBinding = binding
        viewBinding.storyLoading.visibility = View.VISIBLE
        viewBinding.storyImage.visibility = View.GONE
        viewBinding.storyVideo.visibility = View.GONE
        viewBinding.storyVideo.player = null
        viewBinding.storyVideoError.visibility = View.GONE
        viewBinding.storyCaption.visibility = View.GONE

        storyLoadJob = viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.getStory(storyIds[index])
                if (!response.isSuccessful) {
                    throw IOException(apiErrorMessage(response, getString(R.string.story_load_failed)))
                }
                val story = response.body()?.story
                    ?: throw IOException(getString(R.string.story_load_failed))
                val media = story.media
                    ?: throw IOException(getString(R.string.story_media_unavailable))
                val mediaUrl = media.secureUrl
                    ?.takeIf(String::isNotBlank)
                    ?: throw IOException(getString(R.string.story_media_unavailable))

                try {
                    val viewedResponse = ApiClient.service.markStoryViewed(storyIds[index])
                    if (!viewedResponse.isSuccessful) {
                        android.util.Log.w(
                            TAG,
                            "Could not mark story ${storyIds[index]} as viewed (HTTP ${viewedResponse.code()}).",
                        )
                    }
                } catch (exception: CancellationException) {
                    throw exception
                } catch (exception: Exception) {
                    android.util.Log.w(TAG, "Could not mark story as viewed.", exception)
                }

                val owner = story.owner
                viewBinding.storyOwner.text = owner?.displayName
                    ?.takeIf(String::isNotBlank)
                    ?: owner?.username
                    ?: ownerLabel
                viewBinding.storyCaption.text = story.caption.orEmpty()
                viewBinding.storyCaption.visibility = if (story.caption.isNullOrBlank()) {
                    View.GONE
                } else {
                    View.VISIBLE
                }

                val uri = Uri.parse(mediaUrl)
                if (uri.scheme != "https" || uri.host.isNullOrBlank()) {
                    throw IOException(getString(R.string.story_media_unavailable))
                }
                when (media.resourceType) {
                    "image" -> {
                        viewBinding.storyImage.visibility = View.VISIBLE
                        RemoteImageLoader.load(
                            viewBinding.storyImage,
                            mediaUrl,
                            R.drawable.ic_profile,
                        )
                        viewBinding.storyLoading.visibility = View.GONE
                    }
                    "video" -> {
                        viewBinding.storyVideo.visibility = View.VISIBLE
                        val player = getVideoPlayer(viewBinding)
                        viewBinding.storyVideo.player = player
                        player.setMediaItem(MediaItem.fromUri(uri))
                        player.prepare()
                        player.playWhenReady = true
                    }
                    else -> throw IOException(getString(R.string.story_media_unavailable))
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                if (_binding != null) {
                    Toast.makeText(
                        requireContext(),
                        exception.message ?: getString(R.string.story_load_failed),
                        Toast.LENGTH_LONG,
                    ).show()
                    dismiss()
                }
            }
        }
    }

    private fun getVideoPlayer(viewBinding: DialogStoryViewerBinding): ExoPlayer =
        videoPlayer ?: ExoPlayer.Builder(requireContext()).build().also { player ->
            player.repeatMode = Player.REPEAT_MODE_ONE
            player.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (_binding == null) return
                    if (playbackState == Player.STATE_BUFFERING) {
                        viewBinding.storyLoading.visibility = View.VISIBLE
                    } else if (playbackState == Player.STATE_READY || playbackState == Player.STATE_ENDED) {
                        viewBinding.storyLoading.visibility = View.GONE
                        viewBinding.storyVideoError.visibility = View.GONE
                    }
                }

                override fun onPlayerError(error: PlaybackException) {
                    if (_binding == null) return
                    android.util.Log.w(TAG, "Story video playback failed.", error)
                    viewBinding.storyLoading.visibility = View.GONE
                    viewBinding.storyVideoError.visibility = View.VISIBLE
                }
            })
            videoPlayer = player
        }

    private fun bindingOrNull(): DialogStoryViewerBinding? = _binding

    companion object {
        private const val ARG_STORY_IDS = "story_ids"
        private const val ARG_OWNER_LABEL = "owner_label"
        private const val TAG = "StoryViewer"

        fun newInstance(storyIds: List<String>, ownerLabel: String) =
            StoryViewerDialogFragment().apply {
                arguments = Bundle().apply {
                    putStringArrayList(ARG_STORY_IDS, ArrayList(storyIds))
                    putString(ARG_OWNER_LABEL, ownerLabel)
                }
            }
    }
}