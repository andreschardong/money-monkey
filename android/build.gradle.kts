// AGP 9 compiles Kotlin itself, so there is no org.jetbrains.kotlin.android plugin. The Compose compiler and
// serialization plugins come from Kotlin and also set the Kotlin version the build uses.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
