package com.cliqheart.app.feature.splash

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.LogoutRequest
import com.cliqheart.app.core.network.RefreshRequest
import com.cliqheart.app.core.security.SecureTokenStore
import com.cliqheart.app.databinding.FragmentSplashBinding
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class SplashFragment : Fragment() {
    private var _binding: FragmentSplashBinding? = null
    private val binding get() = requireNotNull(_binding)
    private var restoring = false

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentSplashBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        restoreSession()
    }

    private fun restoreSession() {
        if (restoring || _binding == null) return
        restoring = true
        binding.splashProgress.visibility = View.VISIBLE
        viewLifecycleOwner.lifecycleScope.launch {
            val store = SecureTokenStore(requireContext())
            try {
                val saved = store.readSession()
                val pendingRevocation = saved?.pendingRevocationToken
                if (!pendingRevocation.isNullOrBlank()) {
                    try {
                        val revoke = ApiClient.service.logout(LogoutRequest(pendingRevocation))
                        if (revoke.isSuccessful) store.clearPendingRevocation()
                    } catch (exception: CancellationException) {
                        throw exception
                    } catch (_: Exception) {
                        // Keep the encrypted pending token for the next launch.
                    }
                }

                var session = store.readSession()
                if (session?.refreshToken.isNullOrBlank()) {
                    showWelcome()
                    return@launch
                }
                val refresh = ApiClient.service.refresh(RefreshRequest(requireNotNull(session?.refreshToken)))
                val tokens = refresh.body()
                if (!refresh.isSuccessful || tokens?.accessToken.isNullOrBlank() || tokens?.refreshToken.isNullOrBlank()) {
                    if (refresh.code() == 401 || refresh.code() == 403) {
                        store.clear()
                        showWelcome()
                    } else {
                        showRetry()
                    }
                    return@launch
                }
                store.saveSession(
                    requireNotNull(tokens.accessToken),
                    requireNotNull(tokens.refreshToken),
                    tokens.user ?: session?.currentUser,
                )
                session = store.readSession()

                val response = ApiClient.service.getMyProfile()
                if (response.isSuccessful && response.body()?.user != null) {
                    val current = store.readSession() ?: session
                    store.saveSession(
                        requireNotNull(current?.accessToken),
                        requireNotNull(current.refreshToken),
                        response.body()?.user,
                    )
                    findNavController().navigate(R.id.action_splash_to_mainShell)
                } else if (response.code() == 401 || response.code() == 403) {
                    store.clear()
                    showWelcome()
                } else {
                    showRetry()
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                showRetry()
            } finally {
                restoring = false
            }
        }
    }

    private fun showWelcome() {
        if (_binding == null) return
        findNavController().navigate(R.id.action_splash_to_welcome)
    }

    private fun showRetry() {
        if (_binding == null) return
        binding.splashProgress.visibility = View.GONE
        binding.splashFooter.text = getString(R.string.session_restore_failed)
        Snackbar.make(binding.root, R.string.session_restore_failed, Snackbar.LENGTH_INDEFINITE)
            .setAction(R.string.retry) { restoreSession() }
            .show()
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
