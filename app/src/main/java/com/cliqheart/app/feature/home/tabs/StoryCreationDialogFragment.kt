package com.cliqheart.app.feature.home.tabs

import android.app.Dialog
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.DialogFragment
import androidx.lifecycle.lifecycleScope
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.MediaSignatureRequest
import com.cliqheart.app.core.network.StoryCreateRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

class StoryCreationDialogFragment : DialogFragment() {
    private val photoPicker = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) publishStory(uri)
    }

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        val dialog = AlertDialog.Builder(requireContext())
            .setTitle(R.string.create_story)
            .setMessage(R.string.story_photo_prompt)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.choose_photo, null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                dialog.dismiss()
                photoPicker.launch(
                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                )
            }
        }
        return dialog
    }

    private fun publishStory(uri: android.net.Uri) {
        val context = requireContext().applicationContext
        Toast.makeText(context, R.string.story_publishing, Toast.LENGTH_SHORT).show()
        lifecycleScope.launch {
            var mediaId: String? = null
            var published = false
            try {
                val signatureResponse = ApiClient.service.createMediaSignature(
                    MediaSignatureRequest(purpose = "story", resourceType = "image"),
                )
                if (!signatureResponse.isSuccessful) {
                    throw IOException(getString(R.string.story_publish_failed))
                }
                val signature = signatureResponse.body()
                    ?: throw IOException(getString(R.string.story_publish_failed))
                mediaId = signature.media?.id
                    ?: throw IOException(getString(R.string.story_publish_failed))
                val upload = signature.upload
                    ?: throw IOException(getString(R.string.story_publish_failed))
                ApiClient.uploadToCloudinary(context, upload, uri)

                val confirmation = ApiClient.service.confirmMedia(mediaId)
                if (!confirmation.isSuccessful || confirmation.body()?.media?.status != "ready") {
                    throw IOException(getString(R.string.story_publish_failed))
                }
                val storyResponse = ApiClient.service.createStory(StoryCreateRequest(mediaId))
                if (!storyResponse.isSuccessful || storyResponse.body()?.story?.id.isNullOrBlank()) {
                    throw IOException(getString(R.string.story_publish_failed))
                }
                published = true
                parentFragmentManager.setFragmentResult(STORY_PUBLISHED_REQUEST_KEY, Bundle.EMPTY)
                Toast.makeText(context, R.string.story_publish_success, Toast.LENGTH_SHORT).show()
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                Toast.makeText(
                    context,
                    exception.message ?: getString(R.string.story_publish_failed),
                    Toast.LENGTH_LONG,
                ).show()
            } finally {
                if (!published) {
                    mediaId?.let { uploadId ->
                        withContext(NonCancellable) {
                            runCatching { ApiClient.service.deleteMedia(uploadId) }
                        }
                    }
                }
            }
        }
    }
}