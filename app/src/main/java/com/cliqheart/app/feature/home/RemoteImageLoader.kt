package com.cliqheart.app.feature.home

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.LruCache
import android.widget.ImageView
import androidx.annotation.DrawableRes
import com.cliqheart.app.core.network.UserResponse
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

fun UserResponse?.getFallbackAvatarUrl(): String {
    val name = this?.displayName?.trim()?.takeIf { it.isNotBlank() }
        ?: this?.username?.trim()?.takeIf { it.isNotBlank() }
        ?: "User"
    return "https://ui-avatars.com/api/?name=${Uri.encode(name)}&background=FF2A6D&color=fff&size=256&format=png"
}

fun UserResponse?.getEffectiveAvatarUrl(): String {
    val url = this?.avatarUrl?.trim()
    if (!url.isNullOrBlank()) return url
    return getFallbackAvatarUrl()
}

object RemoteImageLoader {
    private const val MAX_IMAGE_BYTES = 8 * 1024 * 1024
    private const val MAX_IMAGE_DIMENSION = 1600
    private const val CACHE_BYTES = 16 * 1024 * 1024
    private const val USER_AGENT = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    private const val TAG = "RemoteImageLoader"

    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newFixedThreadPool(3)
    private val client = OkHttpClient.Builder()
        .followRedirects(true)
        .followSslRedirects(true)
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .build()
    private val bitmapCache = object : LruCache<String, Bitmap>(CACHE_BYTES) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }

    fun load(
        imageView: ImageView,
        imageUrl: String?,
        @DrawableRes placeholder: Int,
        fallbackUrl: String? = null,
        onImageLoaded: ((Bitmap?) -> Unit)? = null,
    ) {
        if (placeholder != 0) imageView.setImageResource(placeholder)
        imageView.tag = imageUrl
        val uri = imageUrl?.let(Uri::parse)
        if (uri == null || (uri.scheme != "http" && uri.scheme != "https") || uri.host.isNullOrBlank()) {
            if (!fallbackUrl.isNullOrBlank() && fallbackUrl != imageUrl) {
                load(imageView, fallbackUrl, placeholder, null, onImageLoaded)
            } else {
                onImageLoaded?.invoke(null)
            }
            return
        }
        val validImageUrl: String = imageUrl

        synchronized(bitmapCache) { bitmapCache.get(validImageUrl) }?.let {
            imageView.setImageBitmap(it)
            onImageLoaded?.invoke(it)
            return
        }

        executor.execute {
            var loadedBitmap: Bitmap? = null
            try {
                loadedBitmap = download(validImageUrl)
            } catch (error: IOException) {
                Log.w(TAG, "Could not load remote image (${error.javaClass.simpleName}).")
                if (!fallbackUrl.isNullOrBlank() && fallbackUrl != validImageUrl) {
                    try {
                        loadedBitmap = download(fallbackUrl)
                    } catch (fallbackError: IOException) {
                        Log.w(TAG, "Could not load fallback image (${fallbackError.javaClass.simpleName}).")
                    }
                }
            }
            loadedBitmap?.let { bitmap ->
                synchronized(bitmapCache) { bitmapCache.put(validImageUrl, bitmap) }
            }
            mainHandler.post {
                if (imageView.tag == validImageUrl) {
                    loadedBitmap?.let(imageView::setImageBitmap)
                    onImageLoaded?.invoke(loadedBitmap)
                }
            }
        }
    }

    @Throws(IOException::class)
    private fun download(imageUrl: String): Bitmap? {
        val request = Request.Builder()
            .url(imageUrl)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "image/*")
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Image request failed (${response.code}).")
            val body = response.body ?: throw IOException("Image response was empty.")
            if (body.contentLength() > MAX_IMAGE_BYTES) throw IOException("Image exceeds the download limit.")
            val contentType = body.contentType()?.type
            if (contentType != "image" && contentType != "application/octet-stream") {
                Log.w(TAG, "Unexpected content-type for image: $contentType")
            }
            val output = ByteArrayOutputStream()
            body.byteStream().use { input ->
                val buffer = ByteArray(8192)
                var total = 0
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    if (total > MAX_IMAGE_BYTES) throw IOException("Image exceeds the download limit.")
                    output.write(buffer, 0, count)
                }
            }
            val bytes = output.toByteArray()
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            val sampleSize = maxOf(
                1,
                maxOf(bounds.outWidth, bounds.outHeight) / MAX_IMAGE_DIMENSION,
            )
            return BitmapFactory.decodeByteArray(
                bytes,
                0,
                bytes.size,
                BitmapFactory.Options().apply { inSampleSize = sampleSize },
            )
        }
    }
}
