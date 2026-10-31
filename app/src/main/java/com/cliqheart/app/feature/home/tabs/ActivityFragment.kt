package com.cliqheart.app.feature.home.tabs

import android.os.Bundle
import android.text.format.DateUtils
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.R
import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.ui.limitContentWidth
import com.cliqheart.app.databinding.FragmentActivityBinding
import com.cliqheart.app.feature.home.adapters.ActivityAdapter
import com.cliqheart.app.feature.home.apiErrorMessage
import com.cliqheart.app.feature.home.models.ActivityItemModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.io.IOException
import java.time.Instant

class ActivityFragment : Fragment() {
    private var _binding: FragmentActivityBinding? = null
    private val binding get() = requireNotNull(_binding)
    private lateinit var adapter: ActivityAdapter
    private var nextCursor: String? = null
    private var loadedPage = false
    private var loading = false

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentActivityBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        view.limitContentWidth(720)
        adapter = ActivityAdapter(
            onFollowClick = ::followActor,
            onItemClick = ::openNotification,
        )
        binding.activityRecycler.layoutManager = LinearLayoutManager(requireContext())
        binding.activityRecycler.adapter = adapter
        binding.activityEmptyState.setOnClickListener { loadNotifications() }
        binding.activityRecycler.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                val layout = recyclerView.layoutManager as? LinearLayoutManager ?: return
                if (dy > 0 && nextCursor != null &&
                    layout.findLastVisibleItemPosition() >= adapter.itemCount - 4
                ) {
                    loadNotifications(append = true)
                }
            }
        })
        loadNotifications()
    }

    private fun loadNotifications(append: Boolean = false) {
        if (loading || (append && loadedPage && nextCursor == null)) return
        loading = true
        if (!append && adapter.itemCount == 0) {
            binding.activityEmptyState.text = getString(R.string.loading_activity)
            binding.activityEmptyState.visibility = View.VISIBLE
        }
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.getNotifications(after = if (append) nextCursor else null)
                if (!response.isSuccessful) {
                    showFailure(apiErrorMessage(response, getString(R.string.activity_load_failed)))
                    return@launch
                }
                val page = response.body()
                    ?: throw IOException(getString(R.string.activity_load_failed))
                adapter.submitItems(
                    page.notifications.map(::toActivityItem),
                    append = append,
                )
                nextCursor = page.nextCursor
                loadedPage = true
                binding.activityEmptyState.text = getString(R.string.no_activity_yet)
                binding.activityEmptyState.visibility =
                    if (adapter.itemCount == 0) View.VISIBLE else View.GONE
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: IOException) {
                showFailure()
            } catch (_: RuntimeException) {
                showFailure()
            } finally {
                loading = false
            }
        }
    }

    private fun toActivityItem(notification: com.cliqheart.app.core.network.NotificationResponse): ActivityItemModel {
        val actor = notification.actor
        val type = notification.type.orEmpty()
        val actionText = when (type) {
            "follow" -> R.string.notification_followed
            "tag" -> R.string.notification_tagged
            "message" -> R.string.notification_messaged
            "like", "story_like" -> R.string.notification_liked
            "comment" -> R.string.notification_commented
            "reply" -> R.string.notification_replied
            "repost" -> R.string.notification_reposted
            "story_reaction" -> R.string.notification_reacted
            else -> R.string.notification_updated
        }
        val timeAgo = notification.createdAt?.let { createdAt ->
            runCatching {
                DateUtils.getRelativeTimeSpanString(
                    Instant.parse(createdAt).toEpochMilli(),
                    System.currentTimeMillis(),
                    DateUtils.MINUTE_IN_MILLIS,
                ).toString()
            }.getOrNull()
        }.orEmpty()
        return ActivityItemModel(
            id = notification.id.orEmpty(),
            avatarUrl = actor?.avatarUrl.orEmpty(),
            username = actor?.displayName?.takeIf(String::isNotBlank)
                ?: "@${actor?.username.orEmpty()}",
            actionText = getString(actionText),
            timeAgo = timeAgo,
            postImageUrl = notification.thumbnailUrl,
            isFollowAction = type == "follow",
            actorId = actor?.id ?: actor?._id,
            isRead = notification.read,
        )
    }

    private fun openNotification(item: ActivityItemModel) {
        markNotificationRead(item)
        val actorId = item.actorId ?: return
        findNavController().navigate(
            R.id.profileDetailFragment,
            Bundle().apply { putString(ARG_PROFILE_USER_ID, actorId) },
        )
    }

    private fun markNotificationRead(item: ActivityItemModel) {
        if (item.isRead || item.id.isBlank()) return
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.markNotificationRead(item.id)
                if (response.isSuccessful) {
                    adapter.markRead(item.id)
                } else {
                    Toast.makeText(
                        requireContext(),
                        apiErrorMessage(response, getString(R.string.activity_load_failed)),
                        Toast.LENGTH_SHORT,
                    ).show()
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: IOException) {
                showActionFailure(R.string.activity_load_failed)
            } catch (_: RuntimeException) {
                showActionFailure(R.string.activity_load_failed)
            }
        }
    }

    private fun followActor(item: ActivityItemModel) {
        val actorId = item.actorId ?: return
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = ApiClient.service.followUser(actorId)
                if (response.isSuccessful && response.body()?.following == true) {
                    adapter.markFollowed(item.id)
                } else {
                    Toast.makeText(
                        requireContext(),
                        apiErrorMessage(response, getString(R.string.profile_action_failed)),
                        Toast.LENGTH_SHORT,
                    ).show()
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: IOException) {
                showActionFailure(R.string.profile_action_failed)
            } catch (_: RuntimeException) {
                showActionFailure(R.string.profile_action_failed)
            }
        }
    }

    private fun showFailure(message: String = getString(R.string.activity_load_failed)) {
        if (adapter.itemCount == 0) {
            binding.activityEmptyState.text = message
            binding.activityEmptyState.visibility = View.VISIBLE
        } else {
            showActionFailure(message)
        }
    }

    private fun showActionFailure(message: String) {
        Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show()
    }

    private fun showActionFailure(messageRes: Int) {
        Toast.makeText(requireContext(), messageRes, Toast.LENGTH_SHORT).show()
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    private companion object {
        const val ARG_PROFILE_USER_ID = "profileUserId"
    }
}
