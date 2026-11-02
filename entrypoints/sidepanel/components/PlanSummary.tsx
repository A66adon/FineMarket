import { ArrowRight, TriangleAlert } from 'lucide-react';
import type { Plan } from '@/src/shared/types';
import { formatCents } from '@/src/shared/money';
import { planMissingCount } from '@/src/shared/plan';

export function PlanSummary({
  plan,
  onApply,
}: {
  plan: Plan;
  onApply: () => void;
}) {
  const missing = planMissingCount(plan);
  const total = Math.max(1, plan.totals.totalCents);

  return (
    <section className="tray summary-tray" aria-labelledby="summary-heading">
      <div className="summary-top">
        <div>
          <h2 id="summary-heading">Your cart</h2>
          <p className="summary-total num">{formatCents(plan.totals.totalCents)}</p>
        </div>
        <button type="button" className="button button-primary" onClick={onApply}>
          Review and apply
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="cost-bar" aria-hidden="true">
        <i
          className="cost-items"
          style={{ width: `${(plan.totals.itemsCents / total) * 100}%` }}
        />
        <i
          className="cost-shipping"
          style={{ width: `${(plan.totals.shippingCents / total) * 100}%` }}
        />
        <i
          className="cost-trustee"
          style={{ width: `${(plan.totals.trusteeCents / total) * 100}%` }}
        />
      </div>

      <dl className="cost-legend">
        <div>
          <dt>
            <i className="legend-swatch legend-items" aria-hidden="true" />
            Cards
          </dt>
          <dd className="num">{formatCents(plan.totals.itemsCents)}</dd>
        </div>
        <div>
          <dt>
            <i className="legend-swatch legend-shipping" aria-hidden="true" />
            Postage
          </dt>
          <dd className="num">{formatCents(plan.totals.shippingCents)}</dd>
        </div>
        <div>
          <dt>
            <i className="legend-swatch legend-trustee" aria-hidden="true" />
            Trustee
          </dt>
          <dd className="num">{formatCents(plan.totals.trusteeCents)}</dd>
        </div>
      </dl>

      <div className="summary-stats">
        <div>
          <span className="field-label">Orders</span>
          <strong className="num">{plan.totals.orderCount}</strong>
        </div>
        <div>
          <span className="field-label">Cards</span>
          <strong className="num">{plan.totals.cardCount}</strong>
        </div>
        <div>
          <span className="field-label">Slowest ETA</span>
          <strong>
            {plan.totals.slowestEtaDays != null
              ? `${plan.totals.slowestEtaDays} days`
              : 'Unknown'}
          </strong>
        </div>
      </div>

      {missing > 0 ? (
        <div className="notice notice-warning">
          <TriangleAlert size={17} aria-hidden="true" />
          <div className="notice-copy">
            <strong>{missing} cards are still missing</strong>
            <p>
              They either have no English offer at your minimum condition or
              not enough stock. Review them before applying.
            </p>
          </div>
        </div>
      ) : null}

      <p className="fineprint">
        Applying changes your real Cardmarket cart. DeckCart never checks out,
        pays or shares your password.
      </p>
    </section>
  );
}
