package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.ConcatAdapter
import androidx.recyclerview.widget.LinearLayoutManager
import com.cliqheart.app.core.ui.limitContentWidth
import com.cliqheart.app.databinding.FragmentHomeFeedBinding
import com.cliqheart.app.feature.home.adapters.FeedAdapter
import com.cliqheart.app.feature.home.adapters.HomeFeedHeaderAdapter
import com.cliqheart.app.feature.home.models.PostModel

class HomeFeedFragment : Fragment() {
    private var _binding: FragmentHomeFeedBinding? = null
    private val binding get() = requireNotNull(_binding)

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentHomeFeedBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        view.limitContentWidth(680)
        setupFeed()

        binding.swipeRefreshLayout.setOnRefreshListener {
            // Refresh feed items
            binding.swipeRefreshLayout.isRefreshing = false
            Toast.makeText(requireContext(), "Feed updated", Toast.LENGTH_SHORT).show()
        }

        binding.btnHeaderSearch.setOnClickListener {
            Toast.makeText(requireContext(), "Opening search...", Toast.LENGTH_SHORT).show()
        }

        binding.btnHeaderMessages.setOnClickListener {
            Toast.makeText(requireContext(), "Messages inbox", Toast.LENGTH_SHORT).show()
        }
    }

    private fun setupFeed() {
        val samplePosts = listOf(
            PostModel(
                id = "1",
                authorName = "Sarah Miller",
                authorUsername = "sarah_m",
                authorAvatarUrl = "",
                location = "San Francisco, CA",
                imageUrl = "",
                caption = "Golden hour vibes in the city! 🌇 Staying connected with amazing people.",
                likeCount = 1284,
                commentCount = 42,
                isLiked = true,
                isBookmarked = false,
                timestamp = "2 hours ago",
            ),
            PostModel(
                id = "2",
                authorName = "Alex Chen",
                authorUsername = "alex_k",
                authorAvatarUrl = "",
                location = "Tokyo, Japan",
                imageUrl = "",
                caption = "Exploring quiet alleyways and vibrant lights in Shinjuku 🇯🇵✨",
                likeCount = 892,
                commentCount = 18,
                isLiked = false,
                isBookmarked = true,
                timestamp = "5 hours ago",
            ),
            PostModel(
                id = "3",
                authorName = "CliQHeart Official",
                authorUsername = "cliqheart",
                authorAvatarUrl = "",
                location = "Global",
                imageUrl = "",
                caption = "Welcome to the new CliQHeart experience! Connect, discover, and belong. ❤️",
                likeCount = 3450,
                commentCount = 120,
                isLiked = true,
                isBookmarked = true,
                timestamp = "1 day ago",
            ),
        )

        val adapter = FeedAdapter(
            posts = samplePosts,
            onLikeClicked = { post ->
                Toast.makeText(
                    requireContext(),
                    if (post.isLiked) "Liked post" else "Unliked post",
                    Toast.LENGTH_SHORT,
                ).show()
            },
            onBookmarkClicked = { post ->
                Toast.makeText(
                    requireContext(),
                    if (post.isBookmarked) "Saved to bookmarks" else "Removed bookmark",
                    Toast.LENGTH_SHORT,
                ).show()
            },
            onCommentClicked = { post ->
                Toast.makeText(requireContext(), "Comments for post by @${post.authorUsername}", Toast.LENGTH_SHORT).show()
            },
        )

        val headerAdapter = HomeFeedHeaderAdapter()
        binding.feedRecyclerView.layoutManager = LinearLayoutManager(requireContext())
        binding.feedRecyclerView.adapter = ConcatAdapter(headerAdapter, adapter)
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
