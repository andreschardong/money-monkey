package com.andreschardong.moneymonkey.data

import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.math.BigDecimal
import java.time.LocalDate

class ApiClientTest {
    private val server = MockWebServer()
    private lateinit var api: ApiClient
    private var unauthorized = 0

    @Before
    fun start() {
        server.start()
        api = ApiClient(OkHttpClient(), server.url("/"))
        api.onUnauthorized = { unauthorized++ }
    }

    @After
    fun stop() = server.close()

    @Test
    fun `amounts keep every digit and dates become LocalDate`() = runTest {
        server.enqueue(
            MockResponse.Builder().body(
                """{"currency":"CAD","totalValue":150322.62,"dayChange":-3432.2914,"dayChangePercent":null,
                   "netContributions":106084.50,"cashValue":6560.93,"pricesAsOf":"2026-10-12",
                   "dayChangeDate":"2026-10-12","portfolios":[],"somethingNew":true}""",
            ).build(),
        )

        val overview = api.overview("CAD")

        assertEquals(BigDecimal("-3432.2914"), overview.dayChange)
        assertEquals(BigDecimal("106084.50"), overview.netContributions)
        assertNull(overview.dayChangePercent)
        assertEquals(LocalDate.of(2026, 10, 12), overview.dayChangeDate)
        assertEquals("/api/overview?currency=CAD", server.takeRequest().target)
    }

    @Test
    fun `a refusal carries the server's sentence`() = runTest {
        server.enqueue(
            MockResponse.Builder().code(403)
                .body("""{"title":"Not invited","status":403,"detail":"Folio is private: only invited email addresses can sign in."}""")
                .build(),
        )

        try {
            api.sendEmailLink("stranger@example.com")
            fail("expected a refusal")
        } catch (e: ApiException) {
            assertEquals(403, e.status)
            assertEquals("Not invited", e.title)
            assertTrue(e.message!!.startsWith("Folio is private"))
        }
        assertEquals("""{"email":"stranger@example.com"}""", server.takeRequest().body?.utf8())
    }

    @Test
    fun `an ended session is reported once`() = runTest {
        server.enqueue(MockResponse.Builder().code(401).build())

        try {
            api.portfolios()
            fail("expected a 401")
        } catch (e: ApiException) {
            assertEquals("Your session has ended. Sign in again.", e.message)
        }
        assertEquals(1, unauthorized)
    }

    @Test
    fun `passkey options are passed through as raw JSON`() = runTest {
        val options = """{"challenge":"abc","rpId":"moneymonkey.example.com","allowCredentials":[]}"""
        server.enqueue(MockResponse.Builder().body(options).build())

        assertEquals(options, api.passkeyRequestOptions())
        assertEquals("POST", server.takeRequest().method)
    }
}
