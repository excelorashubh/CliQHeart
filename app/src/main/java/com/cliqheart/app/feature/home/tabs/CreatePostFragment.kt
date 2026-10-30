package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.net.Uri
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.util.Log
import android.widget.Toast
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.MediaSignatureRequest
import com.cliqheart.app.core.network.PostCreateRequest
import com.cliqheart.app.R
import com.cliqheart.app.core.ui.limitContentWidth
import com.cliqheart.app.databinding.FragmentCreatePostBinding
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import retrofit2.Response

class CreatePostFragment : Fragment() {
    private var _binding: FragmentCreatePostBinding? = null
    private val binding get() = requireNotNull(_binding)
    private var selectedPhotoUri: Uri? = null
    private var confirmedMediaId: String? = null
    private var publishing = false
    private var restoredCaption: String? = null

    private val photoPicker = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            selectPhoto(uri)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        selectedPhotoUri = savedInstanceState?.getString(STATE_SELECTED_PHOTO)?.let(Uri::parse)
        confirmedMediaId = savedInstanceState?.getString(STATE_CONFIRMED_MEDIA_ID)
        restoredCaption = savedInstanceState?.getString(STATE_CAPTION)
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentCreatePostBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        view.limitContentWidth(600)
        selectedPhotoUri?.let(::displayPhoto)
        restoredCaption?.let { binding.captionInput.setText(it) }

        binding.selectPhotoFrame.setOnClickListener {
            if (publishing) return@setOnClickListener
            photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }

