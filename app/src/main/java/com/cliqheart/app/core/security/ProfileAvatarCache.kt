package com.cliqheart.app.core.security

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File
import java.io.FileOutputStream

object ProfileAvatarCache {
    private const val AVATAR_FILENAME_PREFIX = "profile_avatar_"

    private fun getAvatarFile(context: Context, userId: String): File {
        val safeId = userId.takeIf { it.isNotBlank() } ?: "default"
        return File(context.applicationContext.filesDir, "$AVATAR_FILENAME_PREFIX$safeId.jpg")
    }

    fun saveAvatarBitmap(context: Context, userId: String, bitmap: Bitmap) {
        runCatching {
            val file = getAvatarFile(context, userId)
            FileOutputStream(file).use { out ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
                out.flush()
            }
        }
    }

    fun loadAvatarBitmap(context: Context, userId: String): Bitmap? {
        return runCatching {
            val file = getAvatarFile(context, userId)
            if (file.exists() && file.canRead()) {
                BitmapFactory.decodeFile(file.absolutePath)
            } else {
                null
            }
        }.getOrNull()
    }

    fun clearAvatar(context: Context, userId: String) {
        runCatching {
            val file = getAvatarFile(context, userId)
            if (file.exists()) file.delete()
        }
    }
}
