package com.andreschardong.moneymonkey.data

import kotlinx.serialization.Serializable

// The server's responses, field for field (src/Folio.Api/Endpoints/Contracts.cs on the server side).
// A field with a default may be missing or null in the JSON.

@Serializable
data class Me(
    val signedIn: Boolean,
    val email: String? = null,
    val passkeys: Int = 0,
    val inboxUrl: String? = null,
    val publicUrl: String = "",
    val hideGains: Boolean = false,
)

@Serializable
data class EmailLinkSent(val email: String, val inboxUrl: String? = null)

/** An error the API explains: a short title and a sentence to show. */
@Serializable
data class Problem(val title: String? = null, val status: Int? = null, val detail: String? = null)

@Serializable
data class Version(val version: String, val commit: String? = null, val builtAt: String? = null)

@Serializable
data class Passkey(val id: String, val name: String, val createdAt: String, val backedUp: Boolean = false)

@Serializable
data class MarketStatus(val today: Day, val pricesAsOf: Day? = null)

/** Everything you hold, added up in one currency (GET /api/overview). */
@Serializable
data class Overview(
    val currency: String,
    val totalValue: Decimal,
    val dayChange: Decimal,
    val dayChangePercent: Decimal? = null,
    val totalReturn: Decimal? = null,
    val totalReturnPercent: Decimal? = null,
    val netContributions: Decimal,
    val cashValue: Decimal,
    val pricesAsOf: Day? = null,
    val portfolios: List<OverviewPortfolio> = emptyList(),
    val warnings: List<String> = emptyList(),
    /** The trading session "Today" refers to; another date before the open or at a weekend. */
    val dayChangeDate: Day? = null,
)

@Serializable
data class OverviewPortfolio(
    val id: String,
    val name: String,
    val baseCurrency: String,
    val value: Decimal,
    val valueInDisplay: Decimal,
    val dayChangeInDisplay: Decimal,
    val dayChangePercent: Decimal? = null,
    val totalReturnInDisplay: Decimal? = null,
    val totalReturnPercent: Decimal? = null,
    val holdingsCount: Int,
    val access: String,
    val ownerEmail: String? = null,
)

@Serializable
data class PortfolioSummary(
    val id: String,
    val name: String,
    val baseCurrency: String,
    val description: String? = null,
    val country: String? = null,
    val totalValue: Decimal,
    val holdingsValue: Decimal,
    val cashValue: Decimal,
    val dayChange: Decimal,
    val dayChangePercent: Decimal? = null,
    val totalReturn: Decimal? = null,
    val totalReturnPercent: Decimal? = null,
    val annualizedReturn: Decimal? = null,
    val netContributions: Decimal,
    val holdingsCount: Int,
    val transactionsCount: Int,
    val pricesAsOf: Day? = null,
    val firstTransactionDate: Day? = null,
    val access: String,
    val ownerEmail: String? = null,
    val sharedWith: Int = 0,
    val dayChangeDate: Day? = null,
)

@Serializable
data class PortfolioDetail(
    val summary: PortfolioSummary,
    val costBasis: Decimal,
    val unrealizedGain: Decimal,
    val unrealizedGainPercent: Decimal? = null,
    val realizedGain: Decimal,
    val dividends: Decimal,
    val interest: Decimal,
    val fees: Decimal,
    val taxWithheld: Decimal,
    val holdings: List<Holding> = emptyList(),
    val cash: List<CashBalance> = emptyList(),
    val warnings: List<String> = emptyList(),
)

@Serializable
data class Holding(
    val securityId: String,
    val symbol: String,
    val name: String,
    val exchange: String? = null,
    val assetType: String,
    val currency: String,
    val quantity: Decimal,
    val averageCost: Decimal,
    val costBasis: Decimal,
    val price: Decimal? = null,
    val priceDate: Day? = null,
    val previousClose: Decimal? = null,
    val dayChangePercent: Decimal? = null,
    val marketValue: Decimal,
    val marketValueLocal: Decimal,
    val dayChange: Decimal,
    val unrealizedGain: Decimal,
    val unrealizedGainPercent: Decimal? = null,
    val realizedGain: Decimal,
    val dividends: Decimal,
    val weight: Decimal,
    val fxRate: Decimal,
    val priceMissing: Boolean = false,
)

@Serializable
data class CashBalance(val currency: String, val balance: Decimal, val asOf: Day, val fxRate: Decimal, val value: Decimal)
