package com.cliqheart.app.feature.home

import android.os.Bundle
import android.graphics.drawable.GradientDrawable
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.Lifecycle
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.cliqheart.app.R
import com.cliqheart.app.core.network.UserResponse
import com.cliqheart.app.core.security.ProfileAvatarCache
import com.cliqheart.app.databinding.ItemBottomNavigationBinding
import com.cliqheart.app.databinding.FragmentMainShellBinding
import com.cliqheart.app.feature.home.RemoteImageLoader
import com.cliqheart.app.feature.home.tabs.ActivityFragment
import com.cliqheart.app.feature.home.tabs.CreatePostFragment
import com.cliqheart.app.feature.home.tabs.DiscoverFragment
import com.cliqheart.app.feature.home.tabs.HomeFeedFragment
import com.cliqheart.app.feature.home.tabs.MessagesFragment
import com.cliqheart.app.feature.home.tabs.ProfileFragment
import kotlinx.coroutines.launch

private data class NavigationDestination(
    val id: Int,
    val label: Int,
    val icon: Int,
)

class MainShellFragment : Fragment() {
    private var _binding: FragmentMainShellBinding? = null
    private val binding get() = requireNotNull(_binding)
    private val homeDataViewModel: MainShellViewModel by activityViewModels()
    private val navigationItems = linkedMapOf<Int, ItemBottomNavigationBinding>()
    private var selectedTabId = R.id.homeTab
    private var profileAvatarUrl: String? = null
    private var profileAvatarLoadingUrl: String? = null
    private var profileAvatarLoadedUrl: String? = null
    private var profileAvatarAttempts = 0
    private var profileAvatarLastAttemptAt = 0L
    private val backStackListener = androidx.fragment.app.FragmentManager.OnBackStackChangedListener {
        if (childFragmentManager.backStackEntryCount == 0) {
            (childFragmentManager.findFragmentByTag(HOME_FRAGMENT_TAG) as? HomeFeedFragment)
                ?.takeIf { it.isVisible }
                ?.onTabSelected()
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentMainShellBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        configureNavigation()
        selectedTabId = savedInstanceState
            ?.getInt(SELECTED_TAB_KEY, R.id.homeTab)
            ?.takeIf(::isNavigationTab)
            ?: R.id.homeTab
        updateNavigationSelection(selectedTabId, animate = false)
        val user = homeDataViewModel.currentUser.value
        val userId = user?.id?.takeIf(String::isNotBlank) ?: user?._id ?: user?.username ?: "default"
        val cachedBitmap = ProfileAvatarCache.loadAvatarBitmap(requireContext(), userId)
        if (cachedBitmap != null) {
            showProfileAvatar(cachedBitmap)
        }

        childFragmentManager.addOnBackStackChangedListener(backStackListener)
        ViewCompat.setOnApplyWindowInsetsListener(binding.bottomNavigation) { bottomNav, insets ->
            val navBarInsets = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
            bottomNav.setPadding(0, 0, 0, navBarInsets.bottom)
            insets
        }

        observeCurrentUser()
        observeUnreadCounts()
        homeDataViewModel.initialize()
        showTab(selectedTabId)
    }

    override fun onResume() {
        super.onResume()
        homeDataViewModel.refreshProfileIfMissing()
        homeDataViewModel.refreshStoriesIfStale()
        retryProfileAvatarIfNeeded()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt(
            SELECTED_TAB_KEY,
            selectedTabId,
        )
        super.onSaveInstanceState(outState)
    }

    private fun showTab(tabId: Int, renderSynchronously: Boolean = false): Boolean {
        val (tag, newFragment) = when (tabId) {
            R.id.homeTab -> HOME_FRAGMENT_TAG to { HomeFeedFragment() }
            R.id.reelsTab -> REELS_FRAGMENT_TAG to { HomeFeedFragment.newReelsInstance() }
            R.id.messagesTab -> "messages" to { MessagesFragment() }
            R.id.searchTab -> "search" to { DiscoverFragment() }
            R.id.profileTab -> "profile" to { ProfileFragment() }
            else -> return false
        }
        val manager = childFragmentManager
        if (manager.isStateSaved) return false
        if (renderSynchronously) {
            manager.executePendingTransactions()
        }
        val fragment = manager.findFragmentByTag(tag) ?: newFragment()
        if (fragment.isVisible && fragment.view?.isShown == true) {
            (fragment as? HomeFeedFragment)?.onTabSelected()
            return true
        }
        val transaction = manager.beginTransaction().apply {
            setReorderingAllowed(true)
            if (tag != HOME_FRAGMENT_TAG) {
                val home = manager.findFragmentByTag(HOME_FRAGMENT_TAG)
                    ?: HomeFeedFragment()
                if (!home.isAdded) {
                    add(R.id.tab_container, home, HOME_FRAGMENT_TAG)
                    hide(home)
                    setMaxLifecycle(home, Lifecycle.State.RESUMED)
                }
            }
            manager.fragments.filter { it.isAdded }.forEach {
                hide(it)
                if (it is HomeFeedFragment) {
                    it.pauseFeedPlayback()
                    setMaxLifecycle(it, Lifecycle.State.RESUMED)
                } else {
                    setMaxLifecycle(it, Lifecycle.State.STARTED)
                }
            }
            if (fragment.isAdded) {
                show(fragment)
            } else {
                add(R.id.tab_container, fragment, tag)
            }
            setMaxLifecycle(fragment, Lifecycle.State.RESUMED)
        }
        if (renderSynchronously) {
            transaction.commitNow()
            check(fragment.view != null) {
                "Tab fragment $tag was added without creating its view."
            }
        } else {
            transaction.commit()
        }
        val home = manager.findFragmentByTag(HOME_FRAGMENT_TAG) as? HomeFeedFragment
        if (fragment is HomeFeedFragment && fragment.view != null) {
            fragment.onTabSelected()
        } else {
            home?.refreshUnreadCounts()
        }
        return true
    }

    private fun selectTab(tabId: Int) {
        if (!isNavigationTab(tabId) || !showTab(tabId, renderSynchronously = true)) return
        selectedTabId = tabId
        updateNavigationSelection(tabId, animate = true)
    }

    private fun isNavigationTab(tabId: Int): Boolean = tabId in NAVIGATION_TAB_IDS

    private fun updateNavigationSelection(tabId: Int, animate: Boolean) {
        navigationItems.forEach { (itemId, item) ->
            val isSelected = itemId == tabId
            item.root.isSelected = isSelected
            item.navigationIcon.isSelected = isSelected
            item.navigationLabel.isSelected = isSelected
            item.navigationLabel.setTextColor(
                ContextCompat.getColorStateList(requireContext(), R.color.nav_item_text_tint),
            )
            item.navigationLabel.setTypeface(
                null,
                if (isSelected) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL,
            )
            item.navigationAvatarFrame.background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(ContextCompat.getColor(requireContext(), R.color.nav_background))
                setStroke(
                    (NAV_AVATAR_BORDER_DP * resources.displayMetrics.density).toInt().coerceAtLeast(1),
                    ContextCompat.getColor(
                        requireContext(),
                        if (isSelected) R.color.nav_icon_selected else R.color.heart_outline,
                    ),
                )
            }
            if (animate && isSelected) {
                item.navigationIconContainer.animate().cancel()
                item.navigationIconContainer.scaleX = NAV_SELECTION_SCALE_FROM
                item.navigationIconContainer.scaleY = NAV_SELECTION_SCALE_FROM
                item.navigationIconContainer.animate()
                    .scaleX(1f)
                    .scaleY(1f)
                    .setDuration(NAV_SELECTION_ANIMATION_MS)
                    .start()
            } else {
                item.navigationIconContainer.animate().cancel()
                item.navigationIconContainer.scaleX = 1f
                item.navigationIconContainer.scaleY = 1f
            }
        }
    }

