package com.cliqheart.app

import android.app.Application
import com.cliqheart.app.core.network.ApiClient

class CliQHeartApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        ApiClient.initialize(this)
    }
}
