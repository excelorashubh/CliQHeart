package com.cliqheart.app.feature.home

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import com.cliqheart.app.R
import com.cliqheart.app.databinding.FragmentMainShellBinding

class MainShellFragment : Fragment() {
    private var _binding: FragmentMainShellBinding? = null
    private val binding get() = requireNotNull(_binding)

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentMainShellBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.bottomNavigation.setOnItemSelectedListener { item ->
            val title = when (item.itemId) {
                R.id.homeTab -> R.string.home
                R.id.discoverTab -> R.string.discover
                R.id.createTab -> R.string.create
                R.id.activityTab -> R.string.activity
                R.id.profileTab -> R.string.profile
                else -> return@setOnItemSelectedListener false
            }
            binding.placeholderMessage.text =
                getString(title) + ": " + getString(R.string.phase_zero_notice)
            true
        }
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
