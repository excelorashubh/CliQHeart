package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.os.bundleOf
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.cliqheart.app.R
import com.cliqheart.app.databinding.DialogProfileMoreMenuBinding
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.bottomsheet.BottomSheetDialogFragment

class ProfileMoreMenuBottomSheetFragment : BottomSheetDialogFragment() {
    private var _binding: DialogProfileMoreMenuBinding? = null
    private val binding get() = requireNotNull(_binding)
    private val username: String get() = requireArguments().getString(ARG_USERNAME).orEmpty()
    private val showSaved: Boolean get() = requireArguments().getBoolean(ARG_SHOW_SAVED)
    private val showProfessional: Boolean get() = requireArguments().getBoolean(ARG_SHOW_PROFESSIONAL)

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = DialogProfileMoreMenuBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.profileMenuUsername.text = username.takeIf(String::isNotBlank)?.let {
            getString(R.string.username_at, it)
        }.orEmpty()
        binding.profileMenuSaved.visibility = if (showSaved) View.VISIBLE else View.GONE
        binding.profileMenuActivityHeading.visibility = if (showSaved) View.VISIBLE else View.GONE
        binding.profileMenuProfessional.visibility = if (showProfessional) View.VISIBLE else View.GONE
        binding.profileMenuProfessionalHeading.visibility = if (showProfessional) View.VISIBLE else View.GONE

        binding.profileMenuEditProfile.setOnClickListener { select(ACTION_EDIT_PROFILE) }
        binding.profileMenuSaved.setOnClickListener { select(ACTION_SAVED) }
        binding.profileMenuProfessional.setOnClickListener { select(ACTION_PROFESSIONAL) }
        binding.profileMenuNotifications.setOnClickListener { select(ACTION_NOTIFICATIONS) }
        binding.profileMenuLogout.setOnClickListener { select(ACTION_LOGOUT) }

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
        parentFragmentManager.setFragmentResult(
            REQUEST_KEY,
            bundleOf(KEY_ACTION to action),
        )
        dismiss()
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    companion object {
        const val REQUEST_KEY = "profile_more_menu_action"
        const val KEY_ACTION = "action"
        const val ACTION_EDIT_PROFILE = "edit_profile"
        const val ACTION_SAVED = "saved"
        const val ACTION_PROFESSIONAL = "professional"
        const val ACTION_NOTIFICATIONS = "notifications"
        const val ACTION_LOGOUT = "logout"

        private const val ARG_USERNAME = "username"
        private const val ARG_SHOW_SAVED = "show_saved"
        private const val ARG_SHOW_PROFESSIONAL = "show_professional"

        fun newInstance(
            username: String?,
            showSaved: Boolean,
            showProfessional: Boolean,
        ) = ProfileMoreMenuBottomSheetFragment().apply {
            arguments = bundleOf(
                ARG_USERNAME to username,
                ARG_SHOW_SAVED to showSaved,
                ARG_SHOW_PROFESSIONAL to showProfessional,
            )
        }
    }
}
