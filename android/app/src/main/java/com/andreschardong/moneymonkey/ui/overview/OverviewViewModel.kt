package com.andreschardong.moneymonkey.ui.overview

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.andreschardong.moneymonkey.data.ApiException
import com.andreschardong.moneymonkey.data.Overview
import com.andreschardong.moneymonkey.data.PortfolioRepository
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.IOException
import java.time.LocalDate

/**
 * Loads the overview for the screen. This is the pattern every screen in the app follows; lesson 3 has you
 * write one like it for a single portfolio.
 *
 * - The screen's whole situation is one value, [UiState]. A sealed interface lists every case, so a `when`
 *   over it must handle loading, failure and success; the compiler complains if one is missing.
 * - The state lives in a [MutableStateFlow] that only this class can change; the screen gets the read-only
 *   [StateFlow] and redraws whenever it changes.
 * - Work runs in [viewModelScope], so it stops by itself when the screen goes away for good, and survives
 *   rotating the phone.
 */
class OverviewViewModel(private val repository: PortfolioRepository) : ViewModel() {

    sealed interface UiState {
        data object Loading : UiState

        data class Failed(val message: String) : UiState

        /** [today] is the market's date, to label the day change "Today" or with its date. */
        data class Loaded(val overview: Overview, val today: LocalDate?, val refreshing: Boolean = false) : UiState
    }

    private val _state = MutableStateFlow<UiState>(UiState.Loading)
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        load()
    }

    /** Loads again, keeping the current numbers on screen while it does. */
    fun load(currency: String = "CAD") {
        val current = _state.value
        _state.value = if (current is UiState.Loaded) current.copy(refreshing = true) else UiState.Loading
        viewModelScope.launch {
            _state.value = try {
                // Both requests at once: async starts each, await waits for its answer.
                coroutineScope {
                    val overview = async { repository.overview(currency) }
                    val status = async { runCatching { repository.marketStatus() }.getOrNull() }
                    UiState.Loaded(overview.await(), status.await()?.today)
                }
            } catch (e: ApiException) {
                UiState.Failed(e.message ?: "The overview did not load.")
            } catch (e: IOException) {
                UiState.Failed("Money Monkey can't reach its server. Check the connection and try again.")
            }
        }
    }
}
