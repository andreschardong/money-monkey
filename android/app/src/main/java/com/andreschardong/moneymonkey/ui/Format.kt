package com.andreschardong.moneymonkey.ui

import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Currency
import java.util.Locale

// Numbers and dates the way the website shows them, in Canadian English.

private val locale: Locale = Locale.CANADA
private val sessionDate: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE, MMM d", locale)

/**
 * "$1,234.56", "US$1,234.56", "€1,234.56". With [signed], gains get a "+"; losses always get a real minus sign.
 */
fun formatMoney(amount: BigDecimal, currency: String, signed: Boolean = false): String {
    val format = NumberFormat.getCurrencyInstance(locale).apply {
        this.currency = Currency.getInstance(currency)
        minimumFractionDigits = 2
        maximumFractionDigits = 2
    }
    return sign(amount, signed) + format.format(amount.abs())
}

/** A ratio as a percentage: 0.0039 becomes "+0.39%". */
fun formatPercent(ratio: BigDecimal, signed: Boolean = true): String {
    val percent = ratio.movePointRight(2).setScale(2, RoundingMode.HALF_UP)
    return sign(percent, signed) + String.format(locale, "%,.2f%%", percent.abs())
}

/** "Today" when the day change is from today's session, otherwise its date: "Fri, Oct 9". */
fun dayLabel(session: LocalDate?, today: LocalDate?): String =
    if (session == null || today == null || session == today) "Today" else session.format(sessionDate)

private fun sign(value: BigDecimal, signed: Boolean): String = when {
    value.signum() < 0 -> "−"
    signed && value.signum() > 0 -> "+"
    else -> ""
}
