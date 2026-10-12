@file:OptIn(ExperimentalMaterial3Api::class)

package com.andreschardong.moneymonkey.ui

import android.util.Log
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.andreschardong.moneymonkey.AppContainer
import com.andreschardong.moneymonkey.auth.Session
import com.andreschardong.moneymonkey.ui.account.AccountScreen
import com.andreschardong.moneymonkey.ui.account.AccountViewModel
import com.andreschardong.moneymonkey.ui.overview.OverviewScreen
import com.andreschardong.moneymonkey.ui.overview.OverviewViewModel
import com.andreschardong.moneymonkey.ui.signin.SignInScreen
import com.andreschardong.moneymonkey.ui.signin.SignInViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

// The screens you can navigate to once signed in. Lesson 2 adds one for a single portfolio.
@Serializable
data object OverviewRoute

@Serializable
data object AccountRoute

/** Decides what to show: a check with the server at start, the sign-in screen, or the app itself. */
@Composable
fun MoneyMonkeyRoot(container: AppContainer, pendingLinkToken: StateFlow<String?>, onLinkTokenUsed: () -> Unit) {
    val session by container.auth.session.collectAsStateWithLifecycle()
    val signIn: SignInViewModel = viewModel { SignInViewModel(container.auth) }
    val signInState by signIn.state.collectAsStateWithLifecycle()
    val linkToken by pendingLinkToken.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var startError by remember { mutableStateOf<String?>(null) }

    fun checkSession() {
        scope.launch {
            startError = null
            try {
                container.auth.refresh()
            } catch (e: Exception) {
                Log.w("MoneyMonkey", "Checking the session failed", e)
                startError = "Money Monkey can't reach its server (${container.serverUrl.host}). Check the connection."
            }
        }
    }

    // At start, ask who is signed in, unless a sign-in link opened the app: that answers the question itself.
    LaunchedEffect(Unit) {
        if (pendingLinkToken.value == null) checkSession()
    }
    LaunchedEffect(linkToken) {
        val token = linkToken ?: return@LaunchedEffect
        onLinkTokenUsed()
        signIn.openLink(token) {
            if (container.auth.session.value == Session.Unknown) checkSession()
        }
    }

    when (val current = session) {
        Session.Unknown -> Surface(Modifier.fillMaxSize()) {
            val error = startError
            if (error == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            } else {
                Column(Modifier.safeDrawingPadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(error)
                    Button(onClick = ::checkSession) { Text("Try again") }
                }
            }
        }

        Session.SignedOut -> SignInScreen(signIn)

        is Session.SignedIn -> SignedInApp(container, current)
    }

    signInState.switchPrompt?.let { prompt ->
        AlertDialog(
            onDismissRequest = signIn::cancelSwitch,
            title = { Text("Switch accounts?") },
            text = { Text(prompt) },
            confirmButton = { TextButton(onClick = signIn::confirmSwitch) { Text("Switch") } },
            dismissButton = { TextButton(onClick = signIn::cancelSwitch) { Text("Stay") } },
        )
    }
}

@Composable
private fun SignedInApp(container: AppContainer, session: Session.SignedIn) {
    val navController = rememberNavController()
    val backStack by navController.currentBackStackEntryAsState()
    val onAccount = backStack?.destination?.hasRoute<AccountRoute>() == true

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Money Monkey") },
                actions = {
                    if (onAccount) {
                        TextButton(onClick = { navController.popBackStack() }) { Text("Done") }
                    } else {
                        TextButton(onClick = { navController.navigate(AccountRoute) }) { Text("Account") }
                    }
                },
            )
        },
    ) { padding ->
        NavHost(navController, startDestination = OverviewRoute, modifier = Modifier.padding(padding)) {
            composable<OverviewRoute> {
                val overview: OverviewViewModel = viewModel { OverviewViewModel(container.portfolios) }
                val state by overview.state.collectAsStateWithLifecycle()
                OverviewScreen(state = state, onRetry = { overview.load() })
            }
            composable<AccountRoute> {
                val account: AccountViewModel = viewModel { AccountViewModel(container.auth, container.portfolios) }
                AccountScreen(session = session, viewModel = account)
            }
        }
    }
}
