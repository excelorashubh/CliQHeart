package com.cliqheart.app.feature.home

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.Lifecycle
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
            if (!showTab(item.itemId)) return@setOnItemSelectedListener false
            true
        }

        val selectedTab = savedInstanceState?.getInt(SELECTED_TAB_KEY, R.id.homeTab) ?: R.id.homeTab
        binding.bottomNavigation.selectedItemId = selectedTab
        showTab(selectedTab)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt(
            SELECTED_TAB_KEY,
            _binding?.bottomNavigation?.selectedItemId ?: R.id.homeTab,
        )
        super.onSaveInstanceState(outState)
    }

    private fun showTab(tabId: Int): Boolean {
        val (tag, newFragment) = when (tabId) {
            R.id.homeTab -> "home" to { HomeFeedFragment() }
            R.id.discoverTab -> "discover" to { DiscoverFragment() }
            R.id.createTab -> "create" to { CreatePostFragment() }
            R.id.activityTab -> "activity" to { ActivityFragment() }
            R.id.profileTab -> "profile" to { ProfileFragment() }
            else -> return false
        }
        val manager = childFragmentManager
        val fragment = manager.findFragmentByTag(tag) ?: newFragment()
        manager.beginTransaction().apply {
            manager.fragments.filter { it.isAdded }.forEach {
                hide(it)
                setMaxLifecycle(it, Lifecycle.State.STARTED)
            }
            if (fragment.isAdded) {
                show(fragment)
            } else {
                add(R.id.tab_container, fragment, tag)
            }
            setMaxLifecycle(fragment, Lifecycle.State.RESUMED)
        }.commit()
        return true
    }

    fun openDiscover() {
        if (_binding != null) binding.bottomNavigation.selectedItemId = R.id.discoverTab
    }

    fun openActivity() {
        if (_binding != null) binding.bottomNavigation.selectedItemId = R.id.activityTab
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    private companion object {
        const val SELECTED_TAB_KEY = "selected_tab_id"
    }
}
