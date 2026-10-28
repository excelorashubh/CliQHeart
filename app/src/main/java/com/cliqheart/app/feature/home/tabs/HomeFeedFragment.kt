package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.ConcatAdapter
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.navigation.fragment.findNavController
import com.cliqheart.app.R
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
            binding.swipeRefreshLayout.isRefreshing = false
            Toast.makeText(requireContext(), R.string.posts_unavailable, Toast.LENGTH_SHORT).show()
        }

        binding.btnHeaderSearch.setOnClickListener {
            (parentFragment as? com.cliqheart.app.feature.home.MainShellFragment)?.openDiscover()
        }

        binding.btnHeaderMessages.setOnClickListener {
            findNavController().navigate(R.id.messagesFragment)
        }
    }

    private fun setupFeed() {
        val adapter = FeedAdapter(
            posts = emptyList(),
            onLikeClicked = { showPostFeatureUnavailable() },
            onBookmarkClicked = { showPostFeatureUnavailable() },
            onCommentClicked = { showPostFeatureUnavailable() },
        )

        val headerAdapter = HomeFeedHeaderAdapter()
        binding.feedRecyclerView.layoutManager = LinearLayoutManager(requireContext())
        binding.feedRecyclerView.adapter = ConcatAdapter(headerAdapter, adapter)
    }

    private fun showPostFeatureUnavailable() {
        Toast.makeText(requireContext(), R.string.post_features_unavailable, Toast.LENGTH_SHORT).show()
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
