package com.andreschardong.moneymonkey.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import java.math.BigDecimal
import java.time.LocalDate

class FormatTest {
    @Test
    fun `money looks like the website's`() {
        assertEquals("$150,322.62", formatMoney(BigDecimal("150322.62"), "CAD"))
        assertEquals("US$1,234.50", formatMoney(BigDecimal("1234.5"), "USD"))
        assertEquals("+$494.62", formatMoney(BigDecimal("494.62"), "CAD", signed = true))
        assertEquals("−$3,432.29", formatMoney(BigDecimal("-3432.2914"), "CAD", signed = true))
        assertEquals("$0.00", formatMoney(BigDecimal.ZERO, "CAD", signed = true))
    }

    @Test
    fun `percentages come from ratios`() {
        assertEquals("+0.33%", formatPercent(BigDecimal("0.0033")))
        assertEquals("−1.03%", formatPercent(BigDecimal("-0.0103")))
        assertEquals("+210.36%", formatPercent(BigDecimal("2.10356")))
    }

    @Test
    fun `the day change is labelled Today or with its session's date`() {
        val monday = LocalDate.of(2026, 10, 12)
        assertEquals("Today", dayLabel(monday, monday))
        assertEquals("Today", dayLabel(null, monday))
        assertEquals("Fri, Oct 9", dayLabel(LocalDate.of(2026, 10, 9), monday))
    }
}
