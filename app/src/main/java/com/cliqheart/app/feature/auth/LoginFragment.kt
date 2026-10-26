package com.cliqheart.app.feature.auth

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import com.cliqheart.app.R
import com.cliqheart.app.databinding.FragmentLoginBinding

class LoginFragment : Fragment() {
    private var _binding: FragmentLoginBinding? = null
    private val binding get() = requireNotNull(_binding)

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentLoginBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.submitButton.setOnClickListener {
            val email = binding.emailInput.text?.toString().orEmpty()
            val password = binding.passwordInput.text?.toString().orEmpty()
            binding.emailLayout.error = AuthValidation.emailError(email)
            binding.passwordLayout.error = AuthValidation.loginPasswordError(password)

            if (binding.emailLayout.error == null && binding.passwordLayout.error == null) {
                binding.passwordInput.text?.clear()
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
