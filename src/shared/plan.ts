import type { ApplyItem, Plan, PlanVariant } from './types';

export const PLAN_LABELS: Record<PlanVariant, string> = {
  cheapest: 'Cheapest',
  'fewer-orders': 'Fewer orders',
  fastest: 'Fastest',
};

export const PLAN_DESCRIPTIONS: Record<PlanVariant, string> = {
  cheapest: 'Lowest landed cost, even if it uses more sellers.',
  'fewer-orders': 'Fewer parcels, usually at a higher card price.',
  fastest: 'Shortest slowest delivery estimate we can find.',
};

export function planToCartItems(plan: Plan): ApplyItem[] {
  const quantities = new Map<string, number>();
  for (const order of plan.orders) {
    for (const line of order.lines) {
      quantities.set(
        line.offerId,
        (quantities.get(line.offerId) ?? 0) + line.quantity,
      );
    }
  }
  return Array.from(quantities, ([articleId, quantity]) => ({
    articleId,
    quantity,
  }));
}

export function planMissingCount(plan: Plan): number {
  return plan.missing.reduce((sum, line) => sum + line.shortfall, 0);
}

export function planCardCount(plan: Plan): number {
  return plan.orders.reduce((sum, order) => sum + order.cardCount, 0);
}

export function planSavings(plan: Plan, baseline?: Plan): number {
  if (!baseline) return 0;
  return baseline.totals.totalCents - plan.totals.totalCents;
}

export function sortPlans(plans: Plan[]): Plan[] {
  const order: PlanVariant[] = ['cheapest', 'fewer-orders', 'fastest'];
  return [...plans].sort(
    (a, b) => order.indexOf(a.variant) - order.indexOf(b.variant),
  );
}
