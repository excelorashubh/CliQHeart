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
import com.cliqheart.app.core.network.LoginRequest
import com.cliqheart.app.core.security.SecureTokenStore
import com.cliqheart.app.R
import com.cliqheart.app.databinding.FragmentLoginBinding
import com.cliqheart.app.feature.auth.AuthNetworkErrors
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

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
        view.limitContentWidth(480)
        binding.submitButton.setOnClickListener {
            submitLogin()
        }
    }

    private fun submitLogin() {
        val email = binding.emailInput.text?.toString().orEmpty().trim()
        val password = binding.passwordInput.text?.toString().orEmpty()

        binding.emailLayout.error = AuthValidation.loginIdentifierError(email)
        binding.passwordLayout.error = AuthValidation.loginPasswordError(password)

        if (binding.emailLayout.error != null || binding.passwordLayout.error != null) {
            return
        }

        setSubmitLoading(true)

        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.login(
                    LoginRequest(
                        identifier = email,
                        password = password,
                    ),
                )

                if (response.isSuccessful) {
                    val body = response.body()
                    val accessToken = body?.accessToken
                    val refreshToken = body?.refreshToken

                    if (accessToken.isNullOrBlank() || refreshToken.isNullOrBlank()) {
                        throw IllegalStateException("Authentication response was incomplete.")
                    }

                    SecureTokenStore(requireContext()).saveSession(
                        accessToken,
                        refreshToken,
                        body.user,
                    )
                    Toast.makeText(requireContext(), "Welcome back!", Toast.LENGTH_SHORT).show()
                    findNavController().navigate(R.id.mainShellFragment)
                    return@launch
                }

                val failure = AuthNetworkErrors.fromHttpResponse(
                    context = requireContext(),
                    statusCode = response.code(),
                    responseBody = response.errorBody()?.string(),
                    isLogin = true,
                )
                binding.passwordLayout.error = failure.message
                showFailure(failure)
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                val failure = AuthNetworkErrors.fromException(requireContext(), exception)
                binding.passwordLayout.error = failure.message
                showFailure(failure)
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
            snackbar.setAction(R.string.retry) { submitLogin() }
        }
        snackbar.show()
    }

    private fun setSubmitLoading(loading: Boolean) {
        binding.submitButton.isEnabled = !loading
        binding.submitButton.text = if (loading) getString(R.string.signing_in) else getString(R.string.continue_login)
        binding.loadingIndicator.visibility = if (loading) View.VISIBLE else View.GONE
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
