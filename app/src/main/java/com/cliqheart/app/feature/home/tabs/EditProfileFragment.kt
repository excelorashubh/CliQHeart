package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.ProfileUpdateRequest
import com.cliqheart.app.databinding.FragmentEditProfileBinding
import com.cliqheart.app.feature.home.apiErrorMessage
import com.cliqheart.app.feature.home.MainShellViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class EditProfileFragment : Fragment() {
    private var _binding: FragmentEditProfileBinding? = null
    private val binding get() = requireNotNull(_binding)
    private val homeDataViewModel: MainShellViewModel by activityViewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        _binding = FragmentEditProfileBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val cachedUser = homeDataViewModel.currentUser.value
        if (cachedUser != null) populate(cachedUser)
        binding.saveProfileButton.setOnClickListener { saveProfile() }
        loadProfile()
    }

    private fun loadProfile() {
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.getMyProfile()
                val user = response.body()?.user
                if (!response.isSuccessful || user == null) {
                    showFailure(apiErrorMessage(response, getString(R.string.profile_save_failed)))
                    return@launch
                }
                homeDataViewModel.updateCurrentUser(user)
                populate(user)
                binding.saveProfileButton.isEnabled = true
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                showFailure()
            }
        }
    }

    private fun populate(user: com.cliqheart.app.core.network.UserResponse) {
        binding.editDisplayName.setText(user.displayName.orEmpty())
        binding.editUsername.setText(user.username.orEmpty())
        binding.editBio.setText(user.bio.orEmpty())
    }

    private fun saveProfile() {
        val displayName = binding.editDisplayName.text?.toString()?.trim().orEmpty()
        val username = binding.editUsername.text?.toString()?.trim().orEmpty()
        val bio = binding.editBio.text?.toString()?.trim().orEmpty()
        if (displayName.isBlank() || username.length !in 3..30) {
            binding.editProfileState.text = getString(R.string.profile_save_failed)
            binding.editProfileState.visibility = View.VISIBLE
            return
        }
        binding.saveProfileButton.isEnabled = false
        binding.editProfileState.visibility = View.GONE
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.updateMyProfile(
                    ProfileUpdateRequest(
                        username = username,
                        displayName = displayName,
                        bio = bio,
                    ),
                )
                val user = response.body()?.user
                if (!response.isSuccessful || user == null) {
                    showFailure(apiErrorMessage(response, getString(R.string.profile_save_failed)))
                    return@launch
                }
                homeDataViewModel.updateCurrentUser(user)
                binding.editProfileState.text = getString(R.string.profile_updated)
                binding.editProfileState.visibility = View.VISIBLE
                findNavController().popBackStack()
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                showFailure(getString(R.string.profile_save_failed))
            } finally {
                if (_binding != null) binding.saveProfileButton.isEnabled = true
            }
        }
    }

    private fun showFailure(message: String = getString(R.string.profile_save_failed)) {
        binding.editProfileState.text = message
        binding.editProfileState.visibility = View.VISIBLE
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