    fun updateMessagesUnreadCount(count: Int) {
        homeDataViewModel.updateMessagesUnreadCount(count)
        renderMessagesUnreadCount(count)
    }

    fun updateProfileAvatar(imageUrl: String?) {
        val currentUser = homeDataViewModel.currentUser.value ?: return
        homeDataViewModel.updateCurrentUser(currentUser.copy(avatarUrl = imageUrl))
    }

    fun updateCurrentUser(user: UserResponse) {
        homeDataViewModel.updateCurrentUser(user)
    }

    fun retryProfileAvatarIfNeeded() {
        val failedUrl = profileAvatarUrl ?: return
        if (profileAvatarFailedUrl != failedUrl ||
            profileAvatarAttempts >= MAX_AVATAR_ATTEMPTS ||
            System.currentTimeMillis() - profileAvatarLastAttemptAt < AVATAR_RETRY_INTERVAL_MS
        ) return
        updateProfileAvatarIcon(failedUrl)
    }

    private fun observeCurrentUser() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                homeDataViewModel.currentUser.collect { user ->
                    updateProfileAvatarIcon(user.getEffectiveAvatarUrl())
                }
            }
        }
    }

    private fun updateProfileAvatarIcon(imageUrl: String?) {
        val normalizedUrl = imageUrl?.trim()?.takeIf(String::isNotEmpty)
        if (_binding == null) return
        if (normalizedUrl == profileAvatarUrl &&
            (normalizedUrl == null || normalizedUrl == profileAvatarLoadedUrl ||
                normalizedUrl == profileAvatarLoadingUrl)
        ) return
        if (normalizedUrl != profileAvatarUrl) {
            profileAvatarAttempts = 0
            profileAvatarLastAttemptAt = 0L
        }
        profileAvatarUrl = normalizedUrl
        profileAvatarFailedUrl = null
        profileAvatarLoadingUrl = null
        profileAvatarLoadedUrl = null
        if (normalizedUrl == null) {
            showDefaultProfileIcon()
            return
        }

        val currentUser = homeDataViewModel.currentUser.value
        val userId = currentUser?.id?.takeIf(String::isNotBlank) ?: currentUser?._id ?: currentUser?.username ?: "default"
        val cachedBitmap = ProfileAvatarCache.loadAvatarBitmap(requireContext(), userId)
        if (cachedBitmap != null) {
            showProfileAvatar(cachedBitmap)
        } else {
            showProfileAvatarPlaceholder()
        }

        profileAvatarAttempts += 1
        profileAvatarLastAttemptAt = System.currentTimeMillis()
        profileAvatarLoadingUrl = normalizedUrl
        val imageView = navigationItems[R.id.profileTab]?.navigationAvatar ?: return
        RemoteImageLoader.load(imageView, normalizedUrl, 0) { bitmap ->
            if (_binding == null ||
                navigationItems[R.id.profileTab]?.navigationAvatar !== imageView ||
                profileAvatarUrl != normalizedUrl
            ) return@load
            profileAvatarLoadingUrl = null
            if (bitmap == null) {
                profileAvatarFailedUrl = normalizedUrl
                return@load
            }
            profileAvatarLoadedUrl = normalizedUrl
            ProfileAvatarCache.saveAvatarBitmap(requireContext(), userId, bitmap)
            showProfileAvatar(bitmap)
        }
    }

    fun openDiscover() {
        selectTab(R.id.searchTab)
    }

    fun openActivity() {
        showOverlay(ACTIVITY_FRAGMENT_TAG) { ActivityFragment() }
        (childFragmentManager.findFragmentByTag(HOME_FRAGMENT_TAG) as? HomeFeedFragment)
            ?.refreshUnreadCounts()
    }

    fun openMessages() {
        selectTab(R.id.messagesTab)
    }

    fun openCreate() {
        showOverlay(CREATE_FRAGMENT_TAG) { CreatePostFragment() }
    }

    private fun showOverlay(tag: String, createFragment: () -> Fragment) {
        if (_binding == null) return
        val manager = childFragmentManager
        if (manager.isStateSaved || manager.findFragmentByTag(tag)?.isVisible == true) return

        val overlay = manager.findFragmentByTag(tag) ?: createFragment()
        manager.beginTransaction()
            .setReorderingAllowed(true)
            .apply {
                manager.fragments
                    .filter { it.isAdded && it.id == R.id.tab_container }
                    .forEach {
                        hide(it)
                        if (it is HomeFeedFragment) {
                            it.pauseFeedPlayback()
                            setMaxLifecycle(it, Lifecycle.State.RESUMED)
                        } else {
                            setMaxLifecycle(it, Lifecycle.State.STARTED)
                        }
                    }
                if (overlay.isAdded) {
                    show(overlay)
                } else {
                    add(R.id.tab_container, overlay, tag)
                }
                setMaxLifecycle(overlay, Lifecycle.State.RESUMED)
            }
            .addToBackStack(tag)
            .commit()
    }

    override fun onDestroyView() {
        childFragmentManager.removeOnBackStackChangedListener(backStackListener)
        profileAvatarUrl = null
        profileAvatarFailedUrl = null
        profileAvatarLoadingUrl = null
        profileAvatarLoadedUrl = null
        profileAvatarAttempts = 0
        profileAvatarLastAttemptAt = 0L
        navigationItems.clear()
        _binding = null
        super.onDestroyView()
    }

    private fun configureNavigation() {
        val destinations = listOf(
            NavigationDestination(R.id.homeTab, R.string.home, R.drawable.ic_home),
            NavigationDestination(R.id.reelsTab, R.string.reels, R.drawable.ic_nav_reels),
            NavigationDestination(R.id.messagesTab, R.string.messages, R.drawable.ic_messages),
            NavigationDestination(R.id.searchTab, R.string.search, R.drawable.ic_discover),
            NavigationDestination(R.id.profileTab, R.string.profile, R.drawable.ic_profile),
        )
        val container = binding.navigationItems
        container.removeAllViews()
        navigationItems.clear()
        destinations.forEach { destination ->
            val item = ItemBottomNavigationBinding.inflate(
                layoutInflater,
                container,
                false,
            )
            item.root.id = destination.id
            item.root.contentDescription = getString(destination.label)
            item.navigationLabel.text = getString(destination.label)
            item.navigationLabel.setTextColor(
                ContextCompat.getColorStateList(requireContext(), R.color.nav_item_text_tint),
            )
            item.navigationIcon.setImageResource(destination.icon)
            item.navigationIcon.imageTintList =
                ContextCompat.getColorStateList(requireContext(), R.color.nav_item_icon_tint)
            item.navigationIcon.visibility = View.VISIBLE
            item.navigationAvatarFrame.visibility = View.GONE
            navigationItems[destination.id] = item
            container.addView(item.root)
            item.root.setOnClickListener { selectTab(destination.id) }
        }
    }

    private fun showDefaultProfileIcon() {
        val item = navigationItems[R.id.profileTab] ?: return
        item.navigationAvatarFrame.visibility = View.GONE
        item.navigationIcon.visibility = View.VISIBLE
    }

    private fun showProfileAvatarPlaceholder() {
        val item = navigationItems[R.id.profileTab] ?: return
        item.navigationIcon.visibility = View.GONE
        item.navigationAvatarFrame.visibility = View.VISIBLE
        item.navigationAvatar.setImageDrawable(null)
    }

    private fun showProfileAvatar(bitmap: android.graphics.Bitmap) {
        val item = navigationItems[R.id.profileTab] ?: return
        item.navigationIcon.visibility = View.GONE
        item.navigationAvatarFrame.visibility = View.VISIBLE
        item.navigationAvatar.setImageBitmap(bitmap)
    }

    private fun observeUnreadCounts() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                homeDataViewModel.messagesUnreadCount.collect(::renderMessagesUnreadCount)
            }
        }
    }

    private fun renderMessagesUnreadCount(count: Int?) {
        val item = navigationItems[R.id.messagesTab] ?: return
        val unreadCount = count?.coerceAtLeast(0) ?: 0
        item.navigationBadge.apply {
            text = when {
                unreadCount > MAX_BADGE_COUNT -> "$MAX_BADGE_COUNT+"
                unreadCount > 0 -> unreadCount.toString()
                else -> ""
            }
            visibility = if (unreadCount > 0) View.VISIBLE else View.GONE
        }
        item.root.contentDescription = if (unreadCount > 0) {
            getString(
                R.string.unread_action_label,
                getString(R.string.messages),
                unreadCount,
            )
        } else {
            getString(R.string.messages)
        }
    }

    private companion object {
        val NAVIGATION_TAB_IDS = setOf(
            R.id.homeTab,
            R.id.reelsTab,
            R.id.messagesTab,
            R.id.searchTab,
            R.id.profileTab,
        )
        const val HOME_FRAGMENT_TAG = "home"
        const val REELS_FRAGMENT_TAG = "reels"
        const val ACTIVITY_FRAGMENT_TAG = "activity_overlay"
        const val CREATE_FRAGMENT_TAG = "create_overlay"
        const val SELECTED_TAB_KEY = "selected_tab_id"
        const val NAV_AVATAR_BORDER_DP = 1.5f
        const val NAV_SELECTION_SCALE_FROM = 0.9f
        const val NAV_SELECTION_ANIMATION_MS = 140L
        const val MAX_BADGE_COUNT = 99
        const val MAX_AVATAR_ATTEMPTS = 3
        const val AVATAR_RETRY_INTERVAL_MS = 30_000L
    }

    private var profileAvatarFailedUrl: String? = null
}
