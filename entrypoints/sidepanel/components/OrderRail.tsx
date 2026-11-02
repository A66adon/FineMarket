import { cx } from '@/src/ui/cx';
import { formatCents } from '@/src/shared/money';
import type { Plan } from '@/src/shared/types';

export function OrderRail({
  plan,
  focusedOrderId,
  onFocus,
}: {
  plan: Plan;
  focusedOrderId: string | null;
  onFocus: (sellerId: string) => void;
}) {
  const maxCards = Math.max(1, ...plan.orders.map((order) => order.cardCount));

  return (
    <section className="order-rail" aria-label="Order rail">
      <div className="rail-head">
        <span className="rail-label">Order rail</span>
        <span className="rail-meta">
          <span className="num">{plan.orders.length}</span> stops
          <span className="receipt-dot">·</span>
          <span className="num">{formatCents(plan.totals.totalCents)}</span>
        </span>
      </div>
      <div className="rail-track">
        {plan.orders.map((order, index) => {
          const height = 9 + Math.round((order.cardCount / maxCards) * 16);
          const active = order.seller.id === focusedOrderId;
          return (
            <button
              key={order.seller.id}
              type="button"
              className={cx('rail-stop', active && 'active')}
              onClick={() => onFocus(order.seller.id)}
              title={`${order.seller.name} · ${order.cardCount} cards · ${formatCents(order.totalCents)}`}
            >
              <span className="rail-line" style={{ height: `${height}px` }} />
              <span className="rail-dot" />
              <span className="rail-number num">{String(index + 1).padStart(2, '0')}</span>
              <span className="rail-seller">{shortSeller(order.seller.name)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function shortSeller(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return first.length > 9 ? `${first.slice(0, 8)}…` : first;
}
