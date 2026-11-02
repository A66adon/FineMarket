import { describe, expect, it } from 'vitest';
import type {
  BuyMode,
  Condition,
  Offer,
  OptimizerPolicy,
  Plan,
  PlanVariant,
  Seller,
  ShippingMethod,
  ShippingTable,
  Want,
} from '../../src/shared/types';
import { DEFAULT_POLICY } from '../../src/shared/constants';
import {
  buildMaxOrdersCurve,
  optimize,
  type OptimizeInput,
} from '../../src/shared/optimizer';

function policy(overrides: Partial<OptimizerPolicy> = {}): OptimizerPolicy {
  return { ...DEFAULT_POLICY, ...overrides };
}

function seller(
  id: string,
  name: string,
  countryId: number,
  etaDays: number | null = null,
): Seller {
  return {
    id,
    name,
    country: `Country ${countryId}`,
    countryId,
    isCommercial: true,
    isPowerseller: false,
    etaDays,
  };
}

function offer(
  wantId: string,
  fromSeller: Seller,
  priceCents: number,
  stock: number,
  id: string,
  etaDays: number | null = null,
  condition: Condition = 'EX',
): Offer {
  return {
    id,
    wantId,
    productName: wantId,
    condition,
    language: 'EN',
    finish: 'nonfoil',
    isSigned: false,
    isAltered: false,
    priceCents,
    stock,
    seller: fromSeller,
    etaDays,
  };
}

function want(
  id: string,
  quantity: number,
  offers: Offer[],
): Want {
  return {
    id,
    name: id,
    quantity,
    finish: 'nonfoil',
    board: 'mainboard',
    isBasicLand: false,
    allowAnyPrinting: false,
    allowAnyFinish: false,
    ownedQuantity: 0,
    ownedExactQuantity: 0,
    offers,
  };
}

function method(
  name: string,
  priceCents: number,
  options: {
    isTracked?: boolean;
    isLetter?: boolean;
    maxValueCents?: number;
    maxWeightG?: number;
    isVirtual?: boolean;
  } = {},
): ShippingMethod {
  return {
    methodKey: [
      name,
      String(options.isTracked ?? false),
      String(options.maxValueCents ?? 2500),
      String(options.maxWeightG ?? 500),
      String(priceCents),
      String(options.isLetter ?? true),
      String(options.isVirtual ?? false),
    ].join('|'),
    name,
    isTracked: options.isTracked ?? false,
    maxValueCents: options.maxValueCents ?? 2500,
    maxWeightG: options.maxWeightG ?? 500,
    stampPriceRaw: '',
    stampPriceCents: null,
    priceCents,
    isLetter: options.isLetter ?? true,
    isVirtual: options.isVirtual ?? false,
  };
}

const DOMESTIC_U = method('Domestic letter', 200, {
  maxValueCents: 2500,
  maxWeightG: 500,
  isLetter: true,
});
const DOMESTIC_T = method('Domestic tracked', 400, {
  isTracked: true,
  maxValueCents: 10000,
  maxWeightG: 2000,
  isLetter: false,
});
const CROSS_BORDER_U = method('Cross-border letter', 150, {
  maxValueCents: 2500,
  maxWeightG: 20,
  isLetter: true,
});
const CROSS_BORDER_T = method('Cross-border tracked', 2799, {
  isTracked: true,
  maxValueCents: 50000,
  maxWeightG: 5000,
  isLetter: false,
});

const SHIPPING: ShippingTable = new Map([
  ['7->7', [DOMESTIC_U, DOMESTIC_T]],
  [
    '13->7',
    [
      CROSS_BORDER_U,
      CROSS_BORDER_T,
    ],
  ],
]);

const ROUTE_ETA: ReadonlyMap<string, number> = new Map([
  ['7->7', 5],
  ['13->7', 8],
]);

function makeInput(
  wants: Want[],
  options: {
    shipping?: ShippingTable;
    routeEta?: ReadonlyMap<string, number>;
    buyerCountryId?: number;
    policy?: OptimizerPolicy;
    mode?: BuyMode;
    variants?: PlanVariant[];
    maxOrdersCap?: number;
  } = {},
): OptimizeInput {
  return {
    wants,
    buyerCountryId: options.buyerCountryId ?? 7,
    shipping: options.shipping ?? SHIPPING,
    routeEta: options.routeEta ?? ROUTE_ETA,
    policy: options.policy ?? policy({ allowPartial: true }),
    mode: options.mode ?? 'cheapest-playable',
    variants: options.variants,
    maxOrdersCap: options.maxOrdersCap,
  };
}

