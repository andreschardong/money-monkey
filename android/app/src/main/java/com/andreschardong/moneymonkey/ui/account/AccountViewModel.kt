package com.andreschardong.moneymonkey.ui.account

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.andreschardong.moneymonkey.auth.AuthException
import com.andreschardong.moneymonkey.auth.AuthRepository
import com.andreschardong.moneymonkey.data.ApiException
import com.andreschardong.moneymonkey.data.PortfolioRepository
import com.andreschardong.moneymonkey.data.Version
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.IOException

class AccountViewModel(private val auth: AuthRepository, private val portfolios: PortfolioRepository) : ViewModel() {

    data class UiState(
        val passkeyName: String = "",
        val busy: Boolean = false,
        val message: String? = null,
        val error: String? = null,
        val version: Version? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            runCatching { portfolios.version() }.onSuccess { version -> _state.update { it.copy(version = version) } }
        }
    }

    fun onPasskeyNameChange(name: String) = _state.update { it.copy(passkeyName = name) }

    fun addPasskey(activity: Activity) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, message = null) }
            try {
                auth.addPasskey(activity, _state.value.passkeyName)
                _state.update { it.copy(passkeyName = "", message = "Passkey added. Use it to sign in from now on.") }
            } catch (e: AuthException) {
                _state.update { it.copy(error = e.message) }
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.message) }
            } catch (e: IOException) {
                _state.update { it.copy(error = "Money Monkey can't reach its server.") }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }

    fun signOut() {
        viewModelScope.launch { auth.signOut() }
    }
}
