package com.cliqheart.app.feature.splash

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.cliqheart.app.R
import com.cliqheart.app.core.security.SecureTokenStore
import com.cliqheart.app.databinding.FragmentSplashBinding
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class SplashFragment : Fragment() {
    private var _binding: FragmentSplashBinding? = null
    private val binding get() = requireNotNull(_binding)

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentSplashBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        viewLifecycleOwner.lifecycleScope.launch {
            delay(1200) // Brief smooth splash transition
            if (_binding == null) return@launch

            val tokenStore = SecureTokenStore(requireContext())
            val session = tokenStore.readSession()
            val isAuthenticated = !session?.accessToken.isNullOrBlank()

            if (isAuthenticated) {
                findNavController().navigate(
                    R.id.action_splash_to_mainShell,
                )
            } else {
                findNavController().navigate(
                    R.id.action_splash_to_welcome,
                )
            }
        }
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
