package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import androidx.navigation.NavOptions
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.LogoutRequest
import com.cliqheart.app.core.network.UserResponse
import com.cliqheart.app.core.security.SecureTokenStore
import com.cliqheart.app.core.ui.limitContentWidth
import com.cliqheart.app.databinding.FragmentProfileBinding
import com.cliqheart.app.feature.home.MainShellViewModel
import com.cliqheart.app.feature.home.RemoteImageLoader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

class ProfileFragment : Fragment() {
    private var _binding: FragmentProfileBinding? = null
    private val binding get() = requireNotNull(_binding)
    private val homeDataViewModel: MainShellViewModel by activityViewModels()
    private var profileJob: Job? = null
    private var currentProfile: UserResponse? = null
    private var profileLoaded = false
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
        } else {
            SecureTokenStore(requireContext()).readSession()?.currentUser?.let {
                showProfile(it)
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
        binding.btnLogout.visibility = if (isOwnProfile) View.VISIBLE else View.GONE
        binding.btnLogout.setOnClickListener { logout() }
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
        loadAvatar(user.avatarUrl)
        binding.statFollowersCount.text = user.followersCount?.toString() ?: "—"
        binding.statFollowingCount.text = user.followingCount?.toString() ?: "—"
        binding.btnEditProfile.text = if (isOwnProfile) {
            getString(R.string.edit_profile)
        } else if (user.isFollowing == true) {
            getString(R.string.following)
        } else {
            getString(R.string.follow)
        }

    }

    private fun loadAvatar(imageUrl: String?) {
        RemoteImageLoader.load(binding.profileAvatar, imageUrl, R.drawable.ic_profile)
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
        val username = binding.profileUsernameTitle.text.toString()
        val shareIntent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(android.content.Intent.EXTRA_TEXT, username)
        }
        startActivity(android.content.Intent.createChooser(shareIntent, getString(R.string.share_profile)))
    }

    private fun logout() {
        val store = SecureTokenStore(requireContext())
        val refreshToken = store.readSession()?.refreshToken
        if (refreshToken.isNullOrBlank()) {
            store.clear()
            navigateToWelcome()
            return
        }

        binding.btnLogout.isEnabled = false
        binding.btnLogout.text = getString(R.string.logging_out)
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
        _binding = null
        super.onDestroyView()
    }

    private companion object {
        const val ARG_PROFILE_USER_ID = "profileUserId"
        const val ARG_RELATION = "relation"
        const val ARG_CONVERSATION_ID = "conversationId"
        const val FOLLOWERS = "followers"
        const val FOLLOWING = "following"
    }
}
