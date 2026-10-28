package com.cliqheart.app.core.ui

import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import androidx.core.view.doOnLayout
import androidx.recyclerview.widget.RecyclerView
import kotlin.math.roundToInt

fun View.limitContentWidth(maxWidthDp: Int) {
    doOnLayout { content ->
        val container = content.parent as? View ?: return@doOnLayout
        val params = content.layoutParams as? FrameLayout.LayoutParams ?: return@doOnLayout
        val maxWidth = (maxWidthDp * resources.displayMetrics.density).roundToInt()
        val width = minOf(maxWidth, container.width)
        if (width > 0 && (params.width != width || params.gravity != Gravity.CENTER_HORIZONTAL)) {
            params.width = width
            params.gravity = Gravity.CENTER_HORIZONTAL
            content.layoutParams = params
        }
    }
}

fun RecyclerView.adaptiveGridSpanCount(minCellWidthDp: Int): Int {
    val minCellWidth = minCellWidthDp * resources.displayMetrics.density
    return (width / minCellWidth).toInt().coerceAtLeast(1)
}
