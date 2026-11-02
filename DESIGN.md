---
name: DeckCart
description: Moxfield deck to cheaper Cardmarket cart
colors:
  ground: "#e8e1d4"
  surface: "#f8f3e9"
  surface-2: "#efe8da"
  surface-3: "#e5dccb"
  ink: "#1e2420"
  ink-2: "#38403a"
  muted: "#62685f"
  line: "#cbc2b2"
  line-strong: "#a79b87"
  orange: "#e4572e"
  orange-dark: "#c94724"
  orange-soft: "#f8ddd2"
  blue: "#1f4e79"
  blue-soft: "#dfe8ef"
  green: "#2f6b4f"
  green-soft: "#dfe9e2"
  red: "#a33a2b"
  red-soft: "#f3ddd8"
  amber: "#8a6312"
  amber-soft: "#f2e7c9"
  amber-line: "#dfc483"
  amber-ink: "#6f541b"
  green-line: "#a9c5b3"
  red-line: "#ddaca2"
  selection: "#f2b7a4"
  placeholder: "#8b8f86"
  selected-paper: "#fff7ef"
  white: "#ffffff"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "23px"
    fontWeight: 780
    lineHeight: 1.12
    letterSpacing: "-0.035em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "15px"
    fontWeight: 750
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "9.5px"
    fontWeight: 760
    lineHeight: 1.2
    letterSpacing: "0.09em"
  numeric:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "13px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "0"
    fontFeature: "tnum"
  micro:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "8.5px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.08em"
  caption:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "9.5px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "0"
  small:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "10.5px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0"
  compact:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0"
  body-small:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0"
  title-small:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "14px"
    fontWeight: 720
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  headline-small:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "18px"
    fontWeight: 760
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline-compact:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "21px"
    fontWeight: 770
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  headline-wide:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "28px"
    fontWeight: 780
    lineHeight: 1.1
    letterSpacing: "-0.04em"
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "31px"
    fontWeight: 780
    lineHeight: 1
    letterSpacing: "-0.045em"
rounded:
  hairline: "1px"
  micro: "4px"
  badge: "5px"
  input: "6px"
  chip: "7px"
  control: "8px"
  sm: "9px"
  rail: "12px"
  md: "14px"
  dialog: "16px"
  pill: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.orange-dark}"
    textColor: "{colors.white}"
    rounded: "{rounded.sm}"
    padding: "8px 11px"
  button-quiet:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 11px"
  chip-selected:
    backgroundColor: "{colors.orange-soft}"
    textColor: "{colors.ink}"
    rounded: "7px"
    padding: "5px 7px"
  plan-lane:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "0"
    padding: "10px 3px"
  order-rail:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "12px"
    padding: "9px 11px 8px"
---

# Design System: DeckCart

## Overview

**Creative North Star: "The Sorting Tray"**

DeckCart looks like the table where a card seller sorts a deck into seller piles:
warm putty paper, dark ink labels, a bright safety-orange marker, and a parcel
manifest rail. It is a working surface, not a storefront. The deck arrives as a
receipt; the options are a tray of labelled chips; the result is a set of seller
stacks and a rail that makes the cost of every extra order visible.

The palette is restrained but committed: a putty ground carries most of the
surface, ink owns the shell and the order rail, and orange is reserved for the
primary action and the selected plan. Blue carries links, data and shipping;
green carries savings and success; red and amber only carry problems. The type
is one system grotesque with tabular numerals; rank comes from weight, size and
case, not a display face.

**Key Characteristics:**
- Warm putty paper against an ink shell.
- Safety-orange selection and primary action, never decoration.
- Dense vertical stacking, hairline rules, no nested card grids.
- One signature move: the order rail.
- Every number is tabular and every estimate says it is an estimate.

## Colors

The palette reads as a physical sorting table: paper, ink, a marker pen, and a
few stamped labels.

### Primary
- **Safety Orange** (`#e4572e`): selected plan markers, active rail stops and the
  brand mark. It is a signal, not a surface wash.
- **Sealed Vermilion** (`#c94724`): primary buttons and the Moxfield launch
  button. White text clears contrast at this darker step.
- **Soft Orange** (`#f8ddd2`): selected chips and plan-lane tint.

### Secondary
- **Ledger Blue** (`#1f4e79`): links, shipping data, progress and focus rings.
- **Sorted Green** (`#2f6b4f`): savings, success and owned cards.
- **Label Amber** (`#8a6312`): missing cards and shipping warnings. Never used
  for a primary action.

### Neutral
- **Putty Ground** (`#e8e1d4`): the page.
- **Paper Surface** (`#f8f3e9`): trays and dialogs.
- **Second Paper** (`#efe8da`): quiet controls, chips and inset facts.
- **Ink** (`#1e2420`): text, header and the order rail.
- **Hairline** (`#cbc2b2`): dividers and quiet borders.
- **Muted Ink** (`#62685f`): secondary copy on paper.

