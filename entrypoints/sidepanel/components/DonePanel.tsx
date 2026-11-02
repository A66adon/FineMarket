import { CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react';
import type { ApplyResult } from '@/src/shared/types';

export function DonePanel({
  result,
  onOpenCart,
  onRunAgain,
}: {
  result: ApplyResult;
  onOpenCart: () => void;
  onRunAgain: () => void;
}) {
  const dryRun = result.message.toLowerCase().includes('dry run');

  return (
    <section className="tray done-tray" aria-labelledby="done-heading">
      <span className="done-icon" aria-hidden="true">
        <CheckCircle2 size={26} strokeWidth={1.7} />
      </span>
      <h2 id="done-heading">{dryRun ? 'Dry run complete' : 'Cart updated'}</h2>
      <p className="section-copy">
        {dryRun
          ? 'The request was tested. The real cart was not changed.'
          : `Cardmarket accepted ${result.added} articles. Open the cart and confirm the final postage before you pay.`}
      </p>
      <div className="done-actions">
        <button type="button" className="button button-primary" onClick={onOpenCart}>
          <ExternalLink size={15} aria-hidden="true" />
          Open Cardmarket cart
        </button>
        <button type="button" className="button button-quiet" onClick={onRunAgain}>
          <RefreshCw size={14} aria-hidden="true" />
          Run again
        </button>
      </div>
      <p className="fineprint">
        Cardmarket owns checkout and payment. DeckCart never sees your payment
        details.
      </p>
    </section>
  );
}
