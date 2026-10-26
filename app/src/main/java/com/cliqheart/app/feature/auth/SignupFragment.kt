package com.cliqheart.app.feature.auth

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import com.cliqheart.app.R
import com.cliqheart.app.databinding.FragmentSignupBinding

class SignupFragment : Fragment() {
    private var _binding: FragmentSignupBinding? = null
    private val binding get() = requireNotNull(_binding)

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentSignupBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.submitButton.setOnClickListener {
            val username = binding.usernameInput.text?.toString().orEmpty()
            val email = binding.emailInput.text?.toString().orEmpty()
            val password = binding.passwordInput.text?.toString().orEmpty()
            val confirmation = binding.confirmPasswordInput.text?.toString().orEmpty()
            binding.usernameLayout.error = AuthValidation.usernameError(username)
            binding.emailLayout.error = AuthValidation.emailError(email)
            binding.passwordLayout.error = AuthValidation.registrationPasswordError(password)
            binding.confirmPasswordLayout.error =
                AuthValidation.confirmationError(password, confirmation)

            if (binding.usernameLayout.error == null &&
                binding.emailLayout.error == null &&
                binding.passwordLayout.error == null &&
                binding.confirmPasswordLayout.error == null
            ) {
                binding.passwordInput.text?.clear()
                binding.confirmPasswordInput.text?.clear()
                AlertDialog.Builder(requireContext())
                    .setTitle(R.string.planned_title)
                    .setMessage(R.string.phase_zero_notice)
                    .setPositiveButton(android.R.string.ok, null)
                    .show()
            }
        }
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
