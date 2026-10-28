package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.UserResponse
import com.cliqheart.app.databinding.FragmentProfileUsersBinding
import com.cliqheart.app.feature.home.adapters.UserSearchAdapter
import com.cliqheart.app.feature.home.apiErrorMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class ProfileUsersFragment : Fragment() {
    private var _binding: FragmentProfileUsersBinding? = null
    private val binding get() = requireNotNull(_binding)
    private var nextCursor: String? = null
    private var loading = false
    private var loadedAny = false
    private lateinit var adapter: UserSearchAdapter
    private val ownerId get() = arguments?.getString(ARG_USER_ID).orEmpty()
    private val relation get() = arguments?.getString(ARG_RELATION).orEmpty()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        _binding = FragmentProfileUsersBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        adapter = UserSearchAdapter(onMessage = {}, onProfile = ::openProfile, showMessageButton = false)
        binding.profileUsersRecycler.layoutManager = LinearLayoutManager(requireContext())
        binding.profileUsersRecycler.adapter = adapter
        binding.profileUsersTitle.text = if (relation == FOLLOWERS) {
            getString(R.string.followers)
        } else {
            getString(R.string.following)
        }
        binding.profileUsersRecycler.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                val layout = recyclerView.layoutManager as? LinearLayoutManager ?: return
                if (dy > 0 && layout.findLastVisibleItemPosition() >= adapter.itemCount - 4) {
                    loadNextPage()
                }
            }
        })
        loadNextPage()
    }

    private fun loadNextPage() {
        if (loading || (loadedAny && nextCursor == null)) return
        loading = true
        binding.profileUsersState.text = getString(R.string.loading_users)
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = if (relation == FOLLOWERS) {
                    ApiClient.service.getFollowers(ownerId, after = nextCursor)
                } else {
                    ApiClient.service.getFollowing(ownerId, after = nextCursor)
                }
                if (!response.isSuccessful) {
                    binding.profileUsersState.text = apiErrorMessage(response, getString(R.string.users_load_failed))
                    binding.profileUsersState.visibility = View.VISIBLE
                    return@launch
                }
                val page = response.body()
                val users = page?.users.orEmpty()
                adapter.appendUsers(users)
                nextCursor = page?.nextCursor
                loadedAny = true
                binding.profileUsersState.text = if (adapter.itemCount == 0) {
                    getString(R.string.no_followers_yet)
                } else {
                    ""
                }
                binding.profileUsersState.visibility =
                    if (adapter.itemCount == 0) View.VISIBLE else View.GONE
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                binding.profileUsersState.text = getString(R.string.users_load_failed)
                binding.profileUsersState.visibility = View.VISIBLE
            } finally {
                loading = false
            }
        }
    }

    private fun openProfile(user: UserResponse) {
        val id = user.id ?: user._id ?: return
        findNavController().navigate(
            R.id.profileDetailFragment,
            Bundle().apply { putString(ARG_USER_ID, id) },
        )
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    private companion object {
        const val ARG_USER_ID = "profileUserId"
        const val ARG_RELATION = "relation"
        const val FOLLOWERS = "followers"
    }
}
