package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.GridLayoutManager
import com.cliqheart.app.databinding.FragmentDiscoverBinding
import com.cliqheart.app.feature.home.adapters.GridPostsAdapter
import com.cliqheart.app.feature.home.models.PostModel

class DiscoverFragment : Fragment() {
    private var _binding: FragmentDiscoverBinding? = null
    private val binding get() = requireNotNull(_binding)

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentDiscoverBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val sampleGridPosts = (1..12).map { index ->
            PostModel(
                id = index.toString(),
                authorName = "Creator $index",
                authorUsername = "creator_$index",
                authorAvatarUrl = "",
                imageUrl = "",
                caption = "Discovering new moments #$index",
                likeCount = index * 120,
                commentCount = index * 5,
                timestamp = "$index d ago",
            )
        }

        val adapter = GridPostsAdapter(sampleGridPosts) { post ->
            Toast.makeText(requireContext(), "Discover post by @${post.authorUsername}", Toast.LENGTH_SHORT).show()
        }

        binding.discoverGridRecycler.layoutManager = GridLayoutManager(requireContext(), 3)
        binding.discoverGridRecycler.adapter = adapter
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
