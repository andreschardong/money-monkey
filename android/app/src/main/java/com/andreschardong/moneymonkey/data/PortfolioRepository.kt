package com.andreschardong.moneymonkey.data

/**
 * Read access to the portfolios. The screens talk to this rather than to [ApiClient], so a later version can add
 * caching (to show the last numbers instantly, or offline) without touching them.
 */
class PortfolioRepository(private val api: ApiClient) {

    /** Everything you hold, in [currency] (CAD, USD or EUR). */
    suspend fun overview(currency: String = "CAD"): Overview = api.overview(currency)

    suspend fun portfolios(): List<PortfolioSummary> = api.portfolios()

    suspend fun portfolio(id: String): PortfolioDetail = api.portfolio(id)

    /** Today's date in the market's time zone, for the "Today" label. */
    suspend fun marketStatus(): MarketStatus = api.marketStatus()

    suspend fun version(): Version = api.version()
}
