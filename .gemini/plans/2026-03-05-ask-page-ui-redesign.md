# 2026-03-05 — Ask Page UI Redesign

## Goal
Redesign `ORGANVM_ Omniscience-Gauntlet_v2.html` for visual hierarchy, whitespace, reader/reference ease, and accessibility.

## Approach
CSS-only override injected into the saved SingleFile HTML. No HTML structure was changed — only the visual layer.

## Changes Made
- Injected `<style>` block (~590 lines) at top of file
- Imports: Inter (variable) + JetBrains Mono from Google Fonts
- Full CSS custom property token system (colors, spacing, type scale, radii, shadows)
- Nav: sticky + blur, gradient wordmark, active-state underline
- Chat layout: centered 900px column, comfortable gap between messages
- User bubble: indigo→violet gradient, asymmetric border-radius
- Assistant card: dark glass surface, generous 24px/20px padding
- Prose: proper h3/h4 hierarchy, 1.75 line-height, blockquote strip, table styles
- Sources panel: cite-N pill chips, FRESH emerald badge, source-card hover states
- Feedback buttons: pill shape, hover fill, separated by top border
- Input: pill-shaped with focus glow; Send button with gradient + lift animation
- Provider error notes: visually dimmed via CSS `:has()` selector
- SingleFile infobar: hidden

## File Modified
`/Users/4jp/Workspace/meta-organvm/stakeholder-portal/ORGANVM_ Omniscience-Gauntlet_v2.html`
