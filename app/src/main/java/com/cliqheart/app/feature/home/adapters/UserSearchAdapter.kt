package com.cliqheart.app.feature.home.adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.R
import com.cliqheart.app.core.network.UserResponse
import com.cliqheart.app.databinding.ItemUserSearchResultBinding
import com.cliqheart.app.feature.home.RemoteImageLoader

class UserSearchAdapter(
    private val onMessage: (UserResponse) -> Unit,
    private val onProfile: (UserResponse) -> Unit = {},
    private val showMessageButton: Boolean = true,
) : RecyclerView.Adapter<UserSearchAdapter.UserViewHolder>() {
    private val users = mutableListOf<UserResponse>()

    fun submitUsers(results: List<UserResponse>) {
        users.clear()
        users.addAll(results)
        notifyDataSetChanged()
        android.util.Log.i(TAG, "People search displayedCount=${itemCount}")
    }

    fun appendUsers(results: List<UserResponse>) {
        val start = users.size
        users.addAll(results)
        if (results.isNotEmpty()) notifyItemRangeInserted(start, results.size)
        android.util.Log.i(TAG, "People search displayedCount=${itemCount}")
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): UserViewHolder {
        return UserViewHolder(
            ItemUserSearchResultBinding.inflate(LayoutInflater.from(parent.context), parent, false),
            onMessage,
            onProfile,
            showMessageButton,
        )
    }

    override fun onBindViewHolder(holder: UserViewHolder, position: Int) {
        holder.bind(users[position])
    }

    override fun getItemCount(): Int = users.size

    class UserViewHolder(
        private val binding: ItemUserSearchResultBinding,
        private val onMessage: (UserResponse) -> Unit,
        private val onProfile: (UserResponse) -> Unit,
        private val showMessageButton: Boolean,
    ) : RecyclerView.ViewHolder(binding.root) {
        fun bind(user: UserResponse) {
            RemoteImageLoader.load(binding.userAvatar, user.avatarUrl, R.drawable.ic_profile)
            binding.userDisplayName.text = user.displayName?.takeIf(String::isNotBlank)
                ?: user.username.orEmpty()
            binding.userUsername.text = user.username?.let { "@$it" }.orEmpty()
            binding.userFollowState.visibility = if (user.isFollowing == null) View.GONE else View.VISIBLE
            binding.userFollowState.text = if (user.isFollowing == true) {
                binding.root.context.getString(R.string.following)
            } else {
                binding.root.context.getString(R.string.not_following)
            }
            binding.userMessageButton.setOnClickListener { onMessage(user) }
            binding.userMessageButton.visibility = if (showMessageButton) View.VISIBLE else View.GONE
            binding.root.setOnClickListener { onProfile(user) }
        }
    }

    private companion object {
        const val TAG = "UserSearchAdapter"
    }
}
