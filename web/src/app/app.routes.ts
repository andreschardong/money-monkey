import { Routes } from '@angular/router';
import { authGuard, signedOutGuard } from './core/auth';

export const routes: Routes = [
  {
    path: 'sign-in',
    title: 'Sign in | Money Monkey',
    canActivate: [signedOutGuard],
    loadComponent: () => import('./auth/sign-in.page').then(m => m.SignInPage),
  },
  {
    path: 'email-link',
    title: 'Signing in | Money Monkey',
    loadComponent: () => import('./auth/email-link.page').then(m => m.EmailLinkPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Overview | Money Monkey',
        loadComponent: () => import('./overview/overview.page').then(m => m.OverviewPage),
      },
      {
        path: 'assets',
        title: 'All assets | Money Monkey',
        loadComponent: () => import('./assets/assets.page').then(m => m.AssetsPage),
      },
      {
        path: 'quotes',
        title: 'Quotes | Money Monkey',
        loadComponent: () => import('./quotes/quotes.page').then(m => m.QuotesPage),
      },
      {
        path: 'portfolios/:id',
        title: 'Portfolio | Money Monkey',
        loadComponent: () => import('./portfolio/portfolio.page').then(m => m.PortfolioPage),
      },
      {
        path: 'portfolios/:id/holdings/:securityId',
        title: 'Holding | Money Monkey',
        loadComponent: () => import('./holding/holding.page').then(m => m.HoldingPage),
      },
      {
        path: 'market',
        title: 'Prices and rates | Money Monkey',
        loadComponent: () => import('./market/market.page').then(m => m.MarketPage),
      },
      {
        path: 'account',
        title: 'Account | Money Monkey',
        loadComponent: () => import('./account/account.page').then(m => m.AccountPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
