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
)
data class LastMessageResponse(val text: String? = null, val createdAt: String? = null)
data class ConversationsResponse(val conversations: List<ConversationResponse> = emptyList())
data class MessageCreateRequest(val text: String)
data class MessageResponse(
    val id: String? = null,
    val senderId: String? = null,
    val text: String? = null,
    val createdAt: String? = null,
)
data class MessagesResponse(val messages: List<MessageResponse> = emptyList())
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
data class PostResponse(val id: String? = null)
data class PostEnvelope(val post: PostResponse? = null)

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

    @GET("users/{userId}")
    suspend fun getProfile(@Path("userId") userId: String): Response<UserEnvelope>

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
    suspend fun getConversations(): Response<ConversationsResponse>

    @POST("conversations")
    suspend fun createConversation(@Body request: ConversationCreateRequest): Response<ConversationEnvelope>

    @GET("conversations/{conversationId}/messages")
    suspend fun getMessages(@Path("conversationId") conversationId: String): Response<MessagesResponse>

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
}
