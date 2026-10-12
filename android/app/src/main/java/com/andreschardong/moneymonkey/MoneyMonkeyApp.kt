package com.andreschardong.moneymonkey

import android.app.Application

class MoneyMonkeyApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
