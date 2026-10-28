package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import com.cliqheart.app.core.ui.limitContentWidth
import com.cliqheart.app.databinding.FragmentCreatePostBinding

class CreatePostFragment : Fragment() {
    private var _binding: FragmentCreatePostBinding? = null
    private val binding get() = requireNotNull(_binding)

    private val photoPicker = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            binding.createPreviewImage.setImageURI(uri)
            binding.selectPhotoPlaceholder.visibility = View.GONE
        }
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

        binding.selectPhotoFrame.setOnClickListener {
            photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }

        binding.btnSharePost.setOnClickListener {
            val caption = binding.captionInput.text?.toString().orEmpty()
            if (caption.isBlank()) {
                Toast.makeText(requireContext(), "Please write a caption", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            Toast.makeText(requireContext(), "Post shared successfully!", Toast.LENGTH_SHORT).show()
            binding.captionInput.text?.clear()
            binding.locationInput.text?.clear()
            binding.createPreviewImage.setImageDrawable(null)
            binding.selectPhotoPlaceholder.visibility = View.VISIBLE
        }
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
