package com.andreschardong.moneymonkey.data

import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionCookieJarTest {
    private val site = "https://moneymonkey.example.com/".toHttpUrl()
    // Max-Age is counted from the real clock when a cookie is parsed, so the fake clock starts there too.
    private var time = System.currentTimeMillis()

    private class MemoryStorage : CookieStorage {
        var saved: Set<String> = emptySet()
        override fun load() = saved
        override fun save(cookies: Set<String>) {
            saved = cookies
        }
    }

    private fun cookie(header: String) = Cookie.parse(site, header)!!

    @Test
    fun `the session cookie survives a restart, a ceremony cookie does not`() {
        val storage = MemoryStorage()
        val jar = SessionCookieJar(storage, site) { time }
        jar.saveFromResponse(
            site,
            listOf(
                cookie("folio.session=abc; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=Strict"),
                cookie("Identity.Passkey=xyz; Path=/; Secure; HttpOnly"),
            ),
        )
        assertEquals(2, jar.loadForRequest(site.resolve("api/portfolios")!!).size)

        val restarted = SessionCookieJar(storage, site) { time }
        assertEquals(listOf("folio.session"), restarted.loadForRequest(site.resolve("api/portfolios")!!).map { it.name })
    }

    @Test
    fun `a cookie the server expires is removed`() {
        val storage = MemoryStorage()
        val jar = SessionCookieJar(storage, site) { time }
        jar.saveFromResponse(site, listOf(cookie("folio.session=abc; Max-Age=2592000; Path=/")))
        jar.saveFromResponse(site, listOf(cookie("folio.session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/")))

        assertTrue(jar.loadForRequest(site).isEmpty())
        assertTrue(storage.saved.isEmpty())
    }

    @Test
    fun `cookies are dropped once they expire and on sign-out`() {
        val storage = MemoryStorage()
        val jar = SessionCookieJar(storage, site) { time }
        jar.saveFromResponse(site, listOf(cookie("folio.session=abc; Max-Age=60; Path=/")))
        time += 61_000
        assertTrue(jar.loadForRequest(site).isEmpty())

        jar.saveFromResponse(site, listOf(cookie("folio.session=def; Max-Age=2592000; Path=/")))
        jar.clear()
        assertTrue(jar.loadForRequest(site).isEmpty())
        assertTrue(storage.saved.isEmpty())
    }
}
