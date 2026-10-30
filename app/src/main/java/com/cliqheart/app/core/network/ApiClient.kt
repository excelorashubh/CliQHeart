package com.cliqheart.app.core.network

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import com.cliqheart.app.BuildConfig
import com.cliqheart.app.core.security.SecureTokenStore
import com.google.gson.Gson
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import okio.source
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

object ApiClient {
    private const val NETWORK_LOG_TAG = "CliQHeartNetwork"
    private val supportedImageTypes = setOf("image/jpeg", "image/png", "image/webp")

    @Volatile
    private var tokenStore: SecureTokenStore? = null
    private val refreshLock = Any()
    private val gson = Gson()

    fun initialize(context: Context) {
        tokenStore = SecureTokenStore(context.applicationContext)
    }

    private val apiBaseUrl: String
        get() = BuildConfig.API_BASE_URL.ifBlank { "https://cliqheart.onrender.com/api/v1/" }

    private val refreshClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .callTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    private val cloudinaryClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(2, TimeUnit.MINUTES)
            .writeTimeout(2, TimeUnit.MINUTES)
            .callTimeout(3, TimeUnit.MINUTES)
            .build()
    }

    private val retrofit: Retrofit by lazy {
        require(apiBaseUrl.endsWith("/")) {
            "API_BASE_URL must end in '/' for Retrofit."
        }

        val httpClient = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val request = chain.request()
                val token = tokenStore?.readSession()?.accessToken
                val requestWithToken = if (token.isNullOrBlank()) {
                    request
                } else {
                    request.newBuilder()
                        .header("Authorization", "Bearer " + token)
                        .build()
                }
                val requestId = UUID.randomUUID().toString()
                val requestWithId = requestWithToken.newBuilder()
                    .header("X-Request-ID", requestId)
                    .build()
                val path = requestWithId.url.encodedPath
                val startedAt = System.nanoTime()
                Log.i(
                    NETWORK_LOG_TAG,
                    """{"event":"request_started","requestId":"$requestId","method":"${requestWithId.method}","path":"$path"}""",
                )
                try {
                    chain.proceed(requestWithId).also { response ->
                        Log.i(
                            NETWORK_LOG_TAG,
                            """{"event":"request_completed","requestId":"$requestId","method":"${requestWithId.method}","path":"$path","status":${response.code},"durationMs":${(System.nanoTime() - startedAt) / 1_000_000}}""",
                        )
                    }
                } catch (exception: IOException) {
                    Log.w(
                        NETWORK_LOG_TAG,
                        """{"event":"request_failed","requestId":"$requestId","method":"${requestWithId.method}","path":"$path","category":"${exception.javaClass.simpleName}","durationMs":${(System.nanoTime() - startedAt) / 1_000_000}}""",
                    )
                    throw exception
                }
            }
            .authenticator { _, response -> refreshAfterUnauthorized(response) }
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .callTimeout(30, TimeUnit.SECONDS)
            .build()

        Retrofit.Builder()
            .baseUrl(apiBaseUrl)
            .client(httpClient)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
    }

    val service: ApiService by lazy { retrofit.create(ApiService::class.java) }

    suspend fun uploadToCloudinary(
        context: Context,
        upload: MediaUploadConfiguration,
        uri: Uri,
    ) {
        val apiKey = upload.apiKey?.takeIf(String::isNotBlank)
            ?: throw IOException("The API returned an incomplete upload signature.")
        val uploadUrl = upload.uploadUrl?.takeIf(String::isNotBlank)
            ?: throw IOException("The API returned an incomplete upload signature.")
        val cloudName = upload.cloudName?.takeIf(String::isNotBlank)
            ?: throw IOException("The API returned an incomplete upload signature.")
        val uploadUri = Uri.parse(uploadUrl)
        if (upload.resourceType != "image" || uploadUri.scheme != "https" ||
            uploadUri.host != "api.cloudinary.com" ||
            uploadUri.encodedPath != "/v1_1/$cloudName/image/upload"
        ) {
            throw IOException("The API returned an invalid Cloudinary upload target.")
        }
        val signature = upload.signature?.takeIf(String::isNotBlank)
            ?: throw IOException("The API returned an incomplete upload signature.")
        val publicId = upload.publicId?.takeIf(String::isNotBlank)
            ?: throw IOException("The API returned an incomplete upload signature.")
        val timestamp = upload.timestamp
            ?: throw IOException("The API returned an incomplete upload signature.")
        val maxBytes = upload.maxBytes
            ?: throw IOException("The API returned an incomplete upload signature.")
        if (maxBytes < 1 || upload.allowedFormats.isEmpty()) {
            throw IOException("The API returned an incomplete upload signature.")
        }

        val resolver = context.contentResolver
        val mimeType = resolver.getType(uri)?.takeIf { it in supportedImageTypes }
            ?: throw IOException("Choose a JPEG, PNG, or WebP image.")
        val fileSize = resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null
            }
        if (fileSize != null && (fileSize < 1 || fileSize > maxBytes)) {
            throw IOException("The selected image exceeds the upload size limit.")
        }
        val filename = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
            ?.takeIf(String::isNotBlank)
            ?: "upload.${mimeType.substringAfter('/')}"
        val imageBody = object : RequestBody() {
            override fun contentType(): MediaType = mimeType.toMediaType()
            override fun contentLength(): Long = fileSize ?: -1
            override fun writeTo(sink: BufferedSink) {
                val input = resolver.openInputStream(uri)
                    ?: throw IOException("Could not read the selected image.")
                input.source().use { source -> sink.writeAll(source) }
            }
        }
        val requestBody = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("file", filename, imageBody)
            .addFormDataPart("api_key", apiKey)
            .addFormDataPart("timestamp", timestamp.toString())
            .addFormDataPart("public_id", publicId)
            .addFormDataPart("allowed_formats", upload.allowedFormats.joinToString(","))
            .addFormDataPart("overwrite", "false")
            .addFormDataPart("signature", signature)
            .build()
        val response = executeCloudinaryUpload(
            Request.Builder().url(uploadUrl).post(requestBody).build(),
        )
        response.use {
            if (!it.isSuccessful) {
                val message = it.body?.string()?.let { body ->
                    runCatching { org.json.JSONObject(body).optJSONObject("error")?.optString("message") }
                        .getOrNull()
                }
                throw IOException(message?.takeIf(String::isNotBlank) ?: "Image upload failed (${it.code}).")
            }
        }
    }

    private suspend fun executeCloudinaryUpload(request: Request): okhttp3.Response =
        suspendCancellableCoroutine { continuation ->
            val call: Call = cloudinaryClient.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(e)
                }

                override fun onResponse(call: Call, response: okhttp3.Response) {
                    if (continuation.isActive) continuation.resume(response)
                    else response.close()
                }
            })
        }

    private fun refreshAfterUnauthorized(response: okhttp3.Response): Request? {
        val failedRequest = response.request
        val path = failedRequest.url.encodedPath
        if (path.endsWith("/auth/login") || path.endsWith("/auth/register") ||
            path.endsWith("/auth/refresh") || path.endsWith("/auth/logout")
        ) {
            return null
        }
        val rejectedToken = failedRequest.header("Authorization")
            ?.removePrefix("Bearer ")
            ?.takeIf(String::isNotBlank)
            ?: return null

        synchronized(refreshLock) {
            val store = tokenStore ?: return null
            val current = store.readSession() ?: return null
            val currentAccessToken = current.accessToken ?: return null
            if (currentAccessToken != rejectedToken) {
                return failedRequest.newBuilder()
                    .header("Authorization", "Bearer " + currentAccessToken)
                    .build()
            }
            val currentRefreshToken = current.refreshToken ?: return null

            val requestBody = gson.toJson(RefreshRequest(currentRefreshToken))
                .toRequestBody("application/json".toMediaType())
            val refreshRequest = Request.Builder()
                .url("${apiBaseUrl}auth/refresh")
                .post(requestBody)
                .header("Accept", "application/json")
                .build()
            val refreshResponse = try {
                refreshClient.newCall(refreshRequest).execute()
            } catch (_: java.io.IOException) {
                return null
            }
            refreshResponse.use { result ->
                if (!result.isSuccessful) {
                    if (result.code == 401 || result.code == 403) store.clear()
                    return null
                }
                val body = result.body?.string() ?: return null
                val refreshed = runCatching { gson.fromJson(body, AuthResponse::class.java) }
                    .getOrNull()
                    ?: return null
                val nextAccessToken = refreshed.accessToken
                val nextRefreshToken = refreshed.refreshToken
                if (nextAccessToken.isNullOrBlank() || nextRefreshToken.isNullOrBlank()) {
                    store.clear()
                    return null
                }
                store.saveSession(nextAccessToken, nextRefreshToken, refreshed.user ?: current.currentUser)
                return failedRequest.newBuilder()
                    .header("Authorization", "Bearer " + nextAccessToken)
                    .build()
            }

        }
    }
}
