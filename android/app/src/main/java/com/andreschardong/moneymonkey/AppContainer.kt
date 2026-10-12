package com.andreschardong.moneymonkey

import android.content.Context
import com.andreschardong.moneymonkey.auth.AuthRepository
import com.andreschardong.moneymonkey.data.ApiClient
import com.andreschardong.moneymonkey.data.PortfolioRepository
import com.andreschardong.moneymonkey.data.PreferencesCookieStorage
import com.andreschardong.moneymonkey.data.SessionCookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * The app's long-lived objects, created once in [MoneyMonkeyApp] and handed to the screens. (A dependency
 * injection library such as Hilt does this for bigger apps; for a handful of objects, plain code is clearer.)
 */
class AppContainer(context: Context) {
    val serverUrl: HttpUrl = "https://${BuildConfig.SERVER_HOST}/".toHttpUrl()

    private val cookies = SessionCookieJar(PreferencesCookieStorage(context), serverUrl)

    private val http = OkHttpClient.Builder()
        .cookieJar(cookies)
        .connectTimeout(15, TimeUnit.SECONDS)
        // The first request after a quiet spell wakes the server, which can take several seconds.
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private val api = ApiClient(http, serverUrl)

    val auth = AuthRepository(api, cookies)
    val portfolios = PortfolioRepository(api)

    init {
        api.onUnauthorized = auth::onUnauthorized
    }
}
