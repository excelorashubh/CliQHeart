package com.cliqheart.app.core.di

import com.cliqheart.app.core.network.ApiClient
import com.cliqheart.app.core.network.HealthRepository

object AppContainer {
    val healthRepository: HealthRepository by lazy {
        HealthRepository(ApiClient.service)
    }
}
