package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.UserResponse
import com.cliqheart.app.core.security.SecureTokenStore
import com.cliqheart.app.core.ui.limitContentWidth
import com.cliqheart.app.databinding.FragmentProfileBinding
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class ProfileFragment : Fragment() {
    private var _binding: FragmentProfileBinding? = null
    private val binding get() = requireNotNull(_binding)
    private var profileJob: Job? = null
    private var avatarJob: Job? = null
    private var currentProfile: UserResponse? = null
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

        SecureTokenStore(requireContext()).readSession()?.currentUser?.let(::showProfile)
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
        if (_binding != null) loadProfile()
    }

    private fun loadProfile() {
        profileJob?.cancel()
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
                    if (isOwnProfile) SecureTokenStore(requireContext()).saveCurrentUser(user)
                    binding.profileState.visibility = View.GONE
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
        avatarJob?.cancel()
        binding.profileAvatar.setImageResource(R.drawable.ic_profile)
        if (imageUrl.isNullOrBlank() || !imageUrl.startsWith("https://", ignoreCase = true)) return
        avatarJob = viewLifecycleOwner.lifecycleScope.launch {
            val bitmap = try {
                withContext(Dispatchers.IO) { downloadAvatar(imageUrl) }
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: IOException) {
                null
            }
            if (bitmap != null && _binding != null) binding.profileAvatar.setImageBitmap(bitmap)
        }
    }

    private fun downloadAvatar(imageUrl: String): Bitmap? {
        val connection = URL(imageUrl).openConnection() as? HttpURLConnection ?: return null
        connection.connectTimeout = 8_000
        connection.readTimeout = 8_000
        connection.instanceFollowRedirects = false
        return try {
            connection.connect()
            if (connection.responseCode !in 200..299) return null
            if (connection.contentLengthLong > MAX_AVATAR_BYTES) return null
            val bytes = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(8192)
                var total = 0
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    if (total > MAX_AVATAR_BYTES) return null
                    bytes.write(buffer, 0, count)
                }
            }
            val imageBytes = bytes.toByteArray()
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            val options = BitmapFactory.Options().apply {
                inSampleSize = maxOf(1, maxOf(bounds.outWidth, bounds.outHeight) / MAX_AVATAR_DIMENSION)
            }
            BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size, options)
        } finally {
            connection.disconnect()
        }
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
                    loadProfile()
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

    override fun onDestroyView() {
        profileJob?.cancel()
        avatarJob?.cancel()
        _binding = null
        super.onDestroyView()
    }

    private companion object {
        const val ARG_PROFILE_USER_ID = "profileUserId"
        const val ARG_RELATION = "relation"
        const val ARG_CONVERSATION_ID = "conversationId"
        const val FOLLOWERS = "followers"
        const val FOLLOWING = "following"
        const val MAX_AVATAR_BYTES = 4 * 1024 * 1024
        const val MAX_AVATAR_DIMENSION = 256
    }
}
