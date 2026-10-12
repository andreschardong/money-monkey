package com.andreschardong.moneymonkey.ui.overview

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.andreschardong.moneymonkey.ui.formatMoney

// ============================================================================================================
// LESSON 1 starts here: see android/LEARNING.md.
//
// What's below is a placeholder that proves sign-in, the API and the view model work: it shows the net worth
// and nothing else. Your job is the real overview screen: the net worth, "Today" (with its label), the total
// return and net deposits, then the list of portfolios. Keep the function's name and parameters; MoneyMonkeyRoot
// calls it with the view model's state.
// ============================================================================================================

@Composable
fun OverviewScreen(state: OverviewViewModel.UiState, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    when (state) {
        OverviewViewModel.UiState.Loading ->
            Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }

        is OverviewViewModel.UiState.Failed ->
            Column(modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(state.message)
                Button(onClick = onRetry) { Text("Try again") }
            }

        is OverviewViewModel.UiState.Loaded ->
            Column(modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Net worth", style = MaterialTheme.typography.titleMedium)
                Text(
                    formatMoney(state.overview.totalValue, state.overview.currency),
                    style = MaterialTheme.typography.displaySmall,
                )
                Text(
                    "Lesson 1 builds the rest of this screen.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
    }
}
