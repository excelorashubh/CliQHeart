package com.cliqheart.app.core.network

import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Body
import retrofit2.http.PATCH
import retrofit2.http.Path
import retrofit2.http.Query

data class HealthResponse(
    val status: String? = null,
)

data class LoginRequest(
    val identifier: String,
    val password: String,
)

data class RegisterRequest(
    val displayName: String,
    val username: String,
    val email: String,
    val password: String,
    val confirmPassword: String,
    val agreeToTerms: Boolean = true,
)

data class RefreshRequest(val refreshToken: String)
data class LogoutRequest(val refreshToken: String)

data class UserResponse(
    val id: String? = null,
    val _id: String? = null,
    val username: String? = null,
    val email: String? = null,
    val displayName: String? = null,
    val bio: String? = null,
    val avatarUrl: String? = null,
    val followersCount: Int? = null,
    val followingCount: Int? = null,
    val postsCount: Int? = null,
    val isFollowing: Boolean? = null,
    val accountStatus: String? = null,
    val accountType: String? = null,
    val professionalCategory: String? = null,
)

data class UserEnvelope(val user: UserResponse? = null)
data class UsersResponse(val users: List<UserResponse> = emptyList(), val nextCursor: String? = null)
data class FollowResponse(val following: Boolean = false)
data class ProfileUpdateRequest(
    val username: String,
    val displayName: String,
    val bio: String,
    val avatarUrl: String? = null,
)
data class ConversationCreateRequest(val participantId: String)
data class ConversationResponse(
    val id: String? = null,
    val participant: UserResponse? = null,
    val participantId: String? = null,
    val lastMessage: LastMessageResponse? = null,
    val lastMessageAt: String? = null,
    val unreadCount: Int = 0,
)
data class LastMessageResponse(
    val text: String? = null,
    val senderId: String? = null,
    val createdAt: String? = null,
)
data class ConversationsResponse(
    val conversations: List<ConversationResponse> = emptyList(),
    val hasMore: Boolean = false,
    val nextCursor: String? = null,
)
data class MessageCreateRequest(val text: String, val clientMessageId: String? = null)
data class MessageResponse(
    val id: String? = null,
    val senderId: String? = null,
    val text: String? = null,
    val createdAt: String? = null,
    val clientMessageId: String? = null,
    val deliveredAt: String? = null,
    val readAt: String? = null,
    val sending: Boolean = false,
    val failed: Boolean = false,
)
data class MessagesResponse(
    val messages: List<MessageResponse> = emptyList(),
    val hasMore: Boolean = false,
    val nextCursor: String? = null,
)
data class ConversationEnvelope(val conversation: ConversationResponse? = null)
data class MessageEnvelope(val message: MessageResponse? = null)

