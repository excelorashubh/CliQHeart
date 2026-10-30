package com.cliqheart.app.feature.home

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import android.util.Log
import android.widget.ImageView
import androidx.annotation.DrawableRes
import android.net.Uri
import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object RemoteImageLoader {
    private const val MAX_IMAGE_BYTES = 8 * 1024 * 1024
    private const val MAX_IMAGE_DIMENSION = 1600
    private const val CACHE_BYTES = 16 * 1024 * 1024
    private const val TAG = "RemoteImageLoader"

    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newFixedThreadPool(3)
    private val client = OkHttpClient.Builder()
        .followRedirects(false)
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .build()
    private val bitmapCache = object : LruCache<String, Bitmap>(CACHE_BYTES) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }

    fun load(imageView: ImageView, imageUrl: String?, @DrawableRes placeholder: Int) {
        imageView.setImageResource(placeholder)
        imageView.tag = imageUrl
        val uri = imageUrl?.let(Uri::parse) ?: return
        if (uri.scheme != "https" || uri.host.isNullOrBlank()) return

        synchronized(bitmapCache) { bitmapCache.get(imageUrl) }?.let {
            imageView.setImageBitmap(it)
            return
        }

        executor.execute {
            try {
                val bitmap = download(imageUrl) ?: return@execute
                synchronized(bitmapCache) { bitmapCache.put(imageUrl, bitmap) }
                mainHandler.post {
                    if (imageView.tag == imageUrl) imageView.setImageBitmap(bitmap)
                }
            } catch (error: IOException) {
                Log.w(TAG, "Could not load remote image.", error)
            }
        }
    }

    @Throws(IOException::class)
    private fun download(imageUrl: String): Bitmap? {
        val request = Request.Builder().url(imageUrl).header("Accept", "image/*").build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Image request failed (${response.code}).")
            val body = response.body ?: throw IOException("Image response was empty.")
            if (body.contentLength() > MAX_IMAGE_BYTES) throw IOException("Image exceeds the download limit.")
            val contentType = body.contentType()?.type
            if (contentType != "image") throw IOException("Response did not contain an image.")
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
