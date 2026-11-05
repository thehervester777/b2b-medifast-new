# MediFast Supplier

A mobile-first request board for pharmacy suppliers: browse buyer requests, quote at the asking price in one tap or offer less, batch quotes in a cart, and download each submission as a PDF. White, blue and red; vanilla JS, Vite and GSAP.

```bash
npm install
npm run dev           # http://localhost:5173 (also on your LAN, for phone testing)
npm run build         # production build in dist/
npm run build:single  # one self-contained dist-single/index.html
```

Demo sign-in is pre-filled: `rishu@rpharma.example` / `demo1234`.

## Structure

```
src/
  main.js              boot: icons, motion, shell, router
  core/                store (state + pub/sub), router, motion (GSAP), toast, dom, format, icons
  components/          shell, sheet (bottom sheet), forms, seg (segmented control), cart, notifications, authHero
  views/               signin, signup, board, detail, quotes, submissions, account   (one chunk each)
  services/            requests (filter/sort), validation, pdf (loaded on demand)
  data/seed.js         sample requests, dates relative to today
  styles/              tokens, base, shell, components, auth, views, motion
```

Each view exports `{ title, render(params), mount(root, params) -> cleanup }`; the router loads it on demand and prefetches the others when idle.

## Performance notes

- Native scrolling. GSAP ScrollTrigger drives reveals, count-ups, the scroll progress bar and the back-to-top button, but never takes over the scroll.
- Animation uses transform and opacity only. Low-end hardware (data saver, 4 GB or less memory, 4 cores or fewer) gets shorter durations and no parallax. `prefers-reduced-motion` turns animation off completely.
- Long lists use `content-visibility: auto`. Click handling is delegated through `data-act`.
- jsPDF is only fetched when a PDF is downloaded. The font is a self-hosted Latin subset.
- State is saved to `localStorage` (key `medifast-supplier:v1`).

## Quote rules

Offer quantity cannot exceed the requested quantity. Price cannot exceed the asking price and takes up to two decimals. A sent quote is final.
