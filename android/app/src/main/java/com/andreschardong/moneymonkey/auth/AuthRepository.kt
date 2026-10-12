package com.andreschardong.moneymonkey.auth

import android.app.Activity
import androidx.credentials.CreateCredentialResponse
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.andreschardong.moneymonkey.data.ApiClient
import com.andreschardong.moneymonkey.data.ApiException
import com.andreschardong.moneymonkey.data.EmailLinkSent
import com.andreschardong.moneymonkey.data.Me
import com.andreschardong.moneymonkey.data.Passkey
import com.andreschardong.moneymonkey.data.SessionCookieJar
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Who is signed in, as far as the app knows. */
sealed interface Session {
    /** Not asked the server yet (app start). */
    data object Unknown : Session
    data object SignedOut : Session
    data class SignedIn(val email: String, val passkeys: Int) : Session
}

/** The result of opening a sign-in link. */
sealed interface LinkResult {
    data object SignedIn : LinkResult

    /** Another account is signed in here; opening the link again with confirmation switches accounts. */
    data class OtherAccount(val message: String) : LinkResult
}

/** A problem a person can act on, such as a cancelled passkey prompt; [message] is ready to show. */
class AuthException(message: String) : Exception(message)

/**
 * Signing in, the same two ways as the website: a one-time link sent by email, or a passkey. Passkeys go through
 * Android's Credential Manager, which offers the ones saved in Google Password Manager (or another provider) for
 * the server's domain; the server trusts this app because its /.well-known/assetlinks.json names it.
 */
class AuthRepository(private val api: ApiClient, private val cookies: SessionCookieJar) {
    private val _session = MutableStateFlow<Session>(Session.Unknown)
    val session: StateFlow<Session> = _session.asStateFlow()

    /** Asks the server who this session belongs to. Throws when the server can't be reached. */
    suspend fun refresh() {
        _session.value = api.me().toSession()
    }

    suspend fun sendEmailLink(email: String): EmailLinkSent = api.sendEmailLink(email.trim())

    suspend fun openEmailLink(token: String, confirmSwitch: Boolean = false): LinkResult =
        try {
            _session.value = api.verifyEmailLink(token, confirmSwitch).toSession()
            LinkResult.SignedIn
        } catch (e: ApiException) {
            if (e.status == 409) LinkResult.OtherAccount(e.message ?: "This link belongs to a different account.") else throw e
        }

    /** Shows Android's passkey prompt, then signs in with the passkey chosen. */
    suspend fun signInWithPasskey(activity: Activity) {
        val options = api.passkeyRequestOptions()
        val credential = try {
            CredentialManager.create(activity)
                .getCredential(activity, GetCredentialRequest(listOf(GetPublicKeyCredentialOption(options))))
                .credential
        } catch (e: GetCredentialCancellationException) {
            throw AuthException("No passkey was used. Try again, or email yourself a sign-in link.")
        } catch (e: NoCredentialException) {
            throw AuthException("This phone has no passkey for Money Monkey yet. Sign in with an email link, then add one.")
        } catch (e: GetCredentialException) {
            throw AuthException("The passkey step failed: ${e.errorMessage ?: e.type}")
        }

        val passkey = credential as? PublicKeyCredential ?: throw AuthException("That wasn't a passkey.")
        _session.value = api.passkeySignIn(passkey.authenticationResponseJson).toSession()
    }

    /** Creates a passkey for the signed-in account and saves it with the phone's passkey provider. */
    suspend fun addPasskey(activity: Activity, name: String?): List<Passkey> {
        val options = api.passkeyCreationOptions()
        val response: CreateCredentialResponse = try {
            CredentialManager.create(activity).createCredential(activity, CreatePublicKeyCredentialRequest(options))
        } catch (e: CreateCredentialCancellationException) {
            throw AuthException("The passkey was not created.")
        } catch (e: CreateCredentialException) {
            throw AuthException("The passkey step failed: ${e.errorMessage ?: e.type}")
        }

        val created = response as? CreatePublicKeyCredentialResponse ?: throw AuthException("That wasn't a passkey.")
        val passkeys = api.addPasskey(created.registrationResponseJson, name?.trim()?.ifEmpty { null })
        refresh()
        return passkeys
    }

    suspend fun signOut() {
        runCatching { api.signOut() }
        cookies.clear()
        _session.value = Session.SignedOut
    }

    /** The server rejected the session (expired, signed out elsewhere, or no longer invited). */
    fun onUnauthorized() {
        cookies.clear()
        _session.value = Session.SignedOut
    }

    private fun Me.toSession(): Session =
        if (signedIn && email != null) Session.SignedIn(email, passkeys) else Session.SignedOut
}
