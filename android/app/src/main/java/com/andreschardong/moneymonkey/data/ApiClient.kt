package com.andreschardong.moneymonkey.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody

/** A request the server refused, with the sentence it gave for people to read. */
class ApiException(val status: Int, val title: String?, message: String) : Exception(message)

/**
 * The Money Monkey API. Every call is a suspend function that runs on the IO dispatcher, returns the decoded
 * response, or throws [ApiException] (the server answered with an error) or an IOException (no connection).
 * The session lives in a cookie, kept by the [okhttp3.CookieJar] of [http].
 */
class ApiClient(private val http: OkHttpClient, private val baseUrl: HttpUrl) {

    /** Called when the server says the session is gone (401), so the app can show the sign-in screen. */
    var onUnauthorized: () -> Unit = {}

    // ---- signing in -------------------------------------------------------------------------------

    suspend fun me(): Me = get("api/auth/me")

    suspend fun sendEmailLink(email: String): EmailLinkSent =
        post("api/auth/email-link", buildJsonObject { put("email", email) })

    suspend fun verifyEmailLink(token: String, confirmSwitch: Boolean): Me =
        post("api/auth/email-link/verify", buildJsonObject { put("token", token); put("confirmSwitch", confirmSwitch) })

    /** WebAuthn request options as JSON, handed to Credential Manager as they are. */
    suspend fun passkeyRequestOptions(): String = send(request("api/auth/passkey/options", EMPTY))

    suspend fun passkeySignIn(credentialJson: String): Me =
        post("api/auth/passkey", buildJsonObject { put("credential", credentialJson) })

    /** WebAuthn creation options as JSON, for adding a passkey to the signed-in account. */
    suspend fun passkeyCreationOptions(): String = send(request("api/account/passkeys/options", EMPTY))

    suspend fun addPasskey(credentialJson: String, name: String?): List<Passkey> =
        post("api/account/passkeys", buildJsonObject { put("credential", credentialJson); put("name", name) })

    suspend fun passkeys(): List<Passkey> = get("api/account/passkeys")

    suspend fun signOut() {
        send(request("api/auth/sign-out", EMPTY))
    }

    // ---- portfolios -------------------------------------------------------------------------------

    suspend fun overview(currency: String): Overview = get("api/overview?currency=$currency")

    suspend fun portfolios(): List<PortfolioSummary> = get("api/portfolios")

    suspend fun portfolio(id: String): PortfolioDetail = get("api/portfolios/$id")

    suspend fun marketStatus(): MarketStatus = get("api/market/status")

    suspend fun version(): Version = get("api/version")

    // ---- plumbing ---------------------------------------------------------------------------------

    private suspend inline fun <reified T> get(path: String): T =
        ApiJson.decodeFromString(send(request(path, body = null)))

    private suspend inline fun <reified T> post(path: String, json: JsonObject): T =
        ApiJson.decodeFromString(send(request(path, json.toString().toRequestBody(JSON))))

    private fun request(path: String, body: RequestBody?): Request {
        val url = baseUrl.resolve(path) ?: error("Bad API path: $path")
        val builder = Request.Builder().url(url).header("Accept", "application/json")
        return if (body == null) builder.get().build() else builder.post(body).build()
    }

    private suspend fun send(request: Request): String = withContext(Dispatchers.IO) {
        http.newCall(request).execute().use { response ->
            val text = response.body.string()
            if (!response.isSuccessful) {
                if (response.code == 401) onUnauthorized()
                throw problemOf(response.code, text)
            }
            text
        }
    }

    private fun problemOf(status: Int, body: String): ApiException {
        val problem = runCatching { ApiJson.decodeFromString<Problem>(body) }.getOrNull()
        val message = problem?.detail
            ?: problem?.title
            ?: when (status) {
                401 -> "Your session has ended. Sign in again."
                429 -> "Too many attempts. Wait a few minutes and try again."
                else -> "The server answered $status."
            }
        return ApiException(status, problem?.title, message)
    }

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
        val EMPTY = ByteArray(0).toRequestBody(null)
    }
}
