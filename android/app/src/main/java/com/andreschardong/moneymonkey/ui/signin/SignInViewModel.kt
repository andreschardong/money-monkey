package com.andreschardong.moneymonkey.ui.signin

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.andreschardong.moneymonkey.auth.AuthException
import com.andreschardong.moneymonkey.auth.AuthRepository
import com.andreschardong.moneymonkey.auth.LinkResult
import com.andreschardong.moneymonkey.data.ApiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.IOException

class SignInViewModel(private val auth: AuthRepository) : ViewModel() {

    data class UiState(
        val email: String = "",
        val busy: Boolean = false,
        /** The address a link was just sent to. */
        val sentTo: String? = null,
        val error: String? = null,
        /** A link for another account was opened while signed in; the question to ask before switching. */
        val switchPrompt: String? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var switchToken: String? = null

    fun onEmailChange(email: String) = _state.update { it.copy(email = email, error = null) }

    fun sendLink() = launchAction {
        val sent = auth.sendEmailLink(_state.value.email)
        _state.update { it.copy(sentTo = sent.email) }
    }

    fun signInWithPasskey(activity: Activity) = launchAction { auth.signInWithPasskey(activity) }

    /** A sign-in link opened the app. [onDone] runs whatever the outcome. */
    fun openLink(token: String, onDone: () -> Unit = {}) = launchAction(onDone) {
        when (val result = auth.openEmailLink(token)) {
            LinkResult.SignedIn -> _state.update { UiState() }
            is LinkResult.OtherAccount -> {
                switchToken = token
                _state.update { it.copy(switchPrompt = result.message) }
            }
        }
    }

    fun confirmSwitch() {
        val token = switchToken ?: return
        switchToken = null
        _state.update { it.copy(switchPrompt = null) }
        launchAction { auth.openEmailLink(token, confirmSwitch = true) }
    }

    fun cancelSwitch() {
        switchToken = null
        _state.update { it.copy(switchPrompt = null) }
    }

    fun startOver() = _state.update { it.copy(sentTo = null, error = null) }

    /** Runs [action] with the busy flag on, turning failures into a sentence to show. */
    private fun launchAction(onDone: () -> Unit = {}, action: suspend () -> Unit) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            try {
                action()
            } catch (e: AuthException) {
                _state.update { it.copy(error = e.message) }
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.message) }
            } catch (e: IOException) {
                _state.update { it.copy(error = "Money Monkey can't reach its server. Check the connection and try again.") }
            } finally {
                _state.update { it.copy(busy = false) }
                onDone()
            }
        }
    }
}