function cheapest(input: OptimizeInput): Plan {
  const plan = optimize(input).plans.find(
    (candidate) => candidate.variant === 'cheapest',
  );
  expect(plan).toBeDefined();
  return plan as Plan;
}

function variantPlan(input: OptimizeInput, variant: PlanVariant): Plan {
  const plan = optimize(input).plans.find(
    (candidate) => candidate.variant === variant,
  );
  expect(plan).toBeDefined();
  return plan as Plan;
}

describe('optimize', () => {
  it('buys everything from one seller when that is cheapest and feasible', () => {
    const alpha = seller('alpha', 'Alpha', 7);
    const input = makeInput([
      want('w1', 2, [offer('w1', alpha, 100, 2, 'o1')]),
      want('w2', 3, [offer('w2', alpha, 100, 3, 'o2')]),
    ]);

    const plan = cheapest(input);

    expect(plan.orders).toHaveLength(1);
    expect(plan.totals).toEqual({
      itemsCents: 500,
      shippingCents: 200,
      trusteeCents: 0,
      totalCents: 700,
      orderCount: 1,
      cardCount: 5,
      slowestEtaDays: 5,
    });
    expect(plan.id).toBe('cheapest|Alpha|700');
    expect(plan.mode).toBe('cheapest-playable');
    expect(plan.missing).toEqual([]);
  });

  it('splits a want across sellers when stock is limited', () => {
    const alpha = seller('alpha', 'Alpha', 7);
    const beta = seller('beta', 'Beta', 7);

    const input = makeInput([
      want('w1', 10, [
        offer('w1', alpha, 100, 6, 'a1'),
        offer('w1', beta, 150, 10, 'b1'),
      ]),
    ]);

    const cheap = cheapest(input);
    expect(cheap.totals.itemsCents).toBe(1200);
    expect(cheap.totals.shippingCents).toBe(400);
    expect(cheap.totals.totalCents).toBe(1600);
    expect(cheap.totals.orderCount).toBe(2);
    expect(cheap.totals.cardCount).toBe(10);
    expect(
      cheap.orders
        .flatMap((order) => order.lines)
        .reduce((sum, line) => sum + line.quantity, 0),
    ).toBe(10);

    const fewer = variantPlan(input, 'fewer-orders');
    expect(fewer.totals.orderCount).toBe(1);
    expect(fewer.totals.itemsCents).toBe(1500);
    expect(fewer.totals.totalCents).toBe(1700);
  });

  it('trades a large cost increase for one fewer order', () => {
    const alpha = seller('alpha', 'Alpha', 7);
    const beta = seller('beta', 'Beta', 7);

    const input = makeInput([
      want('w1', 10, [
        offer('w1', alpha, 100, 10, 'a1'),
        offer('w1', beta, 500, 10, 'b1'),
      ]),
      want('w2', 10, [
        offer('w2', alpha, 500, 10, 'a2'),
        offer('w2', beta, 100, 10, 'b2'),
      ]),
    ]);

    const cheap = cheapest(input);
    expect(cheap.totals.orderCount).toBe(2);
    expect(cheap.totals.itemsCents).toBe(2000);
    expect(cheap.totals.shippingCents).toBe(400);
    expect(cheap.totals.trusteeCents).toBe(0);
    expect(cheap.totals.totalCents).toBe(2400);

    const fewer = variantPlan(input, 'fewer-orders');
    expect(fewer.totals.orderCount).toBe(1);
    expect(fewer.totals.itemsCents).toBe(6000);
    expect(fewer.totals.shippingCents).toBe(400);
    expect(fewer.totals.trusteeCents).toBe(60);
    expect(fewer.totals.totalCents).toBe(6460);
    expect(fewer.orders[0]?.shippingMethod.isTracked).toBe(true);

    const curve = optimize(input).maxOrdersCurve;
    expect(curve.map((point) => point.maxOrders)).toEqual([1, 2]);
    expect(curve[0]).toEqual({
      maxOrders: 1,
      totalCents: 6460,
      feasible: true,
    });
    expect(curve[1]).toEqual({
      maxOrders: 2,
      totalCents: 2400,
      feasible: true,
    });

    expect(buildMaxOrdersCurve(input, 2)).toEqual(curve);
  });

  it('finds the four-card cross-border letter split', () => {
    const home = seller('home', 'Home', 7);
    const cheap = seller('cheap', 'Cheap', 13);

    const input = makeInput([
      want('w1', 5, [
        offer('w1', home, 100, 10, 'home-offer'),
        offer('w1', cheap, 50, 10, 'cheap-offer'),
      ]),
    ]);

    const plan = cheapest(input);
    expect(plan.totals.orderCount).toBe(2);
    expect(plan.totals.itemsCents).toBe(300);
    expect(plan.totals.shippingCents).toBe(350);
    expect(plan.totals.trusteeCents).toBe(0);
    expect(plan.totals.totalCents).toBe(650);

    const cheapOrder = plan.orders.find((order) => order.seller.id === 'cheap');
    const homeOrder = plan.orders.find((order) => order.seller.id === 'home');
    expect(cheapOrder?.cardCount).toBe(4);
    expect(cheapOrder?.shippingCents).toBe(150);
    expect(homeOrder?.cardCount).toBe(1);
    expect(homeOrder?.shippingCents).toBe(200);

    const fewer = variantPlan(input, 'fewer-orders');
    expect(fewer.totals.orderCount).toBe(1);
    expect(fewer.totals.totalCents).toBe(700);
  });

  it('crosses the 25 EUR tracking cliff', () => {
    const overseas = seller('overseas', 'Overseas', 13);

    const below = cheapest(
      makeInput([
        want('w1', 1, [offer('w1', overseas, 1300, 1, 'below')]),
      ]),
    );
    expect(below.totals).toEqual({
      itemsCents: 1300,
      shippingCents: 150,
      trusteeCents: 0,
      totalCents: 1450,
      orderCount: 1,
      cardCount: 1,
      slowestEtaDays: 8,
    });
    expect(below.orders[0]?.shippingMethod.isTracked).toBe(false);

    const above = cheapest(
      makeInput([
        want('w1', 2, [offer('w1', overseas, 1300, 2, 'above')]),
      ]),
    );
    expect(above.totals).toEqual({
      itemsCents: 2600,
      shippingCents: 2799,
      trusteeCents: 26,
      totalCents: 5425,
      orderCount: 1,
      cardCount: 2,
      slowestEtaDays: 8,
    });
    expect(above.orders[0]?.shippingMethod.isTracked).toBe(true);
    expect(above.orders[0]?.shippingMethod.name).toBe(
      'Cross-border tracked',
    );
  });

  it('picks the fastest plan over the cheapest one when asked', () => {
    const alpha = seller('alpha', 'Alpha', 7, 5);
    const gamma = seller('gamma', 'Gamma', 13, 2);

    const input = makeInput([
      want('w1', 10, [
        offer('w1', alpha, 100, 10, 'a1', 5),
        offer('w1', gamma, 50, 10, 'g1', 2),
      ]),
      want('w2', 10, [
        offer('w2', alpha, 100, 10, 'a2', 5),
        offer('w2', gamma, 50, 10, 'g2', 2),
      ]),
    ]);

    const cheap = cheapest(input);
    expect(cheap.totals.orderCount).toBe(2);
    expect(cheap.totals.totalCents).toBe(2150);
    expect(cheap.totals.slowestEtaDays).toBe(5);

    const fastest = variantPlan(input, 'fastest');
    expect(fastest.totals.orderCount).toBe(1);
    expect(fastest.totals.itemsCents).toBe(1000);
    expect(fastest.totals.shippingCents).toBe(2799);
    expect(fastest.totals.trusteeCents).toBe(10);
    expect(fastest.totals.totalCents).toBe(3809);
    expect(fastest.totals.slowestEtaDays).toBe(2);
  });

  it('reports missing stock instead of silently dropping cards', () => {
    const alpha = seller('alpha', 'Alpha', 7);
    const input = makeInput([
      want('w1', 10, [offer('w1', alpha, 100, 4, 'a1')]),
    ]);

    const plan = cheapest(input);
    expect(plan.orders).toHaveLength(1);
    expect(plan.totals.itemsCents).toBe(400);
    expect(plan.totals.shippingCents).toBe(200);
    expect(plan.totals.totalCents).toBe(600);
    expect(plan.totals.cardCount).toBe(4);
    expect(plan.missing).toEqual([
      {
        wantId: 'w1',
        name: 'w1',
        requested: 10,
        filled: 4,
        shortfall: 6,
        reason: 'insufficient_stock',
      },
    ]);

    expect(optimize(input).maxOrdersCurve).toEqual([
      { maxOrders: 1, totalCents: null, feasible: false },
    ]);
  });

  it('reports a virtual-only route as no physical shipping route', () => {
    const virtualSeller = seller('digital', 'Digital', 36);
    const virtualOnly: ShippingTable = new Map([
      [
        '36->7',
        [
          method('Virtual Delivery', 0, {
            isTracked: true,
            maxValueCents: 1_000_000,
            maxWeightG: 0,
            isLetter: false,
            isVirtual: true,
          }),
        ],
      ],
    ]);

    const input = makeInput(
      [want('w1', 2, [offer('w1', virtualSeller, 100, 5, 'v1')])],
      { shipping: virtualOnly },
    );

    const plan = cheapest(input);
    expect(plan.orders).toEqual([]);
    expect(plan.totals.totalCents).toBe(0);
    expect(plan.totals.orderCount).toBe(0);
    expect(plan.missing).toEqual([
      {
        wantId: 'w1',
        name: 'w1',
        requested: 2,
        filled: 0,
        shortfall: 2,
        reason: 'no_shipping_route',
      },
    ]);
    expect(optimize(input).maxOrdersCurve).toEqual([]);
  });

  it('keeps cheap cross-border letters and fills the rest at home', () => {
    const home = seller('home', 'Home', 7);
    const cheapA = seller('cheap-a', 'Cheap A', 13);
    const cheapB = seller('cheap-b', 'Cheap B', 13);

    const input = makeInput([
      want('w1', 10, [
        offer('w1', home, 100, 20, 'h1'),
        offer('w1', cheapA, 50, 2, 'a1'),
        offer('w1', cheapB, 50, 2, 'b1'),
      ]),
      want('w2', 10, [
        offer('w2', home, 100, 20, 'h2'),
        offer('w2', cheapA, 50, 2, 'a2'),
        offer('w2', cheapB, 50, 2, 'b2'),
      ]),
    ]);

    const plan = cheapest(input);
    expect(plan.totals.orderCount).toBe(3);
    expect(plan.totals.itemsCents).toBe(1600);
    expect(plan.totals.shippingCents).toBe(500);
    expect(plan.totals.totalCents).toBe(2100);
    expect(
      plan.orders
        .filter((order) => order.seller.id.startsWith('cheap-'))
        .map((order) => order.cardCount),
    ).toEqual([4, 4]);

    const curve = optimize(input).maxOrdersCurve;
    expect(curve).toEqual([
      { maxOrders: 1, totalCents: 2200, feasible: true },
      { maxOrders: 2, totalCents: 2150, feasible: true },
      { maxOrders: 3, totalCents: 2100, feasible: true },
    ]);
  });

  it('honours maxOrdersCap for variants and truncates the curve', () => {
    const alpha = seller('alpha', 'Alpha', 7);
    const beta = seller('beta', 'Beta', 7);

    const input = makeInput(
      [
        want('w1', 10, [
          offer('w1', alpha, 100, 10, 'a1'),
          offer('w1', beta, 500, 10, 'b1'),
        ]),
        want('w2', 10, [
          offer('w2', alpha, 500, 10, 'a2'),
          offer('w2', beta, 100, 10, 'b2'),
        ]),
      ],
      { maxOrdersCap: 1 },
    );

    const result = optimize(input);
    for (const plan of result.plans) {
      expect(plan.totals.orderCount).toBe(1);
      expect(plan.totals.totalCents).toBe(6460);
    }
    expect(result.maxOrdersCurve).toEqual([
      { maxOrders: 1, totalCents: 6460, feasible: true },
    ]);
  });

  it('is deterministic when wants and offers are shuffled', () => {
    const alpha = seller('alpha', 'Alpha', 7);
    const beta = seller('beta', 'Beta', 7);

    const wants = [
      want('w1', 10, [
        offer('w1', alpha, 100, 10, 'a1'),
        offer('w1', beta, 500, 10, 'b1'),
      ]),
      want('w2', 10, [
        offer('w2', alpha, 500, 10, 'a2'),
        offer('w2', beta, 100, 10, 'b2'),
      ]),
    ];

    const shuffled = wants
      .slice()
      .reverse()
      .map((row) => ({
        ...row,
        offers: row.offers.slice().reverse(),
      }));

    const first = optimize(makeInput(wants));
    const second = optimize(makeInput(shuffled));

    const summary = (plans: Plan[]) =>
      plans.map((plan) => ({
        id: plan.id,
        variant: plan.variant,
        totals: plan.totals,
        orders: plan.orders.map((order) => ({
          sellerId: order.seller.id,
          cardCount: order.cardCount,
          lines: order.lines.map((line) => ({
            wantId: line.wantId,
            offerId: line.offerId,
            quantity: line.quantity,
          })),
        })),
        missing: plan.missing,
      }));

    expect(summary(second.plans)).toEqual(summary(first.plans));
    expect(second).toEqual(first);
    expect(second.maxOrdersCurve).toEqual(first.maxOrdersCurve);
  });
});
