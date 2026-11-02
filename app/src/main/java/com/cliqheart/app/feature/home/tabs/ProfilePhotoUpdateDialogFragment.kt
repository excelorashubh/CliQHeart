package com.cliqheart.app.feature.home.tabs

import android.app.Dialog
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.Toast
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.DialogFragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.MediaSignatureRequest
import com.cliqheart.app.core.network.ProfilePhotoUpdateRequest
import com.cliqheart.app.core.security.ProfileAvatarCache
import com.cliqheart.app.databinding.DialogProfilePhotoUpdateBinding
import com.cliqheart.app.feature.home.MainShellViewModel
import com.cliqheart.app.feature.home.apiErrorMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

class ProfilePhotoUpdateDialogFragment : DialogFragment() {
    private val homeDataViewModel: MainShellViewModel by activityViewModels()
    private var _binding: DialogProfilePhotoUpdateBinding? = null
    private val binding get() = requireNotNull(_binding)
    private var selectedPhotoUri: Uri? = null
    private var isUploading = false

    private val photoPicker = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null && !isUploading) {
            selectedPhotoUri = uri
            _binding?.profilePhotoPreview?.setImageURI(uri)
            _binding?.profilePhotoStatus?.setText(R.string.profile_photo_preview_prompt)
            updatePositiveButton()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        selectedPhotoUri = savedInstanceState?.getString(STATE_SELECTED_PHOTO)?.let(Uri::parse)
    }

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        _binding = DialogProfilePhotoUpdateBinding.inflate(LayoutInflater.from(requireContext()))
        selectedPhotoUri?.let { uri ->
            binding.profilePhotoPreview.setImageURI(uri)
            binding.profilePhotoStatus.setText(R.string.profile_photo_preview_prompt)
        }
        binding.profilePhotoPreview.setOnClickListener { launchPicker() }

        return AlertDialog.Builder(requireContext())
            .setTitle(R.string.profile_photo_change_title)
            .setView(binding.root)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.choose_photo, null)
            .create()
            .also { alert ->
                alert.setOnShowListener {
                    alert.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                        if (selectedPhotoUri == null) launchPicker() else uploadSelectedPhoto()
                    }
                    alert.getButton(AlertDialog.BUTTON_NEGATIVE).setOnClickListener {
                        if (!isUploading) dismiss()
                    }
                    updatePositiveButton()
                }
            }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        selectedPhotoUri?.let { outState.putString(STATE_SELECTED_PHOTO, it.toString()) }
        super.onSaveInstanceState(outState)
    }

    private fun launchPicker() {
        if (!isUploading) {
            photoPicker.launch(
                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
            )
        }
    }

    private fun updatePositiveButton() {
        (dialog as? AlertDialog)?.getButton(AlertDialog.BUTTON_POSITIVE)?.apply {
            setText(if (selectedPhotoUri == null) R.string.choose_photo else R.string.save_profile_photo)
            isEnabled = !isUploading
        }
        _binding?.profilePhotoPreview?.isEnabled = !isUploading
    }

    private fun uploadSelectedPhoto() {
        val photoUri = selectedPhotoUri ?: return
        isUploading = true
        isCancelable = false
        binding.profilePhotoProgress.visibility = View.VISIBLE
        binding.profilePhotoStatus.setText(R.string.profile_photo_uploading)
        updatePositiveButton()
        (dialog as? AlertDialog)?.getButton(AlertDialog.BUTTON_NEGATIVE)?.isEnabled = false

        val context = requireContext().applicationContext
        lifecycleScope.launch {
            var uploadedMediaId: String? = null
            var profileUpdated = false
            var userStateUpdated = false
            try {
                val bitmap = withContext(Dispatchers.IO) {
                    val source = ImageDecoder.createSource(context.contentResolver, photoUri)
                    ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                        val scale = minOf(1f, 512f / maxOf(info.size.width, info.size.height))
                        decoder.setTargetSize(
                            (info.size.width * scale).toInt().coerceAtLeast(1),
                            (info.size.height * scale).toInt().coerceAtLeast(1),
                        )
                        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    }
                }
                val signatureResponse = ApiClient.service.createMediaSignature(
                    MediaSignatureRequest(purpose = "profile", resourceType = "image"),
                )
                if (!signatureResponse.isSuccessful) {
                    throw IOException(getString(R.string.profile_photo_upload_failed))
                }
                val signature = signatureResponse.body()
                    ?: throw IOException(getString(R.string.profile_photo_upload_failed))
                val mediaId = signature.media?.id
                    ?: throw IOException(getString(R.string.profile_photo_upload_failed))
                uploadedMediaId = mediaId
                val upload = signature.upload
                    ?: throw IOException(getString(R.string.profile_photo_upload_failed))
                ApiClient.uploadToCloudinary(context, upload, photoUri)

                val confirmation = ApiClient.service.confirmMedia(mediaId)
                if (!confirmation.isSuccessful || confirmation.body()?.media?.status != "ready") {
                    throw IOException(getString(R.string.profile_photo_upload_failed))
                }
                val response = ApiClient.service.updateMyProfilePhoto(
                    ProfilePhotoUpdateRequest(avatarMediaId = mediaId),
                )
                if (!response.isSuccessful) {
                    throw IOException(apiErrorMessage(response, getString(R.string.profile_photo_upload_failed)))
                }
                profileUpdated = true
                val user = response.body()?.user
                    ?: throw IOException(getString(R.string.profile_photo_upload_failed))
                val userId = user.id?.takeIf(String::isNotBlank)
                    ?: user._id?.takeIf(String::isNotBlank)
                    ?: user.username?.takeIf(String::isNotBlank)
                    ?: throw IOException(getString(R.string.profile_photo_upload_failed))

                withContext(Dispatchers.IO) {
                    ProfileAvatarCache.saveAvatarBitmap(context, userId, bitmap)
                }
                homeDataViewModel.updateCurrentUserAfterProfilePhotoChange(user)
                userStateUpdated = true
                uploadedMediaId = null
                Toast.makeText(context, R.string.profile_photo_updated, Toast.LENGTH_SHORT).show()
                dismiss()
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                binding.profilePhotoStatus.text =
                    exception.message ?: getString(R.string.profile_photo_upload_failed)
            } finally {
                if (!profileUpdated) {
                    uploadedMediaId?.let { mediaId ->
                        withContext(NonCancellable) {
                            runCatching { ApiClient.service.deleteMedia(mediaId) }
                        }
                    }
                }
                if (profileUpdated && !userStateUpdated) {
                    homeDataViewModel.loadProfile(force = true)
                }
                if (_binding != null) {
                    isUploading = false
                    binding.profilePhotoProgress.visibility = View.GONE
                    updatePositiveButton()
                    isCancelable = true
                    (dialog as? AlertDialog)?.getButton(AlertDialog.BUTTON_NEGATIVE)?.isEnabled = true
                }
            }
        }
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    companion object {
        private const val STATE_SELECTED_PHOTO = "selected_profile_photo"
    }
}
