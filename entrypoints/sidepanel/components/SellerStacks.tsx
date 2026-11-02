import { useEffect, useState } from 'react';
import { ChevronDown, TriangleAlert } from 'lucide-react';
import { FINISH_LABELS } from '@/src/shared/constants';
import { formatCents } from '@/src/shared/money';
import type { Plan } from '@/src/shared/types';
import { cx } from '@/src/ui/cx';

export function SellerStacks({
  plan,
  focusedOrderId,
}: {
  plan: Plan;
  focusedOrderId: string | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(plan.orders[0] ? [plan.orders[0].seller.id] : []),
  );

  useEffect(() => {
    if (!focusedOrderId) return;
    setExpanded((current) => {
      if (current.has(focusedOrderId)) return current;
      const next = new Set(current);
      next.add(focusedOrderId);
      return next;
    });
    const element = document.getElementById(`order-${focusedOrderId}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focusedOrderId]);

  function toggle(sellerId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(sellerId)) next.delete(sellerId);
      else next.add(sellerId);
      return next;
    });
  }

  return (
    <section className="seller-stacks" aria-labelledby="sellers-heading">
      <div className="section-heading-row">
        <h2 id="sellers-heading">Seller stacks</h2>
        <span className="muted">What each parcel contains</span>
      </div>

      <div className="order-list">
        {plan.orders.map((order, index) => {
          const open = expanded.has(order.seller.id);
          const sellerType = order.seller.isPowerseller
            ? 'Powerseller'
            : order.seller.isCommercial
              ? 'Commercial'
              : 'Private';
          return (
            <article
              key={order.seller.id}
              className="order-stack"
              id={`order-${order.seller.id}`}
            >
              <button
                type="button"
                className="order-head"
                aria-expanded={open}
                onClick={() => toggle(order.seller.id)}
              >
                <span className="order-index num">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="order-main">
                  <strong>{order.seller.name}</strong>
                  <small>
                    {order.seller.country} · {sellerType}
                    <span className="receipt-dot">·</span>
                    {order.etaDays != null ? `${order.etaDays} d` : 'ETA unknown'}
                  </small>
                </span>
                <span className="order-figures">
                  <strong className="num">{formatCents(order.totalCents)}</strong>
                  <small>
                    <span className="num">{order.cardCount}</span> cards
                    <span className="receipt-dot">·</span>
                    postage <span className="num">{formatCents(order.shippingCents)}</span>
                  </small>
                </span>
                <ChevronDown
                  size={16}
                  className={cx('order-chevron', open && 'open')}
                  aria-hidden="true"
                />
              </button>

              {open ? (
                <div className="order-body">
                  <div className="order-lines">
                    {order.lines.map((line) => (
                      <div className="order-line" key={`${line.offerId}-${line.wantId}`}>
                        <span className="line-qty num">{line.quantity}×</span>
                        <span className="line-name">
                          <strong>{line.name}</strong>
                          <small>
                            {line.expansion ? `${line.expansion} · ` : ''}
                            {line.condition} · {FINISH_LABELS[line.finish]}
                          </small>
                        </span>
                        <span className="line-price num">
                          {formatCents(line.priceCents * line.quantity)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="order-fees">
                    <span>
                      Articles <strong className="num">{formatCents(order.itemsCents)}</strong>
                    </span>
                    <span>
                      Postage <strong className="num">{formatCents(order.shippingCents)}</strong>
                    </span>
                    <span>
                      Trustee <strong className="num">{formatCents(order.trusteeCents)}</strong>
                    </span>
                    <span>
                      Total <strong className="num">{formatCents(order.totalCents)}</strong>
                    </span>
                  </div>
                  <p className="order-shipping">
                    {order.shippingMethod.name}
                    {order.shippingMethod.isTracked ? ' · tracked' : ' · untracked'}
                  </p>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {plan.missing.length > 0 ? (
        <div className="missing-block">
          <div className="missing-head">
            <TriangleAlert size={16} aria-hidden="true" />
            <h3>Still missing</h3>
          </div>
          {plan.missing.map((missing) => (
            <div className="missing-row" key={missing.wantId}>
              <span>
                <strong>{missing.name}</strong>
                <small>{missingReasonLabel(missing.reason)}</small>
              </span>
              <span className="num">
                {missing.filled} / {missing.requested}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function missingReasonLabel(reason: string): string {
  switch (reason) {
    case 'no_offer':
      return 'No eligible offer';
    case 'no_shipping_route':
      return 'No shipping route from this seller';
    case 'insufficient_stock':
      return 'Not enough copies in stock';
    case 'no_feasible_method':
      return 'No usable shipping method';
    default:
      return reason;
  }
}
