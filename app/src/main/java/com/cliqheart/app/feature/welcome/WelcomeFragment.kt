package com.cliqheart.app.feature.welcome

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.navigation.fragment.findNavController
import com.cliqheart.app.core.di.AppContainer
import com.cliqheart.app.R
import com.cliqheart.app.databinding.FragmentWelcomeBinding

class WelcomeFragment : Fragment() {
    private var _binding: FragmentWelcomeBinding? = null
    private val binding get() = requireNotNull(_binding)
    private val viewModel: WelcomeViewModel by viewModels {
        WelcomeViewModel.Factory(AppContainer.healthRepository)
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentWelcomeBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.signupButton.setOnClickListener {
            findNavController().navigate(R.id.action_welcome_to_signup)
        }
        binding.loginButton.setOnClickListener {
            findNavController().navigate(R.id.action_welcome_to_login)
        }
        viewModel.apiStatus.observe(viewLifecycleOwner) { status ->
            binding.backendStatus.text = status
        }
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
