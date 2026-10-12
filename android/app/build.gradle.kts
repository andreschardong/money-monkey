import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// The Money Monkey server this build talks to, from android/local.properties (not committed):
//   moneymonkey.host=moneymonkey.example.com
// Sign-in links to that host open the app, and its passkeys work here once the server lists this app's
// signing certificate (see android/README.md).
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use(::load)
}
val serverHost: String = localProperties.getProperty("moneymonkey.host") ?: "moneymonkey.example.com"

android {
    namespace = "com.andreschardong.moneymonkey"
    // The current Compose and Navigation libraries need the API 37 SDK to compile against.
    compileSdk = 37

    defaultConfig {
        applicationId = "com.andreschardong.moneymonkey"
        // Credential Manager passkeys need Android 9 (API 28) or newer.
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "SERVER_HOST", "\"$serverHost\"")
        manifestPlaceholders["serverHost"] = serverHost
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
