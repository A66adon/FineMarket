import { Check, TriangleAlert } from 'lucide-react';
import { cx } from '@/src/ui/cx';
import type { Plan } from '@/src/shared/types';
import { formatCents, formatSignedCents } from '@/src/shared/money';
import {
  PLAN_DESCRIPTIONS,
  PLAN_LABELS,
  planMissingCount,
  sortPlans,
} from '@/src/shared/plan';

export function PlanComparison({
  plans,
  selectedPlanId,
  onSelect,
}: {
  plans: Plan[];
  selectedPlanId: string | null;
  onSelect: (planId: string) => void;
}) {
  const sorted = sortPlans(plans);
  const cheapest = sorted.find((plan) => plan.variant === 'cheapest') ?? sorted[0];

  return (
    <section className="tray plan-tray" aria-labelledby="plans-heading">
      <div className="section-heading-row">
        <h2 id="plans-heading">Choose a plan</h2>
        <span className="muted">Landed total, postage included</span>
      </div>

      <div className="plan-lanes">
        {sorted.map((plan) => {
          const selected = plan.id === selectedPlanId;
          const delta =
            cheapest && plan.variant !== 'cheapest'
              ? plan.totals.totalCents - cheapest.totals.totalCents
              : 0;
          const missing = planMissingCount(plan);
          return (
            <button
              key={plan.id}
              type="button"
              className={cx('plan-lane', selected && 'selected')}
              aria-pressed={selected}
              onClick={() => onSelect(plan.id)}
            >
              <span className="plan-marker" aria-hidden="true">
                {selected ? <Check size={11} strokeWidth={3} /> : null}
              </span>
              <span className="plan-lane-main">
                <span className="plan-name">{PLAN_LABELS[plan.variant]}</span>
                <span className="plan-desc">
                  {PLAN_DESCRIPTIONS[plan.variant]}
                </span>
              </span>
              <span className="plan-numbers">
                <strong className="num">{formatCents(plan.totals.totalCents)}</strong>
                <small>
                  <span className="num">{plan.totals.orderCount}</span> orders
                  <span className="receipt-dot">·</span>
                  {plan.totals.slowestEtaDays != null ? (
                    <span className="num">{plan.totals.slowestEtaDays} d</span>
                  ) : (
                    'ETA —'
                  )}
                </small>
              </span>
              <span className="plan-delta">
                {plan.variant === 'cheapest' ? (
                  'Best total'
                ) : delta > 0 ? (
                  <span className="num">{formatSignedCents(delta)}</span>
                ) : (
                  '—'
                )}
                {missing > 0 ? (
                  <span className="plan-missing">
                    <TriangleAlert size={11} aria-hidden="true" />
                    {missing} missing
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      <p className="fineprint">
        Totals include an estimated Trustee fee. Cardmarket recalculates postage
        when the cart is verified.
      </p>
    </section>
  );
}
