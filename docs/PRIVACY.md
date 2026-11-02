# Privacy

DeckCart is local-first. There is no DeckCart server, account, analytics,
telemetry, advertising, or remote code.

## What stays in the browser

- Moxfield deck data, Cardmarket offers, collection entries and plans.
- Your settings, saved collection CSV entries and a small shipping-cost cache in
  `chrome.storage.local`.
- A pending Moxfield deck id while the side panel opens.

Nothing is sent to a DeckCart backend because none exists. No data is sold or
shared.

## What DeckCart reads

- The Moxfield deck page and its public/internal deck JSON.
- The Moxfield Collection Tracker response when you open the deck and the
  tracker is enabled. This uses your existing Moxfield session and is read-only.
- Public Cardmarket product and metaproduct pages.
- The public `help.cardmarket.com` shipping-cost endpoint.
- Your current Cardmarket cart only when you explicitly apply a plan.

## What DeckCart writes

- It writes to your Cardmarket cart only after you confirm the apply dialog.
- It never checks out, pays, changes your address, or changes seller data.
- It never reads or stores your Cardmarket or Moxfield password.

## Permissions

- `storage`: settings, plans and the local collection cache.
- `scripting`: read the open Moxfield tab and communicate with Cardmarket pages.
- `activeTab`: identify the deck you are viewing.
- Host access to Moxfield, Cardmarket and the shipping endpoint.

## Removing data

Use the Collection panel to clear the saved collection. To remove everything,
remove the extension from `chrome://extensions` / `brave://extensions`; the
browser deletes its local storage with the extension.

## Third parties

Your use of Cardmarket and Moxfield remains subject to their terms and privacy
policies. DeckCart is an unofficial client, not an affiliate.
