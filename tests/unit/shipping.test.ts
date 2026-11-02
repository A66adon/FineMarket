import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  OptimizerPolicy,
  SellerInfo,
  ShippingMethod,
} from '../../src/shared/types';
import {
  estimateBasket,
  estimateWeightG,
  letterCardCapacity,
  parseShippingMethods,
  selectShippingMethod,
  trackingReasons,
  trusteeFeeCents,
  type BasketEstimate,
} from '../../src/shared/shipping';
import { DEFAULT_POLICY } from '../../src/shared/constants';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'tests/fixtures', name), 'utf8'),
  ) as unknown;
}

function policy(overrides: Partial<OptimizerPolicy> = {}): OptimizerPolicy {
  return { ...DEFAULT_POLICY, ...overrides };
}

const SELLER: SellerInfo = {
  id: 'seller-1',
  name: 'Seller 1',
  countryId: 7,
  minOrderValueCents: 0,
  requiresTracking: false,
  etaDays: 5,
};

function basket(
  itemsValueCents: number,
  cardCount: number,
  seller: SellerInfo = SELLER,
  currentPolicy: OptimizerPolicy = policy(),
): BasketEstimate {
  const reasons = trackingReasons(
    itemsValueCents,
    seller,
    currentPolicy,
  );
  return {
    itemsValueCents,
    cardCount,
    estimatedWeightG: estimateWeightG(cardCount, currentPolicy),
    trackingRequired: reasons.length > 0,
    trackingReasons: reasons,
  };
}

const deDe = parseShippingMethods(fixture('shipping-de-de.json'));
const deGb = parseShippingMethods(fixture('shipping-de-gb.json'));
const gbDe = parseShippingMethods(fixture('shipping-gb-de.json'));
const frDe = parseShippingMethods(fixture('shipping-fr-de.json'));
const deJp = parseShippingMethods(
  fixture('shipping-de-jp-virtual-only.json'),
);

describe('parseShippingMethods', () => {
  it('preserves every tier of the DE->DE table', () => {
    expect(deDe).toHaveLength(21);
    expect(new Set(deDe.map((method) => method.methodKey)).size).toBe(21);
  });

  it('parses EUR prices and max values without parseFloat mistakes', () => {
    const methods = parseShippingMethods([
      {
        name: 'Big',
        isTracked: true,
        maxValue: '150.000,00 €',
        maxWeight: 500,
        stampPrice: '1.000,00 €',
        price: '1.234,56 €',
        isLetter: false,
        isVirtual: false,
      },
    ]);

    expect(methods).toHaveLength(1);
    expect(methods[0]?.maxValueCents).toBe(15_000_000);
    expect(methods[0]?.priceCents).toBe(123_456);
    expect(methods[0]?.stampPriceCents).toBe(100_000);
    expect(methods[0]?.methodKey).toBe(
      'Big|true|15000000|500|123456|false|false',
    );
  });

  it('keeps non-EUR stamp prices as raw text with null cents', () => {
    const letter = gbDe.find((method) => method.name === 'Int. Standard Letter');
    expect(letter).toBeDefined();
    expect(letter?.stampPriceRaw).toBe('£3.60');
    expect(letter?.stampPriceCents).toBeNull();
    expect(letter?.priceCents).toBe(497);
  });

  it('ignores invalid entries instead of rejecting the whole table', () => {
    const methods = parseShippingMethods([
      null,
      { name: 'bad price', isTracked: false, maxValue: '25,00 €', maxWeight: 20, stampPrice: '1,00 €', price: 'nope', isLetter: true, isVirtual: false },
      { name: 'missing tracked', maxValue: '25,00 €', maxWeight: 20, stampPrice: '1,00 €', price: '1,00 €', isLetter: true, isVirtual: false },
      { name: 'good', isTracked: false, maxValue: '25,00 €', maxWeight: 20, stampPrice: '0,95 €', price: '1,25 €', isLetter: true, isVirtual: false },
    ]);

    expect(methods.map((method) => method.name)).toEqual(['good']);
  });

  it('returns an empty array for a non-array payload', () => {
    expect(parseShippingMethods({ error: 'bad country' })).toEqual([]);
  });
});

