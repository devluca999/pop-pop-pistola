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
