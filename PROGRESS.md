# Progress

| # | Milestone | Status |
|---|---|---|
| 1 | Scaffold, repo, Vercel pipeline | done |
| 2 | Render target, dither post-process, filters, high-noon street | done (revised: smooth hi-res + always-on Bayer dither) |
| 3 | Characters from primitives, poses | done |
| 4 | Rules module + tests | done (64 tests: 7 prompt types, 3 draw types, look-alike keys, one-round effects, netcode) |
| 5 | QTE engine, nerve, fakes, bell, ring, resolution, hearts | done |
| 6 | Heals, Mercy kit, feint, Last Stand, Dusty's smoke | done |
| 7 | Vs CPU, Local Versus, menus, character select | done, browser-tested with bots |
| 8 | Sound and voices | done (procedural; not yet tuned by ear) |
| 9 | Settings: rebinding, gamepad, filters, accessibility, audio | done (keyboard rebinding tested; gamepad untested, no pad attached) |
| 10 | Online via Supabase Realtime | code done, tested over a same-browser loopback; **live server needs Supabase env vars** |
| 11 | Juice pass | done (muzzle, smoke, recoil, stagger, hat fly, dust, shake, POP!, freeze, dead-eye slow-mo, heart crack) |
| 12 | Final check + production deploy | done |

## How it was verified
- `npm test`: 47 tests (rules, CPU, netcode determinism, audio voice planner).
- `npm run build`: passes.
- Chrome, 1456x832 and 1511x812: scripted bot matches in Vs CPU, Local Versus and Online (two clients over `?loopback=1`): perfect draws, trades, flinches, Last Stand, win/lose screens, rematch, disconnect → "connection hiccup" → back to menu. No console errors.

## Known gaps
- Online needs `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in Vercel; until then it shows "Online unavailable: no server configured". Supabase transport itself is untested against a live project.
- Gamepad support is written against the standard mapping but not tested with a real pad.
- Audio has not been listened to and tuned by ear.
- `map.png` never arrived; the layout follows the written brief.
- No heat shimmer.

## Screen size test (render pass)

Headless Chromium (Playwright, SwiftShader GL) against `render-demo.html` and `index.html` on a Vite dev server, port 5191. Internal height is always 216; the width follows the aspect (4:3 to 21:9). "Framing" is `stage.framing()`: near body right edge < -0.28 NDC (left third), hat clear of centre, rival centred with feet in frame, bell above and in line with the rival's head. Bars are a sparse 4x4 Bayer stipple of the palette's two darkest colours, on the same low-res pixel grid as the image.

| Viewport (CSS @ DPR) | Internal res | Scale (device px per px) | Bars | FOV | Framing |
|---|---|---|---|---|---|
| 1280x720 @1 | 426x216 | 3 (integer) | top/bottom 36 px | 38.4 | ok |
| 1920x1080 @1 | 384x216 | 5 (integer) | none | 40.0 | ok |
| 2560x1080 @1 | 504x216 | 5 (integer) | sides 20 px | 35.9 | ok |
| 3440x1440 @1 | 504x216 | 6 (integer) | sides 208 px, top/bottom 72 px | 35.9 | ok |
| 1024x768 @1 | 288x216 | 3.56 (nearest, no blur) | none | 44.9 | ok |
| 390x844 @3 (portrait) | 292x216 | 4 (integer) | top/bottom 834 device px | 44.6 | ok |
| 844x390 @3 (landscape) | 504x216 | 5 (integer) | top/bottom 45, sides 6 device px | 35.9 | ok |

- `#ui`/`#crt` match the image rect (checked: 2560x1080 → ui 2520x1080 at x=20; 390x844 → ui 389x288 at y=278). `--u` = min(w/320, h/180): 6 px at 2560x1080 (it would be 7.9 by width alone).
- The view is measured synchronously in the Stage constructor, so the first frame is already the right size. A ResizeObserver on `#app` and the canvas resizes the target, post pass and camera, and redraws inside the same callback.
- Headless quirk: Chromium headless reports `devicePixelContentBoxSize` in CSS px under DPR emulation, so the Stage falls back to css x devicePixelRatio when the two disagree.
- Unit tests: `src/render/view.test.ts`.

## Maps (render pass)

Maps are data in `src/render/maps/` (one file per map, built from reusable prop builders in `props.ts`), assembled by `src/render/world.ts`. `town.ts` is gone; noon is a straight port of it and renders the same as before.

| Map | Bell behind the rival | Fake (visual / sound) | Ambience |
|---|---|---|---|
| noon: High Noon Main Street | church tower | crow, tumbleweed, door, cough (unchanged) | wind |
| midnight: Midnight Lantern Street | timber fire-bell trestle with its own small lamp | flicker: every lantern sputters and nearly dies for 1.5 s / mains buzz that stutters, crackles | crickets, far owl, light wind |
| train: Train Platform | depot cupola | whistle: steam jet blows in from off the right edge / three-note chime whistle + hiss | yard hiss, clanks; a train rolls through every ~45 s (first at 14 s), ambient only |
| mesa: Mesa at Sunset | adobe mission bell gable | hawk: silhouette swoops across above the rival, shadow sweeps the sand / falling raspy screech | strong desert wind, rare coyote |
| saloon: Saloon Interior | bell hung over the bar | glass: bottle on the bar shatters into shards / crack + tinkle spray | crowd murmur, honky-tonk piano, glass clinks |

Checked headless at 1920x1080 (each map, plus each fake mid-effect), and the framing check at 1024x768, 2560x1080 and 390x844@3 for every map: all ok (near body right edge -0.31 to -0.39 NDC, rival centred, bell above the rival's head, NDC y 0.61 to 0.84). Same dither pass and palette count (20 colours: 8 shared character colours + 12 per map). Saloon title orbit stays inside the room. The four new sounds and the five ambience beds ran in headless Chromium without errors, but nobody has listened to them yet.
