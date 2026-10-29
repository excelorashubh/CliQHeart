package com.cliqheart.app.feature.auth

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.cliqheart.app.core.ui.limitContentWidth
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.RegisterRequest
import com.cliqheart.app.R
import com.cliqheart.app.databinding.FragmentSignupBinding
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

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
        view.limitContentWidth(480)
        binding.submitButton.setOnClickListener {
            submitSignup()
        }
    }

    private fun submitSignup() {
        val username = binding.usernameInput.text?.toString().orEmpty().trim()
        val email = binding.emailInput.text?.toString().orEmpty().trim()
        val password = binding.passwordInput.text?.toString().orEmpty()
        val confirmation = binding.confirmPasswordInput.text?.toString().orEmpty()

        binding.usernameLayout.error = AuthValidation.usernameError(username)
        binding.emailLayout.error = AuthValidation.emailError(email)
        binding.passwordLayout.error = AuthValidation.registrationPasswordError(password)
        binding.confirmPasswordLayout.error = AuthValidation.confirmationError(password, confirmation)

        if (binding.usernameLayout.error != null ||
            binding.emailLayout.error != null ||
            binding.passwordLayout.error != null ||
            binding.confirmPasswordLayout.error != null
        ) {
            return
        }

        if (!binding.termsCheckbox.isChecked) {
            Snackbar.make(binding.root, R.string.terms_required, Snackbar.LENGTH_LONG).show()
            return
        }

        setSubmitLoading(true)

        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.register(
                    RegisterRequest(
                        displayName = username,
                        username = username,
                        email = email,
                        password = password,
                        confirmPassword = confirmation,
                        agreeToTerms = binding.termsCheckbox.isChecked,
                    ),
                )

                if (response.isSuccessful) {
                    val body = response.body()
                    val accessToken = body?.accessToken
                    val refreshToken = body?.refreshToken
                    if (accessToken.isNullOrBlank() || refreshToken.isNullOrBlank()) {
                        throw IllegalStateException("Authentication response was incomplete.")
                    }
                    val currentUser = body.user
                    if (currentUser?.id.isNullOrBlank() && currentUser?._id.isNullOrBlank()) {
                        throw IllegalStateException("Authentication response did not include a user profile.")
                    }
                    val tokenStore = com.cliqheart.app.core.security.SecureTokenStore(requireContext())
                    tokenStore.saveSession(accessToken, refreshToken, body.user)
                    tokenStore.saveCurrentUser(requireNotNull(currentUser))
                    binding.passwordInput.text?.clear()
                    binding.confirmPasswordInput.text?.clear()
                    Toast.makeText(requireContext(), "Account created. Welcome to CliQHeart!", Toast.LENGTH_SHORT).show()
                    findNavController().navigate(R.id.mainShellFragment)
                    return@launch
                }

                val failure = AuthNetworkErrors.fromHttpResponse(
                    context = requireContext(),
                    statusCode = response.code(),
                    responseBody = response.errorBody()?.string(),
                    isLogin = false,
                )
                showFailure(failure)
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                showFailure(AuthNetworkErrors.fromException(requireContext(), exception))
            } finally {
                if (_binding != null) {
                    setSubmitLoading(false)
                }
            }
        }
    }

    private fun showFailure(failure: AuthNetworkErrors.Failure) {
        val snackbar = Snackbar.make(
            binding.root,
            failure.message,
            if (failure.retryable) Snackbar.LENGTH_INDEFINITE else Snackbar.LENGTH_LONG,
        )
        if (failure.retryable) {
            snackbar.setAction(R.string.retry) { submitSignup() }
        }
        snackbar.show()
    }

    private fun setSubmitLoading(loading: Boolean) {
        binding.submitButton.isEnabled = !loading
        binding.submitButton.text = if (loading) getString(R.string.creating_account) else getString(R.string.create_account)
        binding.loadingIndicator.visibility = if (loading) View.VISIBLE else View.GONE
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
