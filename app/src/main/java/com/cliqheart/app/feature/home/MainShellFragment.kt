package com.cliqheart.app.feature.home

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.Fragment
import com.cliqheart.app.R
import com.cliqheart.app.databinding.FragmentMainShellBinding
import com.cliqheart.app.feature.home.tabs.ActivityFragment
import com.cliqheart.app.feature.home.tabs.CreatePostFragment
import com.cliqheart.app.feature.home.tabs.DiscoverFragment
import com.cliqheart.app.feature.home.tabs.HomeFeedFragment
import com.cliqheart.app.feature.home.tabs.ProfileFragment

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
        ViewCompat.setOnApplyWindowInsetsListener(binding.bottomNavigation) { bottomNav, insets ->
            val navBarInsets = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
            bottomNav.setPadding(
                bottomNav.paddingLeft,
                bottomNav.paddingTop,
                bottomNav.paddingRight,
                navBarInsets.bottom,
            )
            insets
        }

        binding.bottomNavigation.setOnItemSelectedListener { item ->
            val fragment: Fragment = when (item.itemId) {
                R.id.homeTab -> HomeFeedFragment()
                R.id.discoverTab -> DiscoverFragment()
                R.id.createTab -> CreatePostFragment()
                R.id.activityTab -> ActivityFragment()
                R.id.profileTab -> ProfileFragment()
                else -> return@setOnItemSelectedListener false
            }
            switchTab(fragment)
            true
        }

        if (savedInstanceState == null) {
            switchTab(HomeFeedFragment())
        } else {
            binding.bottomNavigation.selectedItemId =
                savedInstanceState.getInt(SELECTED_TAB_KEY, R.id.homeTab)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt(
            SELECTED_TAB_KEY,
            _binding?.bottomNavigation?.selectedItemId ?: R.id.homeTab,
        )
        super.onSaveInstanceState(outState)
    }

    private fun switchTab(fragment: Fragment) {
        childFragmentManager.beginTransaction()
            .replace(R.id.tab_container, fragment)
            .commit()
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    private companion object {
        const val SELECTED_TAB_KEY = "selected_tab_id"
    }
}
