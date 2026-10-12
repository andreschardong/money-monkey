package com.andreschardong.moneymonkey

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.andreschardong.moneymonkey.ui.MoneyMonkeyRoot
import com.andreschardong.moneymonkey.ui.theme.MoneyMonkeyTheme
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
    /** The token of a sign-in link that opened the app, until the sign-in screen has used it. */
    private val pendingLinkToken = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) pendingLinkToken.value = linkTokenOf(intent)

        val container = (application as MoneyMonkeyApp).container
        setContent {
            MoneyMonkeyTheme {
                MoneyMonkeyRoot(
                    container = container,
                    pendingLinkToken = pendingLinkToken,
                    onLinkTokenUsed = { pendingLinkToken.value = null },
                )
            }
        }
    }

    // The app is already open (launchMode singleTop) and another sign-in link was tapped.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        linkTokenOf(intent)?.let { pendingLinkToken.value = it }
    }

    private fun linkTokenOf(intent: Intent?): String? =
        intent?.data?.takeIf { it.path == "/email-link" }?.getQueryParameter("token")
}
