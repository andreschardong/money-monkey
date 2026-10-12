package com.andreschardong.moneymonkey.data

import android.content.Context
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/** Where the cookies are kept between app starts. */
interface CookieStorage {
    fun load(): Set<String>
    fun save(cookies: Set<String>)
}

/** App-private storage; the manifest turns backup off, so the session never leaves the device. */
class PreferencesCookieStorage(context: Context) : CookieStorage {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)

    override fun load(): Set<String> = prefs.getStringSet(KEY, emptySet()).orEmpty().toSet()

    override fun save(cookies: Set<String>) {
        prefs.edit().putStringSet(KEY, cookies).apply()
    }

    private companion object {
        const val KEY = "cookies"
    }
}

/**
 * Keeps the server's cookies like a browser would: the session cookie survives restarts (it lasts 30 days and
 * renews itself while in use); short-lived ones such as a passkey ceremony's state stay in memory only.
 */
class SessionCookieJar(
    private val storage: CookieStorage,
    private val baseUrl: HttpUrl,
    private val now: () -> Long = System::currentTimeMillis,
) : CookieJar {
    private val cookies = mutableMapOf<String, Cookie>()

    init {
        storage.load().mapNotNull { Cookie.parse(baseUrl, it) }.forEach { cookies[key(it)] = it }
    }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        for (cookie in cookies) {
            // A cookie set to expire in the past is how a server deletes it (signing out does this).
            if (cookie.expiresAt <= now()) this.cookies.remove(key(cookie)) else this.cookies[key(cookie)] = cookie
        }
        persist()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val time = now()
        if (cookies.values.removeAll { it.expiresAt <= time }) persist()
        return cookies.values.filter { it.matches(url) }
    }

    @Synchronized
    fun clear() {
        cookies.clear()
        persist()
    }

    private fun persist() = storage.save(cookies.values.filter { it.persistent }.map { it.toString() }.toSet())

    private fun key(cookie: Cookie) = "${cookie.name}|${cookie.domain}|${cookie.path}"
}
