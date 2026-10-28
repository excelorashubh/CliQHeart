package com.cliqheart.app.feature.home.adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.cliqheart.app.core.network.UserResponse
import com.cliqheart.app.databinding.ItemUserSearchResultBinding

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
    }

    fun appendUsers(results: List<UserResponse>) {
        val start = users.size
        users.addAll(results)
        if (results.isNotEmpty()) notifyItemRangeInserted(start, results.size)
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
            binding.userDisplayName.text = user.displayName.orEmpty()
            binding.userUsername.text = user.username?.let { "@$it" }.orEmpty()
            binding.userMessageButton.setOnClickListener { onMessage(user) }
            binding.userMessageButton.visibility = if (showMessageButton) View.VISIBLE else View.GONE
            binding.root.setOnClickListener { onProfile(user) }
        }
    }
}
