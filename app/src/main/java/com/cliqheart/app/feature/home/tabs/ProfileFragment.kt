package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.GridLayoutManager
import com.cliqheart.app.core.security.SecureTokenStore
import com.cliqheart.app.databinding.FragmentProfileBinding
import com.cliqheart.app.feature.home.adapters.GridPostsAdapter
import com.cliqheart.app.feature.home.models.PostModel

class ProfileFragment : Fragment() {
    private var _binding: FragmentProfileBinding? = null
    private val binding get() = requireNotNull(_binding)

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentProfileBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val userSession = SecureTokenStore(requireContext()).readSession()
        binding.profileUsernameTitle.text = "cliqheart_user"
        binding.profileDisplayName.text = "CliQHeart Creator"
        binding.profileBio.text = "Living life one moment at a time. 🎨📸"

        val profilePosts = (1..9).map { index ->
            PostModel(
                id = index.toString(),
                authorName = "CliQHeart Creator",
                authorUsername = "cliqheart_user",
                authorAvatarUrl = "",
                imageUrl = "",
                caption = "My moment #$index",
                likeCount = index * 45,
                commentCount = index * 3,
                timestamp = "$index w ago",
            )
        }

        val adapter = GridPostsAdapter(profilePosts) { post ->
            Toast.makeText(requireContext(), "Post: ${post.caption}", Toast.LENGTH_SHORT).show()
        }

        binding.profileGridRecycler.layoutManager = GridLayoutManager(requireContext(), 3)
        binding.profileGridRecycler.adapter = adapter

        binding.btnEditProfile.setOnClickListener {
            Toast.makeText(requireContext(), "Edit Profile clicked", Toast.LENGTH_SHORT).show()
        }

        binding.btnShareProfile.setOnClickListener {
            Toast.makeText(requireContext(), "Share Profile clicked", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
