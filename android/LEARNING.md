# Learning path: the screens

The plumbing is done: the project builds, signs in (email link or passkey), keeps the session, talks to the API,
and has a view model that loads the overview. The screens are yours. Each lesson says what to build, which Kotlin
and Compose ideas it needs, and how to check your work. When you finish one, ask Claude to review the diff before
you commit.

Work on a branch per lesson (`git switch -c android/lesson-1`), run the app after every few lines, and use Compose
previews (`@Preview` functions) to see a screen without signing in.

## Lesson 1: the overview

**Goal:** replace the placeholder in `ui/overview/OverviewScreen.kt` with the real overview, like the website's
top section:

- The net worth, large (`MaterialTheme.typography.displaySmall`), with the currency.
- Below it, three facts side by side: the day change (label from `dayLabel(...)`, so "Today" or "Fri, Oct 9"),
  the total return, and net deposits. Gains in `MoneyTheme.colors.gain`, losses in `MoneyTheme.colors.loss`.
- Under the facts, one line per portfolio: name, value, and its day change.

**You'll use:**

- `when (state)` over the sealed `UiState`: one branch per case, and the compiler checks you covered them all.
- Data classes (`Overview`, `OverviewPortfolio`): read-only properties, `copy`, `equals` for free.
- Null safety: `dayChangePercent` and `totalReturn` can be `null` (not enough history). Use `?.let { }` to show
  something only when there is a value, and `?:` for a fallback such as "Record a deposit to track".
- Compose layout: `Column`, `Row`, `Modifier.padding`, `Arrangement.spacedBy`, `Spacer`, `HorizontalDivider`.
- `formatMoney(amount, currency, signed = true)`, `formatPercent(ratio)` and `dayLabel(session, today)` from
  `ui/Format.kt`.

**Steps:**

1. Write a small composable `Fact(label: String, value: @Composable () -> Unit)` for one label-over-value pair.
2. Write `Change(amount: BigDecimal, percent: BigDecimal?, currency: String)` that picks the colour from the
   sign of `amount` and shows the percentage when there is one.
3. Build the `Loaded` branch from those two, then the portfolio lines with a `Column` and `for`.
4. Add a `@Preview` with a made-up `Overview` so you can see it in Android Studio without running the app.

**Check yourself:** the numbers match the website's overview in CAD; a negative day shows a minus sign in red;
before 9:30 a.m. the label shows the last session's date.

## Lesson 2: a scrolling list and navigation

**Goal:** the portfolio lines become a proper list you can scroll and tap.

- Swap the `Column` for a `LazyColumn` (`items(overview.portfolios, key = { it.id }) { ... }`), with the net-worth
  header as its first `item { }`.
- Add a route `@Serializable data class PortfolioRoute(val id: String)` in `MoneyMonkeyRoot.kt`, a
  `composable<PortfolioRoute> { entry -> val route = entry.toRoute<PortfolioRoute>() ... }`, and make each line
  call `navController.navigate(PortfolioRoute(portfolio.id))`. Pass a lambda `onOpen: (String) -> Unit` into
  `OverviewScreen` rather than the nav controller itself.

**You'll use:** lambdas as parameters (your lesson 04), lazy lists, keys, type-safe navigation arguments.

## Lesson 3: one portfolio

**Goal:** a `PortfolioViewModel` and `PortfolioScreen` for `GET /api/portfolios/{id}`: the summary at the top,
then the holdings (symbol, shares, market value, unrealized gain) and the cash balances.

- Copy the shape of `OverviewViewModel`: a sealed `UiState`, a private `MutableStateFlow`, `load()` in
  `viewModelScope`. Take the id as a constructor parameter.
- Create it in the route: `viewModel { PortfolioViewModel(container.portfolios, route.id) }`.

**You'll use:** classes with constructor properties, `suspend` functions and coroutines, `try`/`catch` around
network calls, and the difference between `val` and `var` state.

## Lesson 4: refresh and currency

- Pull to refresh (`PullToRefreshBox`) calling `load()`; the `refreshing` flag keeps the old numbers on screen.
- A CAD / USD / EUR switch (`SingleChoiceSegmentedButtonRow`) that reloads the overview in that currency.

## Lesson 5: a home-screen widget

Net worth and today's move on the home screen with Jetpack Glance. This needs a little more plumbing (scheduled
refresh with WorkManager); Claude sets that up and you write the widget's layout.

## Tests you can add along the way

Unit tests live in `app/src/test`. `FormatTest.kt` shows the style; try one for the colour choice in your
`Change` composable's logic (pull the decision into a plain function, then test that function).
