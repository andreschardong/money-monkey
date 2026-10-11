import { inject } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import addIcon from '@material-symbols/svg-400/rounded/add.svg';
import dashboardIcon from '@material-symbols/svg-400/rounded/dashboard.svg';
import accountBalanceWalletIcon from '@material-symbols/svg-400/rounded/account_balance_wallet.svg';
import monitoringIcon from '@material-symbols/svg-400/rounded/monitoring.svg';
import currencyExchangeIcon from '@material-symbols/svg-400/rounded/currency_exchange.svg';
import syncIcon from '@material-symbols/svg-400/rounded/sync.svg';
import lightModeIcon from '@material-symbols/svg-400/rounded/light_mode.svg';
import darkModeIcon from '@material-symbols/svg-400/rounded/dark_mode.svg';
import contrastIcon from '@material-symbols/svg-400/rounded/contrast.svg';
import moreVertIcon from '@material-symbols/svg-400/rounded/more_vert.svg';
import editIcon from '@material-symbols/svg-400/rounded/edit.svg';
import deleteIcon from '@material-symbols/svg-400/rounded/delete.svg';
import closeIcon from '@material-symbols/svg-400/rounded/close.svg';
import checkIcon from '@material-symbols/svg-400/rounded/check.svg';
import infoIcon from '@material-symbols/svg-400/rounded/info.svg';
import warningIcon from '@material-symbols/svg-400/rounded/warning.svg';
import errorIcon from '@material-symbols/svg-400/rounded/error.svg';
import callSplitIcon from '@material-symbols/svg-400/rounded/call_split.svg';
import paymentsIcon from '@material-symbols/svg-400/rounded/payments.svg';
import arrowUpwardIcon from '@material-symbols/svg-400/rounded/arrow_upward.svg';
import arrowDownwardIcon from '@material-symbols/svg-400/rounded/arrow_downward.svg';
import southIcon from '@material-symbols/svg-400/rounded/south.svg';
import northIcon from '@material-symbols/svg-400/rounded/north.svg';
import swapHorizIcon from '@material-symbols/svg-400/rounded/swap_horiz.svg';
import receiptLongIcon from '@material-symbols/svg-400/rounded/receipt_long.svg';
import searchIcon from '@material-symbols/svg-400/rounded/search.svg';
import menuIcon from '@material-symbols/svg-400/rounded/menu.svg';
import chevronRightIcon from '@material-symbols/svg-400/rounded/chevron_right.svg';
import arrowBackIcon from '@material-symbols/svg-400/rounded/arrow_back.svg';
import savingsIcon from '@material-symbols/svg-400/rounded/savings.svg';
import sellIcon from '@material-symbols/svg-400/rounded/sell.svg';
import shoppingCartIcon from '@material-symbols/svg-400/rounded/shopping_cart.svg';
import loginIcon from '@material-symbols/svg-400/rounded/login.svg';
import priceChangeIcon from '@material-symbols/svg-400/rounded/price_change.svg';
import scheduleIcon from '@material-symbols/svg-400/rounded/schedule.svg';
import inboxIcon from '@material-symbols/svg-400/rounded/inbox.svg';
import lightbulbIcon from '@material-symbols/svg-400/rounded/lightbulb.svg';
import visibilityOffIcon from '@material-symbols/svg-400/rounded/visibility_off.svg';
import historyIcon from '@material-symbols/svg-400/rounded/history.svg';
import walletIcon from '@material-symbols/svg-400/rounded/wallet.svg';
import accountBalanceIcon from '@material-symbols/svg-400/rounded/account_balance.svg';
import callMadeIcon from '@material-symbols/svg-400/rounded/call_made.svg';
import callReceivedIcon from '@material-symbols/svg-400/rounded/call_received.svg';
import accountCircleIcon from '@material-symbols/svg-400/rounded/account_circle.svg';
import fingerprintIcon from '@material-symbols/svg-400/rounded/fingerprint.svg';
import logoutIcon from '@material-symbols/svg-400/rounded/logout.svg';
import mailIcon from '@material-symbols/svg-400/rounded/mail.svg';
import keyIcon from '@material-symbols/svg-400/rounded/key.svg';
import openInNewIcon from '@material-symbols/svg-400/rounded/open_in_new.svg';
import shareIcon from '@material-symbols/svg-400/rounded/share.svg';
import groupIcon from '@material-symbols/svg-400/rounded/group.svg';
import personAddIcon from '@material-symbols/svg-400/rounded/person_add.svg';
import uploadFileIcon from '@material-symbols/svg-400/rounded/upload_file.svg';
import downloadIcon from '@material-symbols/svg-400/rounded/download.svg';

// Only the icons listed here are bundled, as inline SVG text.
const ICONS: Record<string, string> = {
  add: addIcon,
  dashboard: dashboardIcon,
  account_balance_wallet: accountBalanceWalletIcon,
  monitoring: monitoringIcon,
  currency_exchange: currencyExchangeIcon,
  sync: syncIcon,
  light_mode: lightModeIcon,
  dark_mode: darkModeIcon,
  contrast: contrastIcon,
  more_vert: moreVertIcon,
  edit: editIcon,
  delete: deleteIcon,
  close: closeIcon,
  check: checkIcon,
  info: infoIcon,
  warning: warningIcon,
  error: errorIcon,
  call_split: callSplitIcon,
  payments: paymentsIcon,
  arrow_upward: arrowUpwardIcon,
  arrow_downward: arrowDownwardIcon,
  south: southIcon,
  north: northIcon,
  swap_horiz: swapHorizIcon,
  receipt_long: receiptLongIcon,
  search: searchIcon,
  menu: menuIcon,
  chevron_right: chevronRightIcon,
  arrow_back: arrowBackIcon,
  savings: savingsIcon,
  sell: sellIcon,
  shopping_cart: shoppingCartIcon,
  login: loginIcon,
  price_change: priceChangeIcon,
  schedule: scheduleIcon,
  inbox: inboxIcon,
  lightbulb: lightbulbIcon,
  visibility_off: visibilityOffIcon,
  history: historyIcon,
  wallet: walletIcon,
  account_balance: accountBalanceIcon,
  call_made: callMadeIcon,
  call_received: callReceivedIcon,
  account_circle: accountCircleIcon,
  fingerprint: fingerprintIcon,
  logout: logoutIcon,
  mail: mailIcon,
  key: keyIcon,
  open_in_new: openInNewIcon,
  share: shareIcon,
  group: groupIcon,
  person_add: personAddIcon,
  upload_file: uploadFileIcon,
  download: downloadIcon,
};

export function registerIcons(): void {
  const registry = inject(MatIconRegistry);
  const sanitizer = inject(DomSanitizer);
  for (const [name, svg] of Object.entries(ICONS)) {
    registry.addSvgIconLiteral(name, sanitizer.bypassSecurityTrustHtml(svg));
  }
}
