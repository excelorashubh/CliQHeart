package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.cliqheart.app.R
import com.cliqheart.app.databinding.DialogProfilePhotoActionsBinding
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.bottomsheet.BottomSheetDialogFragment

class ProfilePhotoActionsBottomSheetFragment : BottomSheetDialogFragment() {
    private var _binding: DialogProfilePhotoActionsBinding? = null
    private val binding get() = requireNotNull(_binding)
    private val hasProfilePhoto: Boolean
        get() = requireArguments().getBoolean(ARG_HAS_PROFILE_PHOTO)

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = DialogProfilePhotoActionsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.profilePhotoAddStory.setOnClickListener { select(ACTION_ADD_STORY) }
        binding.profilePhotoChange.setOnClickListener { select(ACTION_CHANGE_PHOTO) }
        binding.profilePhotoRemove.isEnabled = hasProfilePhoto
        binding.profilePhotoRemove.alpha = if (hasProfilePhoto) 1f else 0.45f
        binding.profilePhotoRemove.setOnClickListener {
            if (hasProfilePhoto) select(ACTION_REMOVE_PHOTO)
        }

        val initialBottomPadding = view.paddingBottom
        ViewCompat.setOnApplyWindowInsetsListener(view) { insetView, insets ->
            val bottomInset = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
            insetView.setPadding(
                insetView.paddingLeft,
                insetView.paddingTop,
                insetView.paddingRight,
                maxOf(initialBottomPadding, bottomInset),
            )
            insets
        }
        ViewCompat.requestApplyInsets(view)
    }

    override fun onStart() {
        super.onStart()
        dialog?.window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        (dialog as? BottomSheetDialog)?.behavior?.apply {
            state = BottomSheetBehavior.STATE_EXPANDED
            skipCollapsed = true
        }
    }

    private fun select(action: String) {
        if (parentFragmentManager.isStateSaved) return
        parentFragmentManager.setFragmentResult(REQUEST_KEY, Bundle().apply {
            putString(KEY_ACTION, action)
        })
        dismiss()
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    companion object {
        const val REQUEST_KEY = "profile_photo_action"
        const val KEY_ACTION = "action"
        const val ACTION_ADD_STORY = "add_story"
        const val ACTION_CHANGE_PHOTO = "change_photo"
        const val ACTION_REMOVE_PHOTO = "remove_photo"

        private const val ARG_HAS_PROFILE_PHOTO = "has_profile_photo"

        fun newInstance(hasProfilePhoto: Boolean) =
            ProfilePhotoActionsBottomSheetFragment().apply {
                arguments = Bundle().apply { putBoolean(ARG_HAS_PROFILE_PHOTO, hasProfilePhoto) }
            }
    }
}
