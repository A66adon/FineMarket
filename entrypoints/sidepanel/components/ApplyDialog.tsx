import { useEffect, useRef, useState } from 'react';
import { ShoppingCart, TriangleAlert } from 'lucide-react';
import { formatCents } from '@/src/shared/money';
import { planMissingCount } from '@/src/shared/plan';
import type { Plan } from '@/src/shared/types';

export function ApplyDialog({
  open,
  plan,
  onClose,
  onApply,
}: {
  open: boolean;
  plan: Plan;
  onClose: () => void;
  onApply: (dryRun: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const missing = planMissingCount(plan);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setConfirmed(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="apply-dialog"
      aria-labelledby="apply-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className="dialog-head">
        <h2 id="apply-heading">Apply to your real cart?</h2>
        <p className="section-copy">
          This changes the live Cardmarket cart in this browser. It does not
          check out, pay, or hold the cards for you.
        </p>
      </div>

      <dl className="dialog-facts">
        <div>
          <dt>Total</dt>
          <dd className="num">{formatCents(plan.totals.totalCents)}</dd>
        </div>
        <div>
          <dt>Orders</dt>
          <dd className="num">{plan.totals.orderCount}</dd>
        </div>
        <div>
          <dt>Cards</dt>
          <dd className="num">{plan.totals.cardCount}</dd>
        </div>
      </dl>

      {missing > 0 ? (
        <div className="notice notice-warning">
          <TriangleAlert size={17} aria-hidden="true" />
          <div className="notice-copy">
            <strong>{missing} cards are missing</strong>
            <p>Only the cards in this plan will be added.</p>
          </div>
        </div>
      ) : null}

      <label className="check-row dialog-check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>
          <strong>I understand this changes my real cart.</strong>
          <small>Cardmarket will recalculate the final postage at checkout.</small>
        </span>
      </label>

      <label className="check-row dialog-check">
        <input
          type="checkbox"
          checked={dryRun}
          onChange={(event) => setDryRun(event.target.checked)}
        />
        <span>
          <strong>Dry run</strong>
          <small>Check the request without changing the cart.</small>
        </span>
      </label>

      <div className="dialog-actions">
        <button type="button" className="button button-quiet" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={!confirmed}
          onClick={() => onApply(dryRun)}
        >
          <ShoppingCart size={15} aria-hidden="true" />
          {dryRun ? 'Test request' : 'Apply to cart'}
        </button>
      </div>
    </dialog>
  );
}
