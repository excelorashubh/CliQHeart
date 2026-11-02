package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import androidx.navigation.NavOptions
import androidx.recyclerview.widget.GridLayoutManager
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.LogoutRequest
import com.cliqheart.app.core.network.UserResponse
import com.cliqheart.app.core.security.SecureTokenStore
import com.cliqheart.app.core.ui.limitContentWidth
import com.cliqheart.app.databinding.FragmentProfileBinding
import com.cliqheart.app.feature.home.MainShellViewModel
import com.cliqheart.app.feature.home.MainShellFragment
import com.cliqheart.app.feature.home.RemoteImageLoader
import com.cliqheart.app.feature.home.adapters.GridPostsAdapter
import com.cliqheart.app.feature.home.getEffectiveAvatarUrl
import com.cliqheart.app.feature.home.getFallbackAvatarUrl
import com.cliqheart.app.feature.home.apiErrorMessage
import com.cliqheart.app.core.network.PostResponse
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import java.io.IOException

class ProfileFragment : Fragment() {
    private var _binding: FragmentProfileBinding? = null
    private val binding get() = requireNotNull(_binding)
    private val homeDataViewModel: MainShellViewModel by activityViewModels()
    private var profileJob: Job? = null
    private lateinit var profilePostsAdapter: GridPostsAdapter
    private var currentProfile: UserResponse? = null
    private var profileLoaded = false
    private var isLoggingOut = false
    private var profileContentOwnerId: String? = null
    private var selectedSection = ProfileSection.POSTS
    private val sectionItems = mutableMapOf<ProfileSection, MutableList<PostResponse>>()
    private val sectionCursors = mutableMapOf<ProfileSection, String>()
    private val loadedSections = mutableSetOf<ProfileSection>()
    private val exhaustedSections = mutableSetOf<ProfileSection>()
    private val loadingSections = mutableSetOf<ProfileSection>()
    private val failedSections = mutableSetOf<ProfileSection>()
    private val viewedUserId: String? get() = arguments?.getString(ARG_PROFILE_USER_ID)
    private val isOwnProfile: Boolean get() = viewedUserId == null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentProfileBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        view.limitContentWidth(720)
        profilePostsAdapter = GridPostsAdapter(::openProfileContent)
        binding.profileGridRecycler.layoutManager = GridLayoutManager(requireContext(), 3)
        binding.profileGridRecycler.adapter = profilePostsAdapter
        binding.profilePostsState.setOnClickListener { loadSection(selectedSection) }
        binding.profileScrollView.setOnScrollChangeListener { _, _, scrollY, _, _ ->
            val content = binding.profileScrollView.getChildAt(0)
            if (content != null &&
                scrollY + binding.profileScrollView.height >= content.height - resources.getDimensionPixelSize(R.dimen.profile_pagination_threshold)
            ) {
                loadSection(selectedSection)
            }
        }
        binding.profileTabPosts.setOnClickListener { selectSection(ProfileSection.POSTS) }
        binding.profileTabReels.setOnClickListener { selectSection(ProfileSection.REELS) }
        binding.profileTabSaved.setOnClickListener { selectSection(ProfileSection.SAVED) }
        binding.profileTabTagged.setOnClickListener { selectSection(ProfileSection.TAGGED) }
        binding.btnAddStory.setOnClickListener {
            StoryCreationDialogFragment().show(parentFragmentManager, PROFILE_STORY_CREATION_TAG)
        }
        binding.btnProfessionalDashboard.setOnClickListener { openProfessionalDashboard() }
        binding.profileMenuButton.setOnClickListener { openProfileMenu() }
        childFragmentManager.setFragmentResultListener(
            ProfileMoreMenuBottomSheetFragment.REQUEST_KEY,
            viewLifecycleOwner,
        ) { _, result ->
            handleProfileMenuAction(result.getString(ProfileMoreMenuBottomSheetFragment.KEY_ACTION))
        }
        parentFragmentManager.setFragmentResultListener(
            STORY_PUBLISHED_REQUEST_KEY,
            viewLifecycleOwner,
        ) { _, _ -> homeDataViewModel.refreshStories() }

