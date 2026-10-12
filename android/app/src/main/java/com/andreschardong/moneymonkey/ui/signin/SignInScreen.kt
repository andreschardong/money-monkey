package com.andreschardong.moneymonkey.ui.signin

import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun SignInScreen(viewModel: SignInViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val activity = LocalActivity.current

    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .safeDrawingPadding()
                .imePadding()
                .padding(24.dp)
                .widthIn(max = 480.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Money Monkey", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text("Sign in", style = MaterialTheme.typography.titleLarge)
            if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())

            val sentTo = state.sentTo
            if (sentTo != null) {
                Text("Check your email", style = MaterialTheme.typography.titleMedium)
                Text(
                    "A sign-in link is on its way to $sentTo. Open it on this phone: it opens Money Monkey and signs " +
                        "you in. The link works once, for 15 minutes.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = viewModel::startOver) { Text("Use another address") }
            } else {
                Button(
                    onClick = { activity?.let(viewModel::signInWithPasskey) },
                    enabled = !state.busy && activity != null,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Sign in with a passkey") }

                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    HorizontalDivider(modifier = Modifier.weight(1f))
                    Text("or", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    HorizontalDivider(modifier = Modifier.weight(1f))
                }

                OutlinedTextField(
                    value = state.email,
                    onValueChange = viewModel::onEmailChange,
                    label = { Text("Email") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { viewModel.sendLink() }),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedButton(
                    onClick = viewModel::sendLink,
                    enabled = !state.busy && state.email.contains('@'),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Email me a sign-in link") }

                Text(
                    "Money Monkey is private: only invited addresses can sign in. After the first link, add a passkey " +
                        "on the Account screen and use it from then on.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}
