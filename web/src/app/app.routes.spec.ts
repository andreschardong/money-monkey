import { Route } from '@angular/router';
import { routes } from './app.routes';
import { authGuard, signedOutGuard } from './core/auth';
import { AccountPage } from './pages/account/account.page';
import { AssetsPage } from './pages/assets/assets.page';
import { EmailLinkPage } from './pages/email-link/email-link.page';
import { HoldingPage } from './pages/holding/holding.page';
import { MarketPage } from './pages/market/market.page';
import { OverviewPage } from './pages/overview/overview.page';
import { PortfolioPage } from './pages/portfolio/portfolio.page';
import { QuotesPage } from './pages/quotes/quotes.page';
import { SignInPage } from './pages/sign-in/sign-in.page';

const top = (path: string): Route => routes.find((route) => route.path === path)!;
const signedInChildren = (): Route[] => top('').children!;
const child = (path: string): Route => signedInChildren().find((route) => route.path === path)!;

describe('routes', () => {
  describe('pages for strangers', () => {
    it('sign-in is titled, guarded so that signed-in people skip it, and loads the sign-in page', async () => {
      const route = top('sign-in');
      expect(route.title).toBe('Sign in | Money Monkey');
      expect(route.canActivate).toEqual([signedOutGuard]);
      expect(await (route.loadComponent as () => Promise<unknown>)()).toBe(SignInPage);
    });

    it('the email link page needs no guard, because it is how a stranger gets in', async () => {
      const route = top('email-link');
      expect(route.title).toBe('Signing in | Money Monkey');
      expect(route.canActivate).toBeUndefined();
      expect(await (route.loadComponent as () => Promise<unknown>)()).toBe(EmailLinkPage);
    });
  });

  describe('pages for signed-in people', () => {
    it('are all behind the auth guard, both to enter and to move between them', () => {
      const parent = top('');
      expect(parent.canActivate).toEqual([authGuard]);
      expect(parent.canActivateChild).toEqual([authGuard]);
    });

    it.each([
      ['', 'Overview | Money Monkey', OverviewPage],
      ['assets', 'All assets | Money Monkey', AssetsPage],
      ['quotes', 'Quotes | Money Monkey', QuotesPage],
      ['portfolios/:id', 'Portfolio | Money Monkey', PortfolioPage],
      ['portfolios/:id/holdings/:securityId', 'Holding | Money Monkey', HoldingPage],
      ['market', 'Prices and rates | Money Monkey', MarketPage],
      ['account', 'Account | Money Monkey', AccountPage],
    ])('"%s" is titled "%s" and loads its page', async (path, title, page) => {
      const route = child(path);
      expect(route.title).toBe(title);
      expect(await (route.loadComponent as () => Promise<unknown>)()).toBe(page);
    });

    it('the overview matches the empty path only, so it does not swallow the other pages', () => {
      expect(child('').pathMatch).toBe('full');
    });

    it('has no other pages than the ones listed', () => {
      expect(signedInChildren().map((route) => route.path)).toEqual([
        '',
        'assets',
        'quotes',
        'portfolios/:id',
        'portfolios/:id/holdings/:securityId',
        'market',
        'account',
      ]);
    });
  });

  it('sends any unknown address to the overview', () => {
    expect(routes.at(-1)).toEqual({ path: '**', redirectTo: '' });
  });
});
