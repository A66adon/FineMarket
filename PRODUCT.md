# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: WXT + React + TypeScript, hand-authored CSS design system, Vitest, Playwright. Chrome/Brave Manifest V3 extension; no backend.

## Users

Magic: The Gathering players who build decks on Moxfield and buy singles on Cardmarket. They play Commander and 60-card formats, usually order 20–120 cards at once, and currently lose time and money because Cardmarket's Shopping Wizard optimizes either card price or shipment count, not the total including postage. They use Chrome or Brave on desktop. The tool is personal and shared privately with a few friends.

## Product Purpose

Turn an open Moxfield deck into the cheapest practical Cardmarket cart, with explicit control over which boards and basic lands are included, and a clear choice between total price, number of orders, and delivery time. Success is a reviewed cart that costs less than the user's current or wizard-built cart and never silently changes language, condition, or card identity.

## Positioning

Moxfield-native and shipping-aware: it reads the deck directly from the open Moxfield tab, defaults to the cheapest English printing, and optimizes the complete cart including per-seller postage, Trustee fees, seller count, and slowest delivery estimate. It is a private local browser extension, not a marketplace or a public service.

## Operating Context

The user opens a Moxfield deck, has Cardmarket logged in in another tab, and starts a run from the extension. Runs take minutes because offers are read from Cardmarket pages. The user reviews several plans, applies one to the real cart, and pays on Cardmarket. Buying can happen on a desktop in the evening; the app should tolerate long runs, pauses for security checks, and stock changes.

## Capabilities and Constraints

- Chrome and Brave desktop, Manifest V3; no Firefox, Safari, or mobile extension.
- MTG only; Moxfield links/open tabs only, no CSV.
- English cards only; minimum condition EX; cheapest playable is the default.
- Board selection: mainboard, commanders, companions, sideboard, maybeboard, tokens, signature spells, attractions/stickers/contraptions/planes/schemes; basic-land toggle.
- Reads Cardmarket offers from product and metaproduct pages; uses `language=1` and `minCondition=EX` query filters; 50 rows per page.
- Uses the public `help.cardmarket.com` shipping-cost API; exact cart total is verified after applying.
- Applies articles through Cardmarket's internal `ShoppingCart_Add_AddArticlesFromProductPage` endpoint; no checkout, no payment automation.
- No server, no telemetry, no stored passwords; uses existing browser sessions.
- Rate limits, Cloudflare challenges, page-structure changes, seller country restrictions, minimum order values, and stock changes must be surfaced, never hidden.
- Private distribution; no Chrome Web Store publication.

## Brand Commitments

Working name: DeckCart (provisional; avoid Cardmarket/Moxfield trademarks and logos). Voice: direct, calm, specific; no hype, no gamification. The interface is an unofficial tool and must say so.

## Evidence on Hand

- Public Moxfield deck fixture: `tests/fixtures/moxfield-deck-command-tower.json` (Commander, 100 cards, foils/etched).
- Cardmarket product and metaproduct HTML fixtures: `tests/fixtures/cardmarket-*.html`.
- Shipping API fixtures: `tests/fixtures/shipping-*.json`.
- Reference implementations: `michasng/cardmarket_wizard` (MIT), `BenSouchet/cw-wizard` (MIT), Cardmarket Cart Optimizer (closed source, UX reference).
- No real Cardmarket account credentials are available in this environment; cart apply must be tested with mocks and a manual dry-run.

## Product Principles

1. Optimize the total the user actually pays, including postage and fees, not the sticker price of cards.
2. Never silently substitute a different language, condition, printing, or card; show every trade-off.
3. Make the user's constraints first-class: boards, basic lands, price, orders, delivery time.
4. Treat the real cart as dangerous: preview, confirm, apply, verify, and never checkout.
5. Be honest about estimates, stale offers, unsupported sellers, and failures.

## Accessibility & Inclusion

Keyboard-operable controls, visible focus, 4.5:1 body contrast, reduced-motion support, and clear error text. No product-specific standard beyond WCAG AA intent.
