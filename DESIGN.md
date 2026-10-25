---
name: antre
description: A phone-first review and publishing console with private workspaces and a public demo.
colors:
  paper: "#ffffff"
  paper-dim: "#efeeea"
  canvas: "#f6f5f2"
  ink: "#0f0f0d"
  ink-muted: "#6b6a63"
  ink-faint: "#a3a29b"
  lime: "#e4f222"
  night-lime: "#cad649"
  held-amber: "#a85d00"
  failed-red: "#c62828"
  published-green: "#1d7a3e"
  pinned-indigo: "#4f5bd5"
  night: "#0e0e0c"
  night-dim: "#262622"
  night-canvas: "#1a1a17"
  night-ink: "#f4f3ee"
typography:
  navigation-label:
    fontSize: "10px"
    fontWeight: 400
  public-display-large:
    fontSize: "60px"
    fontWeight: 700
  public-display:
    fontSize: "48px"
    fontWeight: 700
  public-display-small:
    fontSize: "40px"
    fontWeight: 700
  public-brand:
    fontSize: "32px"
    fontWeight: 750
  public-section:
    fontSize: "24px"
    fontWeight: 700
  section:
    fontSize: "17px"
    fontWeight: 700
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: "24px"
    letterSpacing: "-0.02em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  meta:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "18px"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
    fontFeature: "tnum"
rounded:
  chip: "8px"
  field: "10px"
  sheet: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  filter-chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.chip}"
    padding: "0 10px"
    height: "28px"
  search-field:
    backgroundColor: "{colors.paper-dim}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 12px"
    height: "36px"
  post-avatar:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "36px"
---

# Design System: antre

## Overview

**Creative North Star: "The Threaded Ledger"**

antre is what you get if Threads and Linear had a child. Posts look the way they will look on Threads: an avatar rail, the username, then the full text with nothing truncated, and a thread connector between parts. Everything around the post is Linear: small labels with an 8px topic dot, quiet 12–13px metadata, and filter chips that say exactly what is applied. The owner reviews drafts and plans the day on a phone, so the system is black and white, dense, and calm. Colour only carries state.

The schedule is bounded by days, not infinite. A week strip picks the day, and the DayLine shows that day's posting windows, free slots, the now marker and every post as one sticky horizontal strip. Lists page at 20 so a thousand drafts never become a thousand-row scroll.

**Key Characteristics:**
- Threads post rows: a 36px avatar, a 2px connector rail, and full post text with `white-space: pre-wrap`.
- Linear labels: an 8px topic dot, 12px names separated by middots, no boxes around tags.
- Black-and-white neutrals; four semantic hues used only for state.
- Phone column capped at 600px, with a bottom tab bar and bottom sheets for every secondary choice.
- The system font throughout, with tabular numerals for every time and count.

## Colors

The palette is warm monochrome plus one accent, Lime. Lime marks you and your next step: the primary button, avatars and the selected day. Every other hue is state.

