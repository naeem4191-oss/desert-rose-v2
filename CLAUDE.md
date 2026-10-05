# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page, scroll-driven Three.js landing page for the QC+ Desert Rose resin sculpture (QR 90, links to market.qacreates.com). It's a static site with no build step, no package manager and no tests. Three.js r169 and Lenis load from jsDelivr through the import map in `index.html`.

## Running it

```bash
python3 serve.py        # http://localhost:8765, serves its own folder with Cache-Control: no-store
```

- **Use a server, not file://.** Opening `index.html` from disk fails because the model, textures and video are fetched.
- **Use `serve.py`, not plain `python -m http.server`.** Browsers otherwise cache the ES modules, so edits don't show up.
- **Review a moment directly:** append `#t=<timeline value>` to the URL, e.g. `/#t=4.3`. This jumps straight there, skips the intro dolly, and sets the current chapter stop to the nearest one. A changed hash alone doesn't reload, so add a query (`?r=2#t=4.3`) to force a fresh load.

Deploy: the `main` branch is published by GitHub Pages at https://naeem4191-oss.github.io/desert-rose/ (`.nojekyll` is required).

## Architecture

**One timeline drives everything.** Each `<section data-sec>` in `index.html` is one timeline unit: section *i* covers `t ∈ [i, i+1)`. `timeline(y)` in `js/main.js` maps scroll position to `t` from the measured section tops and heights. All 3D state, overlays and HUD are pure functions of `t` (plus wall-clock time for idle motion) inside `update(t, time, dt)`. The keyframe tracks in the `K` object are `[t, value, ease?]` lists evaluated with `track(keys, t)`. Scrolling back reverses everything exactly. The sand grains are fully deterministic in their shader for the same reason.

Section index → content: 0 hero · 1 rise from sand · 2 resin (gallery) · 3 close-up with hotspots · 4 "Look closer" · 5 museum video · 6 gift box · 7 the object (CTA).

**Chapter stepping replaces native scrolling.** Lenis stays `stop()`ped for the whole session, and `html.lenis-stopped` hides overflow. Wheel, touch and key handlers call `goTo(i)`, which animates `lenis.scrollTo(..., { force: true })` to `STOPS[i]`, so the page only ever rests on a stop. Move duration comes from `moveTime()`, which gives the video segment (t 4.6–5.5) about 3 s per unit.

**Coupling to respect when retiming:**
- **Stops must be settled frames with their card fully visible.** Cards are `position: sticky` inside sections taller than 100vh. A card stays pinned only while `t − i ≤ (sectionHeight − 100vh) / sectionHeight`. Changing a section's `height` in `index.html` therefore changes which `t` values are valid stops.
- **Sticky pinning depends on `body { overflow-x: clip }`.** Using `hidden` breaks the pinning once the html element's overflow is hidden.
- **`SWAP_T` (1.6) is the hidden cut from the desert to the gallery.** It falls under the sandstorm peak (fog density spike). The `desert` and `gallery` groups, light rigs, sky mode and drift-particle mode all switch there.
- **The rose's world position has two regimes.** Before 5.85 it's the scripted rise `START_Y·(1−smooth(t))`. The pour shader in `js/sand.js` uses the same `rise()` curve, and the mound uses `MOUND_A`/`MOUND_S`. Keep the JS and GLSL versions in sync. After 5.85 it follows `K.homeY` (the gift box). The museum video fully covers the screen in between, and `update()` returns `covered` there so rendering is skipped.
- **Camera distance is auto-fitted.** `K.cam` keyframes supply direction, target and screen shift. Where `K.fit` is 1, the distance is replaced so a full-size rose fills `FIT_H` of the viewport height (`FIT_W` of the width in portrait). The close-up (t≈3) and the dive (4→4.62) use `fit = 0`. Portrait screens also use `lift` (a vertical view offset) so the rose clears the bottom-anchored cards.

**`js/sand.js`** holds the procedural sand: tileable value-noise textures (albedo and wind-ripple normals) generated on a canvas at startup, the dune terrain with the mound displaced in an `onBeforeCompile` vertex patch, the `createPour` grains sampled from the rose mesh surface, and the `createDrift` airborne particles (calm desert, storm, or gallery dust motes, chosen by uniforms set in `update()`).

**Assets** (`assets/`):
- **`rose.bin`** is a custom binary converted from the photogrammetry USDZ. Header `[nv, ni]` (uint32), then positions (float32 ×3), smooth normals (×3), UVs (×2), then uint32 indices. The base sits at y=0 and the largest extent is 2 units. It's paired with 2048 px color, normal and AO JPEGs.
- **`museum.mp4`** is fetched as a blob so seeking works without HTTP range support, then scroll-scrubbed into a 2D canvas: cover-fit for landscape, sharp contain-fit over a blurred fill for portrait. `VIDEO_SRC` at the top of `main.js` is the swap point for higher-resolution footage. Every asset registers with the `THREE.LoadingManager` that gates the loader, and the video has an 8 s give-up timeout.

## Typography and licensing

Fonts follow the QC+ visual identity:
- **Lyon Arabic Display Medium:** headlines (100% leading).
- **Lyon Arabic Text Regular No.2 / Bold:** body (130% leading).
- **GT America Standard Regular / Medium:** captions, nav, labels.

Everywhere: sentence case, tracking 0, tabular lining figures. The CSS families are `--display`, `--text` and `--sans`. The 3D brass plaque is drawn on a canvas with the Lyon fonts after `fontsReady` resolves.

`fonts/` is **git-ignored on purpose**: the Grilli Type web licence forbids uploading GT America to public repositories such as GitHub. The Lyon files are the desktop OTFs; the web licence (QC+, one domain) covers the separately delivered WOFF/WOFF2 files. Never commit `fonts/`. The public GitHub Pages build therefore renders with the Georgia / Helvetica fallbacks.
