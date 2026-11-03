import { HoldingDetail } from '../app/core/models';
import { holding, security, transaction } from './fixtures';

/** A complete `HoldingDetail` (one holding, one buy) in CAD; pass the fields a spec cares about as `overrides`. */
export function holdingDetail(overrides: Partial<HoldingDetail> = {}): HoldingDetail {
  return {
    baseCurrency: 'CAD',
    security: security(),
    holding: holding(),
    realizedGain: 0,
    dividends: 0,
    transactions: [transaction()],
    ...overrides,
  };
}