data class MediaSignatureRequest(
    val purpose: String,
    val resourceType: String,
)
data class MediaUploadConfiguration(
    val apiKey: String? = null,
    val cloudName: String? = null,
    val uploadUrl: String? = null,
    val resourceType: String? = null,
    val timestamp: Long? = null,
    val signature: String? = null,
    val publicId: String? = null,
    val allowedFormats: List<String> = emptyList(),
    val maxBytes: Long? = null,
)
data class MediaUploadResponse(
    val id: String? = null,
    val status: String? = null,
)
data class MediaSignatureResponse(
    val media: MediaUploadResponse? = null,
    val upload: MediaUploadConfiguration? = null,
)
data class MediaEnvelope(val media: MediaUploadResponse? = null)
data class PostCreateRequest(
    val mediaId: String,
    val caption: String,
)
data class StoryCreateRequest(
    val mediaId: String,
    val caption: String = "",
)
data class PostOwnerResponse(
    val id: String? = null,
    val _id: String? = null,
    val username: String? = null,
    val displayName: String? = null,
    val avatarUrl: String? = null,
)
data class PostMediaResponse(
    val resourceType: String? = null,
    val secureUrl: String? = null,
    val thumbnailUrl: String? = null,
    val format: String? = null,
    val width: Int? = null,
    val height: Int? = null,
)
data class PostResponse(
    val id: String? = null,
    val caption: String? = null,
    val createdAt: String? = null,
    val location: String? = null,
    val owner: PostOwnerResponse? = null,
    val media: PostMediaResponse? = null,
    val likeCount: Int? = null,
    val commentCount: Int? = null,
    val repostCount: Int? = null,
    val isLiked: Boolean? = null,
    val isSaved: Boolean? = null,
    val isReposted: Boolean? = null,
    val isFollowing: Boolean? = null,
)
data class PostsResponse(val posts: List<PostResponse> = emptyList(), val nextCursor: String? = null)
data class ReelsResponse(val reels: List<PostResponse> = emptyList(), val nextCursor: String? = null)
data class PostEnvelope(val post: PostResponse? = null)
data class StoryResponse(
    val id: String? = null,
    val caption: String? = null,
    val expiresAt: String? = null,
    val owner: PostOwnerResponse? = null,
    val media: PostMediaResponse? = null,
    val isViewed: Boolean? = null,
)
data class StoriesResponse(val stories: List<StoryResponse> = emptyList())
data class StoryEnvelope(val story: StoryResponse? = null)
data class CommentAuthorResponse(
    val id: String? = null,
    val username: String? = null,
    val displayName: String? = null,
    val avatarUrl: String? = null,
)
data class CommentResponse(
    val id: String? = null,
    val text: String? = null,
    val createdAt: String? = null,
    val likeCount: Int? = null,
    val isLiked: Boolean? = null,
    val author: CommentAuthorResponse? = null,
)
data class CommentsResponse(
    val comments: List<CommentResponse> = emptyList(),
    val nextCursor: String? = null,
)
data class CommentCreateRequest(val text: String)
data class CommentEnvelope(
    val comment: CommentResponse? = null,
    val commentCount: Int? = null,
)
data class StoryViewResponse(
    val viewCount: Int? = null,
    val isLiked: Boolean? = null,
    val isOwner: Boolean? = null,
)
data class UnreadCountResponse(val unreadCount: Int? = null)
data class EngagementResponse(
    val liked: Boolean? = null,
    val likeCount: Int? = null,
    val saved: Boolean? = null,
    val reposted: Boolean? = null,
    val repostCount: Int? = null,
)
data class EngagementContentRequest(val contentId: String, val contentType: String)
data class EngagementSyncRequest(val content: List<EngagementContentRequest>)
data class EngagementSyncItem(
    val contentId: String,
    val contentType: String,
    val likeCount: Int,
    val commentCount: Int,
    val repostCount: Int,
    val isLiked: Boolean,
    val isReposted: Boolean,
)
data class EngagementSyncResponse(val content: List<EngagementSyncItem> = emptyList())
data class NotificationActorResponse(
    val id: String? = null,
    val _id: String? = null,
    val username: String? = null,
    val displayName: String? = null,
    val avatarUrl: String? = null,
)
data class NotificationResponse(
    val id: String? = null,
    val type: String? = null,
    val read: Boolean = false,
    val createdAt: String? = null,
    val actor: NotificationActorResponse? = null,
    val postId: String? = null,
    val reelId: String? = null,
    val commentId: String? = null,
    val conversationId: String? = null,
    val storyId: String? = null,
    val thumbnailUrl: String? = null,
)
data class NotificationsResponse(
    val notifications: List<NotificationResponse> = emptyList(),
    val nextCursor: String? = null,
    val unreadCount: Int = 0,
)
data class NotificationReadResponse(val read: Boolean = false)

data class AuthResponse(
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val message: String? = null,
    val user: UserResponse? = null,
)

interface ApiService {
    @GET("health")
    suspend fun getHealth(): Response<HealthResponse>