### Neutral
- **Paper** (#ffffff) / **Night** (#0e0e0c): the page background in light and dark mode.
- **Canvas** (#f6f5f2) / **Night Canvas** (#1a1a17): the desktop sidebar and agenda columns around the paper page.
- **Paper Dim** (#efeeea) / **Night Dim** (#262622): the search field, inputs, DayLine window tracks, empty grid cells and the selected sort chip.
- **Ink** (#0f0f0d) / **Night Ink** (#f4f3ee): body text and icons.
- **Lime** (#e4f222) / **Night Lime** (#cad649): the primary button, avatars, the selected day, with ink text on top. The focus ring uses olive (#7c8700) in light mode and Night Lime in dark mode.
- **Ink Muted** (#6b6a63): metadata, labels, counts and hints. This is the quietest colour allowed for readable text.
- **Ink Faint** (#a3a29b): separators, free-slot rings and icons only. Never use it for text.
- **Hairlines**: `rgb(0 0 0 / 0.1)` divides rows; `rgb(0 0 0 / 0.18)` is for chip borders and the thread rail.

### Semantic
- **Held Amber** (#a85d00): held posts, the "Image needed" flag, and expiring-access banners.
- **Failed Red** (#c62828): failed posts, destructive actions, the reconnect banner, and the DayLine "now" marker.
- **Published Green** (#1d7a3e): the Published flag.
- **Pinned Indigo** (#4f5bd5): pinned posts, the focus ring on the DayLine, and the text selection tint.

Topic dots take their colour from the taxonomy (`topicColor`), so they are content colours, not system colours.

### Named Rules
**The State-Only Colour Rule.** Hue means state. A coloured element that is not held, failed, published, pinned, a topic dot or Lime is a bug. Lime appears once per view as the primary action, plus avatars and the selected day.

## Typography

**Body Font:** the system UI stack (SF Pro Text on iOS, with system-ui and Roboto as fallbacks).

**Character:** native and invisible. The post text should read exactly like Threads, so no display face competes with it.

### Hierarchy
- **Public display** (700, 40–60px, -0.04em): the landing page's opening heading. The phone layout uses 48px, reducing to 40px below 360px. Private app and demo page titles keep the 20px title size.
- **Public brand and section** (32px wordmark, 24px section headings): the wider landing page. They use the same system font and ink palette as the app.
- **Title** (700, 20px/24px, -0.02em): top bar page titles.
- **Section** (700, 17px): day summary ("Today"), sheet titles and settings section heads.
- **Body** (400, 15px/1.4): post text, reply text and list rows.
- **Meta** (500, 13px/18px): action row buttons, chips, banners and the pager.
- **Label** (400, 12px/16px, tabular numerals): tags, notes and DayLine readouts. Tab bar labels and badges drop to 10px.

### Named Rules
**The Full Text Rule.** Post content is never clamped or truncated. Only owner-facing notes may collapse to one line, and they expand on tap.

## Layout

Below 1100px the layout is a single column with `max-width: 600px`, centred, with side hairlines at ≥640px. It has a 52px sticky top bar (`--bar`) and a 56px bottom tab bar plus the safe-area inset (`--tabs`). The DayLine sticks directly under the top bar. Post rows have 12px/16px padding, use a 36px rail column with a 12px gap, and are separated by hairlines rather than cards. Spacing steps are 4, 8, 12 and 16. Lists page at 20 items, either server-side (Drafts, Library) or client-side for a single day (Schedule, Replies).

At 1100px and wider the private app is three columns: a 248px sidebar, the page (paper, content capped at 680px) and a 320px agenda, with both side columns on Canvas and scrolling on their own. The sidebar holds the wordmark, channel switch, views with counts, New post, the week grid and the account. The agenda lists the selected day's slots. The top bar keeps the page title and actions but drops the channel switch, and the bottom tab bar is hidden. The Schedule page drops its week strip, summary and DayLine on desktop because the grid and agenda already show them. The composer opens as a 640px dialog over the shell; Escape cancels.

## Elevation & Depth

The system is flat and divided by hairlines. Depth appears only in bottom sheets: a dimmed scrim and a sheet surface (`--bg-sheet`) that slides up with `--ease-sheet` (`cubic-bezier(0.32, 0.72, 0, 1)`, 420ms). Rows, chips and banners carry no shadows.

### Named Rules
**The Hairline Rule.** Rows are separated by 1px lines, never by cards or shadows.

## Shapes

Interactive controls are fully round (999px pills). Filter chips use 8px corners, fields 10px, and sheet tops 16px. Avatars, topic dots and DayLine capsules are circles or stadiums. The thread rail is a 2px rounded line.

## Components

### Buttons
- **Shape:** a pill (999px), 36px tall, or 44px for full-width sheet actions.
- **Primary:** a Lime fill with ink text, 15px/600. There is one primary per view.
- **Secondary:** a 1px hairline border; the press tint (`rgb(0 0 0 / 0.05)`) on hover.
- **Action row (`.act`):** a borderless 13px/500 icon-and-label button with no underline. It sits under each post: Queue, Schedule, Edit, More.
- **Press:** `scale(0.97)` (0.95 for action-row buttons) over 160ms with `--ease` (`cubic-bezier(0.23, 1, 0.32, 1)`).

### Chips (filter pills)
- **Style:** 28px tall with an 8px radius, a hairline border, and 13px/500 Ink Muted text with a chevron.
- **State:** when applied, the border and text switch to ink; the chip shows the chosen value (with the topic dot) and an × clear target.

### Labels
- **Style:** an 8px topic dot, then topic · angle · format names at 12px Ink Muted, with Ink Faint middots. There are no backgrounds or borders.

### Inputs / Fields
- **Style:** a Paper Dim fill, no border, a 10px radius, 36px tall.
- **Focus:** an inset 1px stronger hairline; global `:focus-visible` is a 2px ink outline.

### Navigation
- **Tab bar:** five slots (Drafts, Schedule, the centre compose "+" in a 10px-radius Paper Dim tile, Replies, Library). Labels are 10px; the active tab is ink and the others Ink Muted. The count badge is a 16px ink pill.
- **Sidebar (desktop):** pill nav rows with an 18px icon and a right-aligned count; the current view sits on Paper Dim.
- **Week grid (desktop):** seven day columns of 7px slot cells grouped by posting window, with hour labels at each window start. Cells are topic colour when queued, Ink Muted when published, red when failed, amber when held, Paper Dim when free and outlined for the next free slot. A red hairline marks now in today's column. The selected day's column takes a Lime tint. Hovering a cell shows "Day HH:MM · first line" or "· Free". A free cell opens the composer preset to that time.
- **Agenda (desktop):** the selected day's slots as rows (time, then post chip or a dashed "Free" target), with a dashed divider between windows and a red now row.
- **Bottom sheets:** a grab handle, a 17px title and a close button. Option rows are 48px tall. They hold filters, scheduling, swap, more actions and taxonomy pickers.

### DayLine (signature)
The DayLine is a sticky, 84px-tall SVG strip for the selected day:
- Window tracks are 8px Paper Dim bars, and free future slots are r=2 hollow circles.
- Post capsules use the topic colour and grow to 26px with an ink stroke when selected. Published capsules sit at 35% opacity; held capsules have an amber outline and failed ones are red.
- The now marker is a red line with a dot; the next free slot is an ink ring labelled "Next".
- Dragging scrubs a dashed line with a time readout. Arrow, Home and End keys move between posts (`role="slider"`).

## Do's and Don'ts

### Do:
- **Do** show every part of a post in full, connected by the 2px rail.
- **Do** put secondary choices in bottom sheets, with 48px rows.
- **Do** use tabular numerals for every time, date and count.
- **Do** keep tags at 12px with the 8px topic dot.
- **Do** page any list that can grow, at 20 per page.

### Don't:
- **Don't** truncate or clamp post text.
- **Don't** box or fill tags; they are text with a dot.
- **Don't** add colour that doesn't mean held, failed, published, pinned or a topic.
- **Don't** use Ink Faint for readable text.
- **Don't** separate rows with cards or shadows.
