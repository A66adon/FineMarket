# Install DeckCart for friends

DeckCart is a private, unpacked Chrome/Brave extension. It is not in a store.

## Before you start

- Desktop Chrome or Brave. Mobile browsers do not support this extension.
- Your own Cardmarket account, logged in in one tab.
- Your Moxfield deck open in another tab. If you want DeckCart to skip cards you
  own, enable **Collection Tracker** on the Moxfield deck.

## Install

1. Get the DeckCart folder or zip from David. If it is a zip, unzip it somewhere
   permanent.
2. Open `chrome://extensions` (Chrome) or `brave://extensions` (Brave).
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the folder that contains `manifest.json` — the built extension folder,
   usually `.output/chrome-mv3` or the unzipped `chrome-mv3` folder.
6. Pin DeckCart to the toolbar.

## Update

1. Replace the old extension folder with the new one.
2. Open `chrome://extensions` / `brave://extensions`.
3. Click the reload icon on the DeckCart card.
4. Reload any open Cardmarket and Moxfield tabs.

The extension ID may change if the folder path changes. That is normal for an
unpacked build; your settings live in the browser profile, not in the folder.

## First run

1. Log into Cardmarket.
2. Open a Moxfield deck.
3. Click **Find cheapest cart** on the Moxfield page, or open DeckCart from the
   toolbar.
4. Pick the boards, basic lands, mode and collection behavior.
5. Click **Find cheapest cart** in the side panel. The run reads Cardmarket
   pages one at a time; 100 cards can take a few minutes.
6. Review the plan and the seller stacks.
7. Click **Review and apply**, confirm, and apply.
8. Open the Cardmarket cart, check the final postage and fees, and pay there.

## If something goes wrong

- **Cardmarket security check:** open the Cardmarket tab, complete the check,
  then retry. DeckCart pauses instead of trying to bypass it.
- **Moxfield collection unavailable:** enable Collection Tracker on the deck and
  retry, or import your Moxfield collection CSV in the Collection panel.
- **Brave Shields:** if requests are blocked, allow the Cardmarket and Moxfield
  sites for this extension and retry.
- **A card is missing:** it may have no English EX+ offer or not enough stock.
  Check the missing list before applying.
- **Prices changed:** Cardmarket recalculates the cart. Always review the final
  cart before paying.

## Safety

DeckCart changes the real Cardmarket cart only when you confirm it. It never
checks out, pays, or stores your password. Use it at your own risk; it relies on
undocumented site behavior and can break when Cardmarket or Moxfield changes.
