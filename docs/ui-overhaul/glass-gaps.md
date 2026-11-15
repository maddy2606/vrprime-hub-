# Aurora Glass: where the spec is silent (rule applied, per section 11)

- Font variable names: next/font sets --font-manrope, --font-unbounded, --font-geist-mono, mapped onto --font-sans, --font-display, --font-mono in globals.css (Tailwind already owns those three names). Section 2 intent kept.
- Spec values outside the token table (row hover, hero highlight, primary inset, skeleton sweep, page background) are held as variables in globals.css so no component file holds a colour. Values unchanged.
- Chart line draw: drawn with a left-to-right clip over 700 ms, because a dash-offset draw does not work with the non-scaling strokes the charts use. Section 6 timing unchanged.
- Trend chart's latest-value label: drawn as an accent Chip (rule 1, closest component).
- Bar (horizontal share bar): track uses the ShareBar track (surface2, 10 px, pill); fill uses the Bars rule (radius 6 px, vertical gradient). Rule 1.
- Lane segment text: stage 1 takes --ink, stages 2 and 3 take --accent-ink, in both modes (no new colour).
- Toast: built from tone row (3 px bar) on the popover surface, as section 4 Toasts describes.