        binding.btnSharePost.setOnClickListener {
            publishPost()
        }
    }

    private fun selectPhoto(uri: Uri) {
        if (publishing) return
        val previousMediaId = confirmedMediaId
        if (previousMediaId == null) {
            selectedPhotoUri = uri
            displayPhoto(uri)
            return
        }

        binding.btnSharePost.isEnabled = false
        binding.btnSharePost.text = getString(R.string.post_removing_upload)
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                discardUpload(previousMediaId)
                confirmedMediaId = null
                selectedPhotoUri = uri
                displayPhoto(uri)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                Toast.makeText(
                    requireContext(),
                    getString(R.string.post_upload_cleanup_failed, error.message.orEmpty()),
                    Toast.LENGTH_LONG,
                ).show()
            } finally {
                _binding?.let {
                    it.btnSharePost.isEnabled = true
                    it.btnSharePost.setText(R.string.share_post)
                }
            }
        }
    }

    private fun displayPhoto(uri: Uri) {
        _binding?.let {
            it.createPreviewImage.setImageURI(uri)
            it.selectPhotoPlaceholder.visibility = View.GONE
        }
    }

    private fun publishPost() {
        val imageUri = selectedPhotoUri
        if (imageUri == null) {
            Toast.makeText(requireContext(), R.string.post_photo_required, Toast.LENGTH_SHORT).show()
            return
        }
        val caption = binding.captionInput.text?.toString()?.trim().orEmpty()
        if (caption.isBlank()) {
            Toast.makeText(requireContext(), R.string.caption_required, Toast.LENGTH_SHORT).show()
            return
        }
        if (publishing) return

        publishing = true
        binding.btnSharePost.isEnabled = false
        binding.selectPhotoFrame.isEnabled = false
        binding.createProgressBar.visibility = View.VISIBLE
        viewLifecycleOwner.lifecycleScope.launch {
            var unconfirmedMediaId: String? = null
            try {
                var mediaId = confirmedMediaId
                if (mediaId == null) {
                    binding.btnSharePost.setText(R.string.post_uploading)
                    val signedResponse = ApiClient.service.createMediaSignature(
                        MediaSignatureRequest(purpose = "post", resourceType = "image"),
                    )
                    if (!signedResponse.isSuccessful) throw Exception(errorMessage(signedResponse))
                    val signature = signedResponse.body()
                        ?: throw Exception(getString(R.string.post_upload_failed))
                    unconfirmedMediaId = signature.media?.id
                        ?: throw Exception(getString(R.string.post_upload_failed))
                    val upload = signature.upload
                        ?: throw Exception(getString(R.string.post_upload_failed))
                    ApiClient.uploadToCloudinary(requireContext(), upload, imageUri)

                    binding.btnSharePost.setText(R.string.post_confirming_upload)
                    val confirmedResponse = ApiClient.service.confirmMedia(unconfirmedMediaId)
                    if (!confirmedResponse.isSuccessful) throw Exception(errorMessage(confirmedResponse))
                    mediaId = confirmedResponse.body()?.media?.id
                        ?.takeIf { confirmedResponse.body()?.media?.status == "ready" }
                        ?: throw Exception(getString(R.string.post_upload_failed))
                    confirmedMediaId = mediaId
                    unconfirmedMediaId = null
                }

                binding.btnSharePost.setText(R.string.post_publishing)
                val postResponse = ApiClient.service.createPost(
                    PostCreateRequest(mediaId = mediaId, caption = caption),
                )
                if (!postResponse.isSuccessful || postResponse.body()?.post?.id.isNullOrBlank()) {
                    throw Exception(errorMessage(postResponse))
                }

                selectedPhotoUri = null
                confirmedMediaId = null
                binding.captionInput.text?.clear()
                binding.createPreviewImage.setImageDrawable(null)
                binding.selectPhotoPlaceholder.visibility = View.VISIBLE
                parentFragmentManager.setFragmentResult(POST_PUBLISHED_REQUEST_KEY, Bundle.EMPTY)
                Toast.makeText(requireContext(), R.string.post_share_success, Toast.LENGTH_LONG).show()
            } catch (error: Exception) {
                if (error is CancellationException) {
                    unconfirmedMediaId?.let { mediaId ->
                        withContext(NonCancellable) {
                            try {
                                discardUpload(mediaId)
                            } catch (cleanupError: Exception) {
                                Log.w(TAG, "Could not delete cancelled media upload.", cleanupError)
                            }
                        }
                    }
                    throw error
                }
                var failureMessage = error.message.orEmpty()
                unconfirmedMediaId?.let { mediaId ->
                    try {
                        discardUpload(mediaId)
                    } catch (cleanupError: Exception) {
                        failureMessage += " ${getString(R.string.post_media_cleanup_failed, cleanupError.message.orEmpty())}"
                    }
                }
                Toast.makeText(
                    requireContext(),
                    getString(R.string.post_upload_failed_with_reason, failureMessage),
                    Toast.LENGTH_LONG,
                ).show()
            } finally {
                publishing = false
                _binding?.let {
                    it.btnSharePost.isEnabled = true
                    it.btnSharePost.setText(R.string.share_post)
                    it.selectPhotoFrame.isEnabled = true
                    it.createProgressBar.visibility = View.GONE
                }
            }
        }
    }

    private suspend fun discardUpload(mediaId: String) {
        val response = ApiClient.service.deleteMedia(mediaId)
        if (!response.isSuccessful) throw Exception(errorMessage(response))
    }

    private fun <T> errorMessage(response: Response<T>): String {
        val message = response.errorBody()?.use { body ->
            runCatching { JSONObject(body.string()).optString("error") }.getOrNull()
        }
        return message?.takeIf(String::isNotBlank) ?: "Request failed (${response.code()})."
    }

    override fun onSaveInstanceState(outState: Bundle) {
        selectedPhotoUri?.let { outState.putString(STATE_SELECTED_PHOTO, it.toString()) }
        confirmedMediaId?.let { outState.putString(STATE_CONFIRMED_MEDIA_ID, it) }
        outState.putString(STATE_CAPTION, _binding?.captionInput?.text?.toString().orEmpty())
        super.onSaveInstanceState(outState)
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    private companion object {
        const val TAG = "CreatePostFragment"
        const val STATE_SELECTED_PHOTO = "selected_photo_uri"
        const val STATE_CONFIRMED_MEDIA_ID = "confirmed_media_id"
        const val STATE_CAPTION = "caption"
    }
}
