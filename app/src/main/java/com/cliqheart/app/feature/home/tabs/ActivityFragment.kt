package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import com.cliqheart.app.databinding.FragmentActivityBinding
import com.cliqheart.app.feature.home.adapters.ActivityAdapter
import com.cliqheart.app.feature.home.models.ActivityItemModel

class ActivityFragment : Fragment() {
    private var _binding: FragmentActivityBinding? = null
    private val binding get() = requireNotNull(_binding)

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentActivityBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val sampleActivities = listOf(
            ActivityItemModel("1", "", "sarah_m", "liked your photo.", "2m"),
            ActivityItemModel("2", "", "alex_k", "started following you.", "1h", isFollowAction = true),
            ActivityItemModel("3", "", "mario_dev", "commented: Great photo!", "3h"),
            ActivityItemModel("4", "", "elena_v", "liked your post.", "1d"),
            ActivityItemModel("5", "", "cliqheart", "welcome to CliQHeart community!", "2d", isFollowAction = true),
        )

        val adapter = ActivityAdapter(sampleActivities) { item ->
            Toast.makeText(requireContext(), "@${item.username} ${item.actionText}", Toast.LENGTH_SHORT).show()
        }

        binding.activityRecyclerView.layoutManager = LinearLayoutManager(requireContext())
        binding.activityRecyclerView.adapter = adapter
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