describe('weight and letter capacity', () => {
  it('uses ceil for card weight and adds extra packaging', () => {
    expect(estimateWeightG(5, policy())).toBe(13); // ceil(12.5)
    expect(
      estimateWeightG(
        5,
        policy({ gramsPerCard: 2.5, weightSafetyFactor: 1.05 }),
      ),
    ).toBe(14); // ceil(13.125)
    expect(
      estimateWeightG(5, policy({ extraPackagingG: 20 })),
    ).toBe(33);
  });

  it('applies conservative and published letter caps', () => {
    const base: ShippingMethod = {
      methodKey: 'letter',
      name: 'Letter',
      isTracked: false,
      maxValueCents: 2500,
      maxWeightG: 500,
      stampPriceRaw: '',
      stampPriceCents: null,
      priceCents: 200,
      isLetter: true,
      isVirtual: false,
    };

    expect(letterCardCapacity(base, policy())).toBe(40);
    expect(
      letterCardCapacity(
        base,
        policy({ letterCapacityMode: 'published' }),
      ),
    ).toBe(200);
    expect(
      letterCardCapacity(base, policy({ letterCapacityMode: 'weight' })),
    ).toBe(200);

    expect(
      letterCardCapacity(
        { ...base, maxWeightG: 20 },
        policy({ letterCapacityMode: 'weight' }),
      ),
    ).toBe(8);
    expect(
      letterCardCapacity(
        { ...base, maxWeightG: 50 },
        policy({ letterCapacityMode: 'weight' }),
      ),
    ).toBe(20);
    expect(
      letterCardCapacity(
        { ...base, maxWeightG: 100 },
        policy({ letterCapacityMode: 'weight' }),
      ),
    ).toBe(40);

    expect(
      letterCardCapacity(
        { ...base, isLetter: false, maxWeightG: 20 },
        policy(),
      ),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('tracking and Trustee fees', () => {
  it('requires tracking strictly above the threshold', () => {
    expect(trackingReasons(2500, SELLER, policy())).toEqual([]);
    expect(trackingReasons(2501, SELLER, policy())).toEqual([
      'value_over_threshold',
    ]);
  });

  it('adds seller and user tracking reasons', () => {
    expect(
      trackingReasons(
        100,
        { ...SELLER, requiresTracking: true },
        policy({ alwaysTrack: true }),
      ),
    ).toEqual(['seller_requires_tracking', 'user_always_track']);
  });

  it('charges Trustee only on tracked methods and rounds up', () => {
    const tracked: ShippingMethod = {
      methodKey: 'tracked',
      name: 'Tracked',
      isTracked: true,
      maxValueCents: 10000,
      maxWeightG: 2000,
      stampPriceRaw: '',
      stampPriceCents: null,
      priceCents: 400,
      isLetter: false,
      isVirtual: false,
    };
    const untracked: ShippingMethod = { ...tracked, isTracked: false };

    expect(trusteeFeeCents(2501, tracked, policy())).toBe(26);
    expect(
      trusteeFeeCents(2501, tracked, policy({ trusteeRateBps: 50 })),
    ).toBe(13);
    expect(trusteeFeeCents(10000, tracked, policy())).toBe(100);
    expect(trusteeFeeCents(0, tracked, policy())).toBe(0);
    expect(trusteeFeeCents(10000, untracked, policy())).toBe(0);
  });
});

describe('selectShippingMethod on real fixtures', () => {
  it('selects the cheapest viable DE->DE method for 4 cards / 20 EUR', () => {
    const selected = selectShippingMethod(
      deDe,
      basket(2000, 4),
      policy(),
    );
    expect(selected?.name).toBe('Standardbrief');
    expect(selected?.priceCents).toBe(125);
    expect(selected?.isTracked).toBe(false);
  });

  it('respects the 50 g and 500 g letter card caps', () => {
    expect(
      selectShippingMethod(deDe, basket(2000, 5), policy())?.name,
    ).toBe('Kompaktbrief');
    expect(
      selectShippingMethod(deDe, basket(2000, 20), policy())?.name,
    ).toBe('Grossbrief');
    expect(
      selectShippingMethod(
        deDe,
        basket(2000, 120),
        policy(),
      )?.name,
    ).toBe('DHL Päckchen S');
  });

  it('switches to tracking above 25 EUR and honours maxValue boundaries', () => {
    const justBelow = selectShippingMethod(
      deDe,
      basket(2500, 1),
      policy(),
    );
    expect(justBelow?.name).toBe('Standardbrief');
    expect(justBelow?.isTracked).toBe(false);

    const justOver = selectShippingMethod(
      deDe,
      basket(2501, 1),
      policy(),
    );
    expect(justOver?.name).toBe('Kompaktbrief + Einschreiben EINWURF');
    expect(justOver?.priceCents).toBe(395);
    expect(justOver?.trusteeFeeCents).toBe(26);
    expect(justOver?.isTracked).toBe(true);

    const atHundred = selectShippingMethod(
      deDe,
      basket(10000, 40),
      policy(),
    );
    expect(atHundred?.name).toBe('Grossbrief + Einschreiben EINWURF');
    expect(atHundred?.priceCents).toBe(465);

    const overHundred = selectShippingMethod(
      deDe,
      basket(10001, 40),
      policy(),
    );
    expect(overHundred?.name).toBe('DHL Paket (Online)');
    expect(overHundred?.priceCents).toBe(719);
  });

  it('exposes the DE->GB four-card letter cliff', () => {
    const four = selectShippingMethod(
      deGb,
      basket(2000, 4),
      policy(),
    );
    expect(four?.name).toBe('Letter (Standardbrief)');
    expect(four?.priceCents).toBe(155);

    const five = selectShippingMethod(
      deGb,
      basket(2000, 5),
      policy(),
    );
    expect(five?.name).toBe('Registered Parcel (DHL Paket Online)');
    expect(five?.priceCents).toBe(2799);
    expect(five?.isTracked).toBe(true);
  });

  it('selects GB->DE letter and tracked small parcel tiers', () => {
    expect(
      selectShippingMethod(gbDe, basket(2000, 10), policy())?.name,
    ).toBe('Int. Standard Letter');
    expect(
      selectShippingMethod(gbDe, basket(2000, 10), policy())?.priceCents,
    ).toBe(497);

    const tracked = selectShippingMethod(
      gbDe,
      basket(3000, 10),
      policy(),
    );
    expect(tracked?.name).toBe('Int. Standard Small Parcel (Online)');
    expect(tracked?.priceCents).toBe(2018);
    expect(tracked?.isTracked).toBe(true);
  });

  it('selects the FR->DE tracked letter for a 30 EUR basket', () => {
    const selected = selectShippingMethod(
      frDe,
      basket(3000, 10),
      policy(),
    );
    expect(selected?.name).toBe('Lettre Suivie Internationale (Tracked Letter)');
    expect(selected?.priceCents).toBe(815);
    expect(selected?.isTracked).toBe(true);
  });

  it('never selects a virtual-only route', () => {
    expect(deJp).toHaveLength(1);
    expect(deJp[0]?.isVirtual).toBe(true);
    expect(
      selectShippingMethod(deJp, basket(3000, 1), policy()),
    ).toBeNull();
  });
});