### Named Rules
**The Marker Rule.** Orange marks a choice or an action. If it is not clickable,
selected, or the brand mark, it is not orange.

**The Red Means Broken Rule.** Red and amber only carry missing cards, failed
requests or warnings. They never decorate.

## Typography

**Display Font:** system grotesque (`-apple-system`, Segoe UI, Roboto, Helvetica
Neue, Arial)
**Body Font:** the same family
**Numeric Font:** the same family with `font-variant-numeric: tabular-nums`

**Character:** one workhorse voice keeps the tool quiet and lets the density and
the order rail carry the identity. Prices, counts and ETAs always align.

### Hierarchy
- **Headline** (780, 23px/1.12, -0.035em): the source-screen promise and the
  selected cart total. Two lines maximum in the side panel.
- **Title** (750, 15px/1.25, -0.02em): deck name, section headings and seller
  names.
- **Body** (400, 13.5px/1.5): explanations, never wider than 66ch.
- **Label** (760, 9.5px/1.2, 0.09em, uppercase): field labels and rail labels.
- **Numeric** (650, tabular): all prices, card counts, order counts and ETAs.

### Named Rules
**The One Voice Rule.** No display face, no serif, no mono costume. The interface
is a tool; hierarchy comes from scale, weight and spacing.

## Layout

The primary surface is a Chrome/Brave side panel between roughly 360 and 520px.
The content is a single column of trays with 10–12px gaps and 14px inner padding.
The header is a full-width ink bar with an orange bottom rule. The source screen
is one paper tray with a headline, a deck link field and an open-tab list. The
working screen stacks the deck receipt, buying tray, run tray, plan lanes, cart
summary, order rail and seller stacks in that order.

At 560px the field grid becomes two columns and the plan delta moves into the
lane. At 820px the app centers at 860px for the full-tab fallback. The primary
side-panel layout never becomes a two-column dashboard; the work is vertical.

### Named Rules
**The One Column Rule.** The side panel is a stack of trays, not a dashboard
grid. Wide screens get breathing room, not more columns of cards.

## Elevation & Depth

The system is flat by default. Trays use a 1px hairline border and no shadow.
The order rail is a tonal layer: ink against putty, not a shadow. The apply
dialog is the only lifted surface, with a wide soft shadow and a dimmed backdrop.

### Shadow Vocabulary
- **Dialog lift** (`0 24px 70px rgba(30, 36, 32, 0.3)`): the native apply dialog
  only.

### Named Rules
**The Flat Tray Rule.** A tray gets a border or a shadow, never both. Hover is a
tone change, not a lift.

## Shapes

Trays are 14px rounded; buttons, chips and inputs are 9px; the apply dialog is
16px. The order rail is 12px. There are no pills except small status badges and
no skewed or clipped containers. Icons are 13–18px Lucide strokes at 1.8–1.9
weight.

## Components

**Primary button.** Sealed Vermilion, white text, 9px radius, 34px minimum
height, 12.5px/660 label. Hover steps darker; active moves 1px; disabled drops to
45% opacity.

**Quiet button.** Second Paper fill with a hairline border. Used for filters,
collection, stop and secondary actions.

**Chip.** Second Paper at rest; Soft Orange with an orange border when pressed.
The count uses tabular numerals and a smaller muted size.

**Plan lane.** A full-width button row separated by hairlines, never a card.
The selected lane gets a Paper tint and an orange square marker with an ink
check. Total is 14px/760 tabular; the description stays 10.5px muted.

**Order rail.** The signature. An ink strip with a small tracked label, a total,
and one stop per seller. Stop height encodes card count; the active line is
orange and 2px; inactive lines are 1px at 36% white. It scrolls horizontally and
selects the matching seller stack.

**Seller stack.** A hairline-separated row with order number, seller, country,
type, ETA, total and postage. Expanding reveals line items, fees and the shipping
method. No nested cards.

**Apply dialog.** Native dialog, 16px radius, Paper surface, dimmed ink backdrop,
three facts, a warning when cards are missing, two checkboxes and a destructive-
adjacent primary action isolated from Cancel.

## Do's and Don'ts

### Do:
- **Do** keep orange for the selected plan, active rail stop and primary action.
- **Do** use tabular numerals for every price, count and ETA.
- **Do** show the collection source and the owned count before subtracting.
- **Do** keep the order rail and seller stacks in sync.
- **Do** label estimates as estimates; the cart is the authority.

### Don't:
- **Don't** add a second accent, gradient text, glass or decorative blur.
- **Don't** turn the seller stacks into nested cards or a dashboard grid.
- **Don't** use a display font or monospace as a costume for prices.
- **Don't** hide a missing card, a failed shipping route or a security check.
- **Don't** checkout, pay or claim the final postage is known before the cart is.
