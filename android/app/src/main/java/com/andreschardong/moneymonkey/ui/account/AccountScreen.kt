package com.andreschardong.moneymonkey.ui.account

import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.andreschardong.moneymonkey.BuildConfig
import com.andreschardong.moneymonkey.auth.Session

@Composable
fun AccountScreen(session: Session.SignedIn, viewModel: AccountViewModel, modifier: Modifier = Modifier) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val activity = LocalActivity.current

    Column(
        modifier = modifier.verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Account", style = MaterialTheme.typography.headlineSmall)
        Text("Signed in as ${session.email}", color = MaterialTheme.colorScheme.onSurfaceVariant)

        HorizontalDivider()
        Text("Passkeys", style = MaterialTheme.typography.titleMedium)
        Text(
            if (session.passkeys == 0) "None yet. A passkey signs you in with your fingerprint or screen lock."
            else "${session.passkeys} on your account. Add one here so this phone signs in with its screen lock.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedTextField(
            value = state.passkeyName,
            onValueChange = viewModel::onPasskeyNameChange,
            label = { Text("Name for the passkey (optional)") },
            placeholder = { Text("Pixel phone") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        Button(
            onClick = { activity?.let(viewModel::addPasskey) },
            enabled = !state.busy && activity != null,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Add a passkey") }
        state.message?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        HorizontalDivider()
        OutlinedButton(onClick = viewModel::signOut, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }

        HorizontalDivider()
        Text("About", style = MaterialTheme.typography.titleMedium)
        Text(
            "App ${BuildConfig.VERSION_NAME}" +
                (state.version?.let { v -> ", server ${v.version}" + (v.commit?.let { " ($it)" } ?: "") } ?: "") +
                "\n${BuildConfig.SERVER_HOST}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