    @POST("auth/register")
    suspend fun register(@Body request: RegisterRequest): Response<AuthResponse>

    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): Response<AuthResponse>

    @POST("auth/refresh")
    suspend fun refresh(@Body request: RefreshRequest): Response<AuthResponse>

    @POST("auth/logout")
    suspend fun logout(@Body request: LogoutRequest): Response<Unit>

    @GET("users/me")
    suspend fun getMyProfile(): Response<UserEnvelope>

    @GET("notifications/unread-count")
    suspend fun getUnreadNotificationCount(): Response<UnreadCountResponse>

    @GET("notifications")
    suspend fun getNotifications(
        @Query("limit") limit: Int = 30,
        @Query("after") after: String? = null,
    ): Response<NotificationsResponse>

    @PATCH("notifications/{notificationId}/read")
    suspend fun markNotificationRead(
        @Path("notificationId") notificationId: String,
    ): Response<NotificationReadResponse>

    @GET("messages/unread-count")
    suspend fun getUnreadMessageCount(): Response<UnreadCountResponse>

    @GET("users/{userId}")
    suspend fun getProfile(@Path("userId") userId: String): Response<UserEnvelope>

    @GET("users/{userId}/posts")
    suspend fun getUserPosts(
        @Path("userId") userId: String,
        @Query("limit") limit: Int = 30,
    ): Response<PostsResponse>

    @PATCH("users/me")
    suspend fun updateMyProfile(@Body request: ProfileUpdateRequest): Response<UserEnvelope>

    @GET("users/search")
    suspend fun searchUsers(@Query("q") query: String): Response<UsersResponse>

    @POST("users/{userId}/follow")
    suspend fun followUser(@Path("userId") userId: String): Response<FollowResponse>

    @retrofit2.http.DELETE("users/{userId}/follow")
    suspend fun unfollowUser(@Path("userId") userId: String): Response<FollowResponse>

    @GET("users/{userId}/followers")
    suspend fun getFollowers(
        @Path("userId") userId: String,
        @Query("limit") limit: Int = 30,
        @Query("after") after: String? = null,
    ): Response<UsersResponse>

    @GET("users/{userId}/following")
    suspend fun getFollowing(
        @Path("userId") userId: String,
        @Query("limit") limit: Int = 30,
        @Query("after") after: String? = null,
    ): Response<UsersResponse>

    @GET("conversations")
    suspend fun getConversations(
        @Query("limit") limit: Int = 30,
        @Query("after") after: String? = null,
    ): Response<ConversationsResponse>

    @POST("conversations")
    suspend fun createConversation(@Body request: ConversationCreateRequest): Response<ConversationEnvelope>

    @GET("conversations/{conversationId}/messages")
    suspend fun getMessages(
        @Path("conversationId") conversationId: String,
        @Query("limit") limit: Int = 30,
        @Query("before") before: String? = null,
    ): Response<MessagesResponse>

    @PATCH("conversations/{conversationId}/read")
    suspend fun markConversationRead(
        @Path("conversationId") conversationId: String,
    ): Response<Unit>

    @POST("conversations/{conversationId}/messages")
    suspend fun sendMessage(
        @Path("conversationId") conversationId: String,
        @Body request: MessageCreateRequest,
    ): Response<MessageEnvelope>

    @POST("media/signature")
    suspend fun createMediaSignature(
        @Body request: MediaSignatureRequest,
    ): Response<MediaSignatureResponse>

    @POST("media/{mediaId}/confirm")
    suspend fun confirmMedia(@Path("mediaId") mediaId: String): Response<MediaEnvelope>

    @retrofit2.http.DELETE("media/{mediaId}")
    suspend fun deleteMedia(@Path("mediaId") mediaId: String): Response<Unit>

    @POST("posts")
    suspend fun createPost(@Body request: PostCreateRequest): Response<PostEnvelope>

    @GET("posts")
    suspend fun getPosts(
        @Query("limit") limit: Int = 30,
        @Query("after") after: String? = null,
    ): Response<PostsResponse>

    @GET("reels")
    suspend fun getReels(
        @Query("limit") limit: Int = 30,
        @Query("after") after: String? = null,
    ): Response<ReelsResponse>

    @GET("stories")
    suspend fun getStories(): Response<StoriesResponse>

    @POST("stories")
    suspend fun createStory(@Body request: StoryCreateRequest): Response<StoryEnvelope>

    @POST("engagement/sync")
    suspend fun syncEngagement(@Body request: EngagementSyncRequest): Response<EngagementSyncResponse>

    @GET("{collection}/{contentId}/comments")
    suspend fun getComments(
        @Path("collection") collection: String,
        @Path("contentId") contentId: String,
        @Query("limit") limit: Int = 20,
        @Query("after") after: String? = null,
    ): Response<CommentsResponse>

    @POST("{collection}/{contentId}/comments")
    suspend fun createComment(
        @Path("collection") collection: String,
        @Path("contentId") contentId: String,
        @Body request: CommentCreateRequest,
    ): Response<CommentEnvelope>

    @GET("stories/{storyId}")
    suspend fun getStory(@Path("storyId") storyId: String): Response<StoryEnvelope>

    @POST("stories/{storyId}/view")
    suspend fun markStoryViewed(@Path("storyId") storyId: String): Response<StoryViewResponse>

    @POST("posts/{postId}/like")
    suspend fun likePost(@Path("postId") postId: String): Response<EngagementResponse>

    @retrofit2.http.DELETE("posts/{postId}/like")
    suspend fun unlikePost(@Path("postId") postId: String): Response<EngagementResponse>

    @POST("posts/{postId}/save")
    suspend fun savePost(@Path("postId") postId: String): Response<EngagementResponse>

    @retrofit2.http.DELETE("posts/{postId}/save")
    suspend fun unsavePost(@Path("postId") postId: String): Response<EngagementResponse>

    @POST("posts/{postId}/repost")
    suspend fun repostPost(@Path("postId") postId: String): Response<EngagementResponse>

    @retrofit2.http.DELETE("posts/{postId}/repost")
    suspend fun undoRepostPost(@Path("postId") postId: String): Response<EngagementResponse>

    @POST("{collection}/{contentId}/like")
    suspend fun likeContent(
        @Path("collection") collection: String,
        @Path("contentId") contentId: String,
    ): Response<EngagementResponse>

    @retrofit2.http.DELETE("{collection}/{contentId}/like")
    suspend fun unlikeContent(
        @Path("collection") collection: String,
        @Path("contentId") contentId: String,
    ): Response<EngagementResponse>

    @POST("{collection}/{contentId}/save")
    suspend fun saveContent(
        @Path("collection") collection: String,
        @Path("contentId") contentId: String,
    ): Response<EngagementResponse>

    @retrofit2.http.DELETE("{collection}/{contentId}/save")
    suspend fun unsaveContent(
        @Path("collection") collection: String,
        @Path("contentId") contentId: String,
    ): Response<EngagementResponse>

    @POST("{collection}/{contentId}/repost")
    suspend fun repostContent(
        @Path("collection") collection: String,
        @Path("contentId") contentId: String,
    ): Response<EngagementResponse>

    @retrofit2.http.DELETE("{collection}/{contentId}/repost")
    suspend fun undoRepostContent(
        @Path("collection") collection: String,
        @Path("contentId") contentId: String,
    ): Response<EngagementResponse>
}
