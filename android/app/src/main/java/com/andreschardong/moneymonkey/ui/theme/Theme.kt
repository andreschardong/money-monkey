package com.andreschardong.moneymonkey.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

// The website's "Ink and loonie" palette (web/src/styles.scss), so the app and the site look like one product.

private val LightColors = lightColorScheme(
    primary = Color(0xFF1B5F9C),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE5EEF7),
    onPrimaryContainer = Color(0xFF174F82),
    secondary = Color(0xFFB07A1F),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFF7EFDF),
    onSecondaryContainer = Color(0xFF855A10),
    background = Color(0xFFF2F4F5),
    onBackground = Color(0xFF172430),
    surface = Color(0xFFF2F4F5),
    onSurface = Color(0xFF172430),
    surfaceVariant = Color(0xFFEEF2F4),
    onSurfaceVariant = Color(0xFF4E5C68),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color.White,
    surfaceContainer = Color(0xFFEEF2F4),
    surfaceContainerHigh = Color(0xFFE7EBEE),
    outline = Color(0xFFC3CCD3),
    outlineVariant = Color(0xFFDCE2E6),
    error = Color(0xFFB3261E),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF6AA8E0),
    onPrimary = Color(0xFF0B1A26),
    primaryContainer = Color(0xFF1A2D3D),
    onPrimaryContainer = Color(0xFF8DBDE9),
    secondary = Color(0xFFBF8A2C),
    onSecondary = Color(0xFF0B1A26),
    secondaryContainer = Color(0xFF2B2416),
    onSecondaryContainer = Color(0xFFD9A441),
    background = Color(0xFF0E1519),
    onBackground = Color(0xFFE4EAEE),
    surface = Color(0xFF0E1519),
    onSurface = Color(0xFFE4EAEE),
    surfaceVariant = Color(0xFF1C2831),
    onSurfaceVariant = Color(0xFFA9B6C0),
    surfaceContainerLowest = Color(0xFF162027),
    surfaceContainerLow = Color(0xFF162027),
    surfaceContainer = Color(0xFF1B2730),
    surfaceContainerHigh = Color(0xFF1C2831),
    outline = Color(0xFF35444F),
    outlineVariant = Color(0xFF26333C),
    error = Color(0xFFF28B82),
)

/** Colours for money going up or down, which Material has no slot for. */
@Immutable
data class MoneyColors(val gain: Color, val loss: Color)

private val LightMoney = MoneyColors(gain = Color(0xFF137A4B), loss = Color(0xFFB3261E))
private val DarkMoney = MoneyColors(gain = Color(0xFF4CC38A), loss = Color(0xFFF28B82))

val LocalMoneyColors = staticCompositionLocalOf { LightMoney }

/** In a composable: `MoneyTheme.colors.gain`. */
object MoneyTheme {
    val colors: MoneyColors
        @Composable get() = LocalMoneyColors.current
}

@Composable
fun MoneyMonkeyTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalMoneyColors provides if (dark) DarkMoney else LightMoney) {
        MaterialTheme(colorScheme = if (dark) DarkColors else LightColors, content = content)
    }
}
