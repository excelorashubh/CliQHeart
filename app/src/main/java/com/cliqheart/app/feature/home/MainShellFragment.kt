package com.cliqheart.app.feature.home

import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.StateListDrawable
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.DrawableCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.Lifecycle
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.cliqheart.app.R
import com.cliqheart.app.core.network.UserResponse
import com.cliqheart.app.databinding.FragmentMainShellBinding
import com.cliqheart.app.feature.home.RemoteImageLoader
import com.cliqheart.app.feature.home.tabs.ActivityFragment
import com.cliqheart.app.feature.home.tabs.CreatePostFragment
import com.cliqheart.app.feature.home.tabs.DiscoverFragment
import com.cliqheart.app.feature.home.tabs.HomeFeedFragment
import com.cliqheart.app.feature.home.tabs.MessagesFragment
import com.cliqheart.app.feature.home.tabs.ProfileFragment
import kotlinx.coroutines.launch

class MainShellFragment : Fragment() {
    private var _binding: FragmentMainShellBinding? = null
    private val binding get() = requireNotNull(_binding)
    private val homeDataViewModel: MainShellViewModel by activityViewModels()
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
        configureNavigationIcons()
        childFragmentManager.addOnBackStackChangedListener(backStackListener)
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

        val selectedTab = savedInstanceState?.getInt(SELECTED_TAB_KEY, R.id.homeTab) ?: R.id.homeTab
        binding.bottomNavigation.selectedItemId = selectedTab
        binding.bottomNavigation.setOnItemSelectedListener { item ->
            showTab(item.itemId)
        }
        observeCurrentUser()
        homeDataViewModel.initialize()
        showTab(selectedTab)
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
            _binding?.bottomNavigation?.selectedItemId ?: R.id.homeTab,
        )
        super.onSaveInstanceState(outState)
    }

    private fun showTab(tabId: Int): Boolean {
        val (tag, newFragment) = when (tabId) {
            R.id.homeTab -> HOME_FRAGMENT_TAG to { HomeFeedFragment() }
            R.id.reelsTab -> REELS_FRAGMENT_TAG to { HomeFeedFragment.newReelsInstance() }
            R.id.messagesTab -> "messages" to { MessagesFragment() }
            R.id.searchTab -> "search" to { DiscoverFragment() }
            R.id.profileTab -> "profile" to { ProfileFragment() }
            else -> return false
        }
        val manager = childFragmentManager
        val fragment = manager.findFragmentByTag(tag) ?: newFragment()
        if (fragment.isVisible) {
            (fragment as? HomeFeedFragment)?.onTabSelected()
            return true
        }
        manager.beginTransaction().apply {
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
        }.commit()
        val home = manager.findFragmentByTag(HOME_FRAGMENT_TAG) as? HomeFeedFragment
        if (fragment is HomeFeedFragment && fragment.view != null) {
            fragment.onTabSelected()
        } else {
            home?.refreshUnreadCounts()
        }
        return true
    }

    fun updateMessagesUnreadCount(count: Int) {
        val navigation = _binding?.bottomNavigation ?: return
        val item = navigation.menu.findItem(R.id.messagesTab)
        val badge = navigation.getOrCreateBadge(R.id.messagesTab)
        val unreadCount = count.coerceAtLeast(0)
        badge.backgroundColor = ContextCompat.getColor(requireContext(), R.color.badge_background)
        badge.badgeTextColor = ContextCompat.getColor(requireContext(), R.color.white)
        badge.maxCharacterCount = 3
        badge.number = unreadCount
        badge.isVisible = unreadCount > 0
        item.contentDescription = if (unreadCount > 0) {
            getString(
                R.string.unread_action_label,
                getString(R.string.messages),
                unreadCount,
            )
        } else {
            getString(R.string.messages)
        }
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
                    updateProfileAvatarIcon(user?.avatarUrl)
                }
            }
        }
    }

    private fun updateProfileAvatarIcon(imageUrl: String?) {
        val normalizedUrl = imageUrl?.trim()?.takeIf(String::isNotEmpty)
        if (_binding == null) return
        if (normalizedUrl == profileAvatarUrl &&
            (normalizedUrl == null || normalizedUrl == profileAvatarLoadedUrl ||
                normalizedUrl == profileAvatarLoadingUrl ||
                profileAvatarAttempts >= MAX_AVATAR_ATTEMPTS)
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
            setProfileIcon(ContextCompat.getDrawable(requireContext(), R.drawable.ic_profile))
            return
        }

        setProfileIcon(ContextCompat.getDrawable(requireContext(), R.drawable.ic_profile))
        profileAvatarAttempts += 1
        profileAvatarLastAttemptAt = System.currentTimeMillis()
        profileAvatarLoadingUrl = normalizedUrl
        val imageView = android.widget.ImageView(requireContext())
        RemoteImageLoader.load(imageView, normalizedUrl, R.drawable.ic_profile) { bitmap ->
            if (_binding == null || profileAvatarUrl != normalizedUrl) return@load
            profileAvatarLoadingUrl = null
            if (bitmap == null) {
                profileAvatarFailedUrl = normalizedUrl
                return@load
            }
            profileAvatarLoadedUrl = normalizedUrl
            setProfileIcon(createProfileAvatarDrawable(bitmap))
        }
    }

    fun openDiscover() {
        if (_binding != null) binding.bottomNavigation.selectedItemId = R.id.searchTab
    }

    fun openActivity() {
        showOverlay(ACTIVITY_FRAGMENT_TAG) { ActivityFragment() }
        (childFragmentManager.findFragmentByTag(HOME_FRAGMENT_TAG) as? HomeFeedFragment)
            ?.refreshUnreadCounts()
    }

    fun openMessages() {
        if (_binding != null) binding.bottomNavigation.selectedItemId = R.id.messagesTab
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
        _binding = null
        super.onDestroyView()
    }

    private fun configureNavigationIcons() {
        val navigation = binding.bottomNavigation
        navigation.itemIconTintList = null
        val tint = ContextCompat.getColorStateList(requireContext(), R.color.nav_item_icon_tint)
        navigation.menu.let { menu ->
            for (index in 0 until menu.size()) {
                val item = menu.getItem(index)
                if (item.itemId != R.id.profileTab && item.itemId != R.id.reelsTab) {
                    item.icon?.let { DrawableCompat.setTintList(it, tint) }
                }
            }
        }
        setProfileIcon(ContextCompat.getDrawable(requireContext(), R.drawable.ic_profile))
    }

    private fun setProfileIcon(drawable: Drawable?) {
        val item = _binding?.bottomNavigation?.menu?.findItem(R.id.profileTab) ?: return
        item.icon = drawable
        if (drawable is StateListDrawable) return
        drawable?.let {
            DrawableCompat.setTintList(
                it,
                ContextCompat.getColorStateList(requireContext(), R.color.nav_item_icon_tint),
            )
        }
    }

    private fun createProfileAvatarDrawable(source: Bitmap): StateListDrawable {
        val density = resources.displayMetrics.density
        val size = (PROFILE_ICON_SIZE_DP * density).toInt().coerceAtLeast(1)
        val strokeWidth = PROFILE_BORDER_DP * density
        val selected = drawProfileAvatar(source, size, strokeWidth, R.color.heart_primary)
        val unselected = drawProfileAvatar(source, size, strokeWidth, R.color.heart_outline)
        selected.density = resources.displayMetrics.densityDpi
        unselected.density = resources.displayMetrics.densityDpi
        return StateListDrawable().apply {
            addState(
                intArrayOf(android.R.attr.state_checked),
                BitmapDrawable(resources, selected),
            )
            addState(
                intArrayOf(),
                BitmapDrawable(resources, unselected),
            )
            setEnterFadeDuration(120)
            setExitFadeDuration(120)
        }
    }

    private fun drawProfileAvatar(
        source: Bitmap,
        size: Int,
        strokeWidth: Float,
        @androidx.annotation.ColorRes borderColorRes: Int,
    ): Bitmap {
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val radius = size / 2f
        val imageRadius = radius - strokeWidth
        val imagePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).also { shader ->
                val scale = maxOf(
                    imageRadius * 2f / source.width,
                    imageRadius * 2f / source.height,
                )
                val matrix = Matrix().apply {
                    setScale(scale, scale)
                    postTranslate(
                        radius - source.width * scale / 2f,
                        radius - source.height * scale / 2f,
                    )
                }
                shader.setLocalMatrix(matrix)
            }
        }
        canvas.drawCircle(radius, radius, imageRadius, imagePaint)
        val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ContextCompat.getColor(requireContext(), borderColorRes)
            style = Paint.Style.STROKE
            this.strokeWidth = strokeWidth
        }
        canvas.drawCircle(radius, radius, radius - strokeWidth / 2f, borderPaint)
        return bitmap
    }

    private companion object {
        const val HOME_FRAGMENT_TAG = "home"
        const val REELS_FRAGMENT_TAG = "reels"
        const val ACTIVITY_FRAGMENT_TAG = "activity_overlay"
        const val CREATE_FRAGMENT_TAG = "create_overlay"
        const val SELECTED_TAB_KEY = "selected_tab_id"
        const val PROFILE_ICON_SIZE_DP = 24
        const val PROFILE_BORDER_DP = 1.5f
        const val MAX_AVATAR_ATTEMPTS = 3
        const val AVATAR_RETRY_INTERVAL_MS = 30_000L
    }

    private var profileAvatarFailedUrl: String? = null
}