        if (isOwnProfile) {
            homeDataViewModel.currentUser.value?.let {
                profileLoaded = true
                showProfile(it)
            }
            viewLifecycleOwner.lifecycleScope.launch {
                viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                    launch {
                        homeDataViewModel.currentUser.collect { user ->
                            if (user != null) {
                                profileLoaded = true
                                binding.profileState.visibility = View.GONE
                                if (currentProfile != user) showProfile(user)
                            }
                        }
                    }
                    launch {
                        homeDataViewModel.profileError.collect { error ->
                            if (homeDataViewModel.currentUser.value == null && error != null) {
                                binding.profileState.text = error
                                binding.profileState.visibility = View.VISIBLE
                            }
                        }
                    }
                }
            }
        }
        binding.statPostsCount.text = "—"
        binding.statFollowersCount.text = "—"
        binding.statFollowingCount.text = "—"
        binding.btnEditProfile.text = if (isOwnProfile) {
            getString(R.string.edit_profile)
        } else {
            getString(R.string.follow)
        }
        binding.btnShareProfile.text = if (isOwnProfile) {
            getString(R.string.share_profile)
        } else {
            getString(R.string.message)
        }
        binding.profileBackButton.visibility = if (isOwnProfile) View.GONE else View.VISIBLE
        binding.profileBackButton.setOnClickListener { findNavController().popBackStack() }
        binding.profileMenuButton.visibility = if (isOwnProfile) View.VISIBLE else View.GONE
        binding.btnEditProfile.setOnClickListener {
            if (isOwnProfile) {
                findNavController().navigate(R.id.editProfileFragment)
            } else {
                toggleFollow()
            }
        }
        binding.btnShareProfile.setOnClickListener {
            if (isOwnProfile) shareProfile() else openMessage()
        }
        binding.followersStat.setOnClickListener { openUserList(FOLLOWERS) }
        binding.followingStat.setOnClickListener { openUserList(FOLLOWING) }
        binding.profilePostsState.text = getString(R.string.posts_unavailable)
        binding.profileState.setOnClickListener { loadProfile() }
        binding.profileSavedSection.visibility = if (isOwnProfile) View.VISIBLE else View.GONE
        binding.btnAddStory.visibility = if (isOwnProfile) View.VISIBLE else View.GONE
        selectSection(ProfileSection.POSTS)
    }

    override fun onResume() {
        super.onResume()
        if (_binding != null && !profileLoaded) {
            if (isOwnProfile) homeDataViewModel.refreshProfileIfMissing() else loadProfile()
        }
    }

    private fun loadProfile(force: Boolean = false) {
        if (profileJob?.isActive == true || (profileLoaded && !force)) return
        if (isOwnProfile) {
            homeDataViewModel.refreshProfileIfMissing()
            return
        }
        profileJob = viewLifecycleOwner.lifecycleScope.launch {
            try {
                val userId = viewedUserId
                val response = if (userId == null) {
                    ApiClient.service.getMyProfile()
                } else {
                    ApiClient.service.getProfile(userId)
                }
                val user = response.body()?.user
                if (response.isSuccessful && user != null) {
                    if (isOwnProfile) homeDataViewModel.updateCurrentUser(user)
                    binding.profileState.visibility = View.GONE
                    profileLoaded = true
                    showProfile(user)
                } else {
                    binding.profileState.text = getString(R.string.profile_load_failed)
                    binding.profileState.visibility = View.VISIBLE
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                binding.profileState.text = getString(R.string.profile_load_failed)
                binding.profileState.visibility = View.VISIBLE
            }
        }
    }

    private fun showProfile(user: UserResponse) {
        currentProfile = user
        if (isOwnProfile) {
            homeDataViewModel.updateCurrentUser(user)
        }
        binding.profileUsernameTitle.text = user.username?.let { "@$it" }.orEmpty()
        binding.profileDisplayName.text = user.displayName.orEmpty()
        binding.profileBio.text = user.bio.orEmpty()
        binding.statPostsCount.text = user.postsCount?.toString() ?: "—"
        RemoteImageLoader.load(
            binding.profileAvatar,
            user.getEffectiveAvatarUrl(),
            R.drawable.ic_profile,
            user.getFallbackAvatarUrl(),
        )
        binding.statFollowersCount.text = user.followersCount?.toString() ?: "—"
        binding.statFollowingCount.text = user.followingCount?.toString() ?: "—"
        binding.btnEditProfile.text = if (isOwnProfile) {
            getString(R.string.edit_profile)
        } else if (user.isFollowing == true) {
            getString(R.string.following)
        } else {
            getString(R.string.follow)
        }
        val accountType = user.accountType.orEmpty().uppercase()
        val hasProfessionalDashboard = isOwnProfile && accountType in setOf("CREATOR", "BUSINESS")
        binding.profileOwnerActions.visibility = if (hasProfessionalDashboard) View.VISIBLE else View.GONE
        binding.btnProfessionalDashboard.visibility = if (hasProfessionalDashboard) View.VISIBLE else View.GONE
        (user.id ?: user._id ?: viewedUserId)?.let { userId ->
            if (profileContentOwnerId != userId) {
                resetProfileSections(userId)
                loadSection(ProfileSection.POSTS)
            }
        }
    }

    private fun resetProfileSections(userId: String) {
        profileContentOwnerId = userId
        sectionItems.clear()
        sectionCursors.clear()
        loadedSections.clear()
        exhaustedSections.clear()
        loadingSections.clear()
        failedSections.clear()
        profilePostsAdapter.submitPosts(emptyList())
        renderSectionState()
    }

    private fun selectSection(section: ProfileSection) {
        selectedSection = section
        setSectionTab(binding.profileTabPosts, binding.profileTabPostsIndicator, section == ProfileSection.POSTS)
        setSectionTab(binding.profileTabReels, binding.profileTabReelsIndicator, section == ProfileSection.REELS)
        setSectionTab(binding.profileTabSaved, binding.profileTabSavedIndicator, section == ProfileSection.SAVED)
        setSectionTab(binding.profileTabTagged, binding.profileTabTaggedIndicator, section == ProfileSection.TAGGED)
        profilePostsAdapter.submitPosts(sectionItems[section].orEmpty())
        renderSectionState()
        loadSection(section)
    }

    private fun setSectionTab(label: View, indicator: View, selected: Boolean) {
        (label as? android.widget.TextView)?.setTextColor(
            requireContext().getColor(if (selected) R.color.heart_primary else R.color.heart_muted),
        )
        indicator.visibility = if (selected) View.VISIBLE else View.GONE
    }

    private fun loadSection(section: ProfileSection) {
        val userId = profileContentOwnerId ?: return
        if (section in loadingSections || section in exhaustedSections) return
        if (section !in loadedSections && section == ProfileSection.SAVED && !isOwnProfile) return
        loadingSections += section
        failedSections -= section
        renderSectionState()
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val cursor = sectionCursors[section]
                val page = when (section) {
                    ProfileSection.POSTS -> {
                        val response = ApiClient.service.getUserPosts(userId, after = cursor)
                        if (!response.isSuccessful) {
                            throw IOException(apiErrorMessage(response, getString(R.string.profile_posts_load_failed)))
                        }
                        val body = response.body() ?: throw IOException(getString(R.string.profile_posts_load_failed))
                        ProfileSectionPage(body.posts, body.nextCursor)
                    }
                    ProfileSection.REELS -> {
                        val response = ApiClient.service.getUserReels(userId, after = cursor)
                        if (!response.isSuccessful) {
                            throw IOException(apiErrorMessage(response, getString(R.string.profile_posts_load_failed)))
                        }
                        val body = response.body() ?: throw IOException(getString(R.string.profile_posts_load_failed))
                        ProfileSectionPage(body.reels, body.nextCursor)
                    }
                    ProfileSection.SAVED -> {
                        val response = ApiClient.service.getSavedContent(after = cursor)
                        if (!response.isSuccessful) {
                            throw IOException(apiErrorMessage(response, getString(R.string.profile_posts_load_failed)))
                        }
                        val body = response.body() ?: throw IOException(getString(R.string.profile_posts_load_failed))
                        ProfileSectionPage(body.items, body.nextCursor)
                    }
                    ProfileSection.TAGGED -> {
                        val response = ApiClient.service.getTaggedContent(userId, after = cursor)
                        if (!response.isSuccessful) {
                            throw IOException(apiErrorMessage(response, getString(R.string.profile_posts_load_failed)))
                        }
                        val body = response.body() ?: throw IOException(getString(R.string.profile_posts_load_failed))
                        ProfileSectionPage(body.items, body.nextCursor)
                    }
                }
                val items = sectionItems.getOrPut(section) { mutableListOf() }
                val existingKeys = items.mapTo(mutableSetOf()) { it.feedKey ?: it.id }
                items += page.items.filter { item ->
                    val key = item.feedKey ?: item.id
                    key != null && existingKeys.add(key)
                }
                loadedSections += section
                if (page.nextCursor.isNullOrBlank()) {
                    exhaustedSections += section
                } else {
                    sectionCursors[section] = page.nextCursor
                }
                if (selectedSection == section) {
                    profilePostsAdapter.submitPosts(items)
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                failedSections += section
                if (selectedSection == section) {
                    binding.profilePostsState.text = exception.message
                        ?: getString(R.string.profile_section_load_failed, section.label)
                }
            } finally {
                loadingSections -= section
                if (_binding != null && selectedSection == section) {
                    renderSectionState()
                    binding.profileScrollView.post {
                        val content = binding.profileScrollView.getChildAt(0)
                        if (content != null &&
                            binding.profileScrollView.scrollY + binding.profileScrollView.height >=
                            content.height - resources.getDimensionPixelSize(R.dimen.profile_pagination_threshold)
                        ) {
                            loadSection(section)
                        }
                    }
                }
            }
        }
    }

    private fun renderSectionState() {
        val items = sectionItems[selectedSection].orEmpty()
        if (items.isNotEmpty()) {
            binding.profilePostsState.visibility = if (selectedSection in loadingSections ||
                selectedSection in failedSections
            ) View.VISIBLE else View.GONE
            if (selectedSection in loadingSections) {
                binding.profilePostsState.text =
                    getString(R.string.profile_section_loading, selectedSection.label)
            } else if (selectedSection in failedSections) {
                binding.profilePostsState.text =
                    getString(R.string.profile_section_load_failed, selectedSection.label)
            }
            return
        }
        binding.profilePostsState.visibility = View.VISIBLE
        binding.profilePostsState.text = when {
            selectedSection in loadingSections ->
                getString(R.string.profile_section_loading, selectedSection.label)
            selectedSection in failedSections ->
                getString(R.string.profile_section_load_failed, selectedSection.label)
            selectedSection in loadedSections -> getString(R.string.profile_section_empty)
            else -> getString(R.string.profile_section_loading, selectedSection.label)
        }
    }

    private fun openProfileContent(post: PostResponse) {
        val contentId = post.id ?: return
        val shell = parentFragment as? MainShellFragment
        when (post.contentType) {
            "reel" -> shell?.openReelInViewer(contentId)
            else -> shell?.openPostInFeed(contentId)
        }
    }

    private fun openProfessionalDashboard() {
        binding.btnProfessionalDashboard.isEnabled = false
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.getProfessionalDashboard()
                val analytics = response.body()?.analytics
                val totals = analytics?.totals
                if (!response.isSuccessful || analytics == null || totals == null) {
                    Toast.makeText(
                        requireContext(),
                        apiErrorMessage(response, getString(R.string.professional_dashboard_unavailable)),
                        Toast.LENGTH_LONG,
                    ).show()
                    return@launch
                }

                val message = getString(
                    R.string.professional_dashboard_summary,
                    analytics.rangeDays ?: 30,
                    totals.followers ?: 0,
                    totals.following ?: 0,
                    totals.posts ?: 0,
                    totals.reels ?: 0,
                )
                AlertDialog.Builder(requireContext())
                    .setTitle(R.string.professional_dashboard)
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok, null)
                    .show()
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                Toast.makeText(
                    requireContext(),
                    R.string.professional_dashboard_unavailable,
                    Toast.LENGTH_LONG,
                ).show()
            } finally {
                if (_binding != null) binding.btnProfessionalDashboard.isEnabled = true
            }
        }
    }

    private fun openProfileMenu() {
        if (!isOwnProfile || childFragmentManager.isStateSaved ||
            childFragmentManager.findFragmentByTag(PROFILE_MENU_TAG) != null
        ) return
        val accountType = currentProfile?.accountType.orEmpty().uppercase()
        ProfileMoreMenuBottomSheetFragment.newInstance(
            username = currentProfile?.username,
            showSaved = true,
            showProfessional = accountType == "CREATOR" || accountType == "BUSINESS",
        ).show(childFragmentManager, PROFILE_MENU_TAG)
    }

    private fun handleProfileMenuAction(action: String?) {
        if (!isOwnProfile) return
        when (action) {
            ProfileMoreMenuBottomSheetFragment.ACTION_EDIT_PROFILE -> {
                if (findNavController().currentDestination?.id != R.id.editProfileFragment) {
                    findNavController().navigate(R.id.editProfileFragment)
                }
            }
            ProfileMoreMenuBottomSheetFragment.ACTION_SAVED -> selectSection(ProfileSection.SAVED)
            ProfileMoreMenuBottomSheetFragment.ACTION_PROFESSIONAL -> openProfessionalDashboard()
            ProfileMoreMenuBottomSheetFragment.ACTION_NOTIFICATIONS -> {
                (parentFragment as? MainShellFragment)?.openActivity()
            }
            ProfileMoreMenuBottomSheetFragment.ACTION_LOGOUT -> showLogoutConfirmation()
        }
    }

    private fun showLogoutConfirmation() {
        if (isLoggingOut) return
        AlertDialog.Builder(requireContext())
            .setTitle(R.string.log_out)
            .setMessage(R.string.confirm_log_out)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.log_out) { _, _ -> logout() }
            .show()
    }

    private fun toggleFollow() {
        val userId = currentProfile?.id ?: currentProfile?._id ?: return
        val wasFollowing = currentProfile?.isFollowing == true
        binding.btnEditProfile.isEnabled = false
        binding.btnEditProfile.text = getString(R.string.loading_users)
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = if (wasFollowing) {
                    ApiClient.service.unfollowUser(userId)
                } else {
                    ApiClient.service.followUser(userId)
                }
                if (response.isSuccessful && response.body()?.following == !wasFollowing) {
                    loadProfile(force = true)
                } else {
                    binding.btnEditProfile.text = if (wasFollowing) getString(R.string.following) else getString(R.string.follow)
                    Toast.makeText(requireContext(), R.string.profile_action_failed, Toast.LENGTH_SHORT).show()
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                if (_binding != null) {
                    binding.btnEditProfile.text = if (wasFollowing) getString(R.string.following) else getString(R.string.follow)
                }
                Toast.makeText(requireContext(), R.string.profile_action_failed, Toast.LENGTH_SHORT).show()
            } finally {
                if (_binding != null) binding.btnEditProfile.isEnabled = true
            }
        }
    }

    private fun openUserList(relation: String) {
        val userId = currentProfile?.id ?: currentProfile?._id ?: return
        findNavController().navigate(
            R.id.profileUsersFragment,
            Bundle().apply {
                putString(ARG_PROFILE_USER_ID, userId)
                putString(ARG_RELATION, relation)
            },
        )
    }

    private fun openMessage() {
        val userId = currentProfile?.id ?: currentProfile?._id ?: return
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.createConversation(
                    com.cliqheart.app.core.network.ConversationCreateRequest(userId),
                )
                val conversationId = response.body()?.conversation?.id
                if (response.isSuccessful && !conversationId.isNullOrBlank()) {
                    findNavController().navigate(
                        R.id.chatFragment,
                        Bundle().apply { putString(ARG_CONVERSATION_ID, conversationId) },
                    )
                } else {
                    Toast.makeText(requireContext(), R.string.profile_action_failed, Toast.LENGTH_SHORT).show()
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                Toast.makeText(requireContext(), R.string.profile_action_failed, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun shareProfile() {
        val username = currentProfile?.username.orEmpty()
        val userId = currentProfile?.id ?: currentProfile?._id ?: username
        val apiBaseUrl = com.cliqheart.app.BuildConfig.API_BASE_URL
            .ifBlank { "https://cliqheart.onrender.com/api/v1/" }
        val siteBaseUrl = apiBaseUrl.substringBefore("/api/v1/").trimEnd('/')
        val profileUrl = "$siteBaseUrl/profile/$userId"
        val shareIntent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(
                android.content.Intent.EXTRA_TEXT,
                getString(R.string.profile_share_text, username, profileUrl),
            )
        }
        startActivity(android.content.Intent.createChooser(shareIntent, getString(R.string.share_profile)))
    }

    private fun logout() {
        if (isLoggingOut) return
        isLoggingOut = true
        val store = SecureTokenStore(requireContext())
        val refreshToken = store.readSession()?.refreshToken
        if (refreshToken.isNullOrBlank()) {
            store.clear()
            navigateToWelcome()
            return
        }

        store.savePendingRevocation(refreshToken)
        store.clearSessionPreservingPendingRevocation()
        viewLifecycleOwner.lifecycleScope.launch {
            val revoked = try {
                ApiClient.service.logout(LogoutRequest(refreshToken)).isSuccessful
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                false
            }
            if (revoked) {
                store.clear()
                Toast.makeText(requireContext(), R.string.signed_out, Toast.LENGTH_SHORT).show()
            } else {
                store.clearSessionPreservingPendingRevocation()
                Toast.makeText(requireContext(), R.string.signed_out_revocation_pending, Toast.LENGTH_LONG).show()
            }
            navigateToWelcome()
        }
    }

    private fun navigateToWelcome() {
        findNavController().navigate(
            R.id.welcomeFragment,
            null,
            NavOptions.Builder().setPopUpTo(R.id.mainShellFragment, true).build(),
        )
    }

    override fun onDestroyView() {
        profileJob?.cancel()
        loadingSections.clear()
        _binding = null
        super.onDestroyView()
    }

    private val ProfileSection.label: String
        get() = getString(labelResId)

    private enum class ProfileSection(val labelResId: Int) {
        POSTS(R.string.profile_section_posts),
        REELS(R.string.profile_section_reels),
        SAVED(R.string.profile_section_saved),
        TAGGED(R.string.profile_section_tagged),
    }

    private data class ProfileSectionPage(
        val items: List<PostResponse>,
        val nextCursor: String?,
    )

    private companion object {
        const val ARG_PROFILE_USER_ID = "profileUserId"
        const val ARG_RELATION = "relation"
        const val ARG_CONVERSATION_ID = "conversationId"
        const val FOLLOWERS = "followers"
        const val FOLLOWING = "following"
        const val PROFILE_COMMENTS_TAG = "profile_post_comments"
        const val PROFILE_STORY_CREATION_TAG = "profile_story_creation"
        const val PROFILE_MENU_TAG = "profile_more_menu"
    }
}
