package com.cliqheart.app.feature.welcome

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.cliqheart.app.core.di.AppContainer
import com.cliqheart.app.core.network.HealthCheckResult
import com.cliqheart.app.core.network.HealthRepository
import kotlinx.coroutines.launch

class WelcomeViewModel(
    private val repository: HealthRepository,
) : ViewModel() {
    private val _apiStatus = MutableLiveData("Checking API connection...")
    val apiStatus: LiveData<String> = _apiStatus

    init {
        viewModelScope.launch {
            _apiStatus.value = when (val result = repository.check()) {
                is HealthCheckResult.Available -> "API status: ${result.status}"
                HealthCheckResult.Unavailable ->
                    "API status unavailable. You can still explore the welcome screen."
            }
        }
    }

    class Factory(
        private val repository: HealthRepository = AppContainer.healthRepository,
    ) : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            require(modelClass == WelcomeViewModel::class.java) {
                "Unsupported ViewModel class: ${modelClass.name}"
            }
            return modelClass.cast(WelcomeViewModel(repository))
        }
    }
}
