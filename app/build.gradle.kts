plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.cliqheart.app"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.cliqheart.app"
        minSdk = 29
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    flavorDimensions += "apiTarget"
    productFlavors {
        create("emulator") {
            dimension = "apiTarget"
            val emulatorApiBaseUrl = providers.gradleProperty("cliqheartEmulatorApiBaseUrl")
                .orElse("http://10.0.2.2:4000/api/v1/")
                .get()
            require(emulatorApiBaseUrl.endsWith("/") && emulatorApiBaseUrl.startsWith("http")) {
                "cliqheartEmulatorApiBaseUrl must be an HTTP(S) URL ending in '/'."
            }
            buildConfigField("String", "API_BASE_URL", "\"$emulatorApiBaseUrl\"")
        }
        create("device") {
            dimension = "apiTarget"
            val deviceApiBaseUrl = providers.gradleProperty("cliqheartDeviceApiBaseUrl")
                .orElse("https://cliqheart.onrender.com/api/v1/")
                .get()
            require(deviceApiBaseUrl.startsWith("http://") || deviceApiBaseUrl.startsWith("https://")) {
                "cliqheartDeviceApiBaseUrl must start with http:// or https://."
            }
            require(deviceApiBaseUrl.endsWith("/")) {
                "cliqheartDeviceApiBaseUrl must end with '/'."
            }
            buildConfigField("String", "API_BASE_URL", "\"$deviceApiBaseUrl\"")
        }
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    buildTypes {
        debug {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        release {
            val configuredApiBaseUrl = providers.gradleProperty("cliqheartApiBaseUrl")
                .orElse("https://cliqheart.onrender.com/api/v1/")
                .get()
            require(configuredApiBaseUrl.startsWith("https://") && configuredApiBaseUrl.endsWith("/")) {
                "cliqheartApiBaseUrl must be an HTTPS URL ending in '/'."
            }
            buildConfigField("String", "API_BASE_URL", "\"$configuredApiBaseUrl\"")
            manifestPlaceholders["usesCleartextTraffic"] = "false"
            optimization {
                enable = true
                packageScope = setOf("androidx.**", "kotlin.**", "kotlinx.**")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

dependencies {
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.constraintlayout)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.fragment.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    implementation(libs.androidx.navigation.fragment.ktx)
    implementation(libs.androidx.navigation.ui.ktx)
    implementation(libs.androidx.splashscreen)
    implementation(libs.androidx.swiperefreshlayout)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.material)
    implementation(libs.okhttp)
    implementation(libs.retrofit)
    implementation(libs.retrofit.converter.gson)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
}
