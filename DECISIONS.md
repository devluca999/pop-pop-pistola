# Decisions

Calls made while building autonomously. Format: decision — why — how to reverse.

- Name is **POP.POP.Pistola**, repo `pop-pop-pistola` — owner asked mid-build — rename the repo in GitHub settings, then update `index.html` title.
- Local folder stays `pop-pistola` — renaming the working dir mid-session risks breaking tooling — `mv` it any time.
- Pinned vite 7.3.7 / vitest 4.1.12 / typescript 5.9.3 / three 0.187.0 / supabase-js 2.119.0 (not vite 8 / TS 7) — proven, compatible combo — bump in package.json.
- `.npmrc legacy-peer-deps=true` — npm 10's arborist crashed resolving vitest's optional peers — delete the file once npm is fixed.
- `refs/` is git-ignored — they're third-party screenshots and shouldn't be in a public repo — they were in the first commit (fe history); purging needs a force-push, which I left for the owner.
- Vercel project on team **uhome corp** (hobby) — owner's pick — move the project in Vercel settings.
- Online mode is stubbed until `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set — owner's pick — add both env vars in Vercel and redeploy.
- High noon, not the storyboard's night — the written brief says high noon; refs are used for figure style, dither and tiles — change the sky/light in `src/render`.
- Keys are "slots": each player has 6 prompt keys; plans pick slot indices so rebinding never changes the rules.
- Fakes only happen in the **standoff** (after the 3 prompts, before the bell). Any prompt-key press in the standoff is an early draw (−1 heart), unless it is a reaction to an opponent's feint within 0.5s (then it's 2 flinches instead).
- "Slow press" = pressing more than 750 ms after the prompt appears; judged on the press, so hold prompts aren't penalised for holding.
- Perfect draw: the closing ring crosses the gold band at 380 ms after the bell; band 170 ms wide, −50 per flinch, 0 at 3 flinches, +90 in Last Stand. Speed still decides who shoots first, so perfect is a risk/reward choice.
- Draw delay (Dusty +150 ms) is added to his reaction for ordering and trade checks.
- Dusty in a trade deals 2 (3 if his draw was perfect) and takes 1. Dusty vs Dusty trade: each takes 1.
- Mercy vs Mercy trade: both blinded, no damage, no charge change.
- Mercy's charge persists through resets; it only resets when she takes damage or spends it on Will of God.
- Will of God choice: heal key = Full heal (once per match), draw key or timeout = Vaporize. CPU always vaporizes (it ends the match).
- Both duelists hitting zero in the same trade = a draw game.
- Dusty's smoke appears after any exchange where he drew (even when blinded: his shot still goes off, wide).
- **Look, revised by owner:** the scene renders smooth and high-res (about half the display resolution, MSAA, soft high-noon shadows, rich gradients), then the Bayer dither goes on top as the only retro element. Dither is always on: the strength slider stops at 35% — raise `DITHER_MIN` in `src/render/post.ts` to make it stronger.
- `map.png` (layout reference) was never found in the refs zip or the folder, so the street layout follows the written brief — drop it in `refs/` and ask for a layout pass.
- Character select: on a shared screen the cursors are visible, but a pick turns into "LOCKED" and every portrait only reveals once both lock. CPU picks at random; online picks reveal when both lock.
- Default controls: P1 Q W E A S D (draw keys), Z heal, X feint. P2 U I O J K L, M heal, `,` feint. Pads: A B X Y LB RB, LT heal, RT feint. Menus: arrows/Enter/Esc or d-pad/A/B.
- The drum roll plays for the first ~1.6s of the standoff, not right up to the bell, so it can't be used to time the bell.
- Online: host generates each exchange plan and sends it with the match state (keeps both clients in sync). Each client streams its inputs (times measured on its own clock from its own exchange start) plus an "up to" heartbeat every 80ms; results are resolved with now = min(local time, rival's heartbeat). Over 3s of silence = "connection hiccup", exchange restarts once the rival is back; 20s = rival left.
- The CPU always picks Vaporize on Will of God (it wins the match).
- **Camera (owner spec, map.png bottom panel):** tight over-the-shoulder at the near duelist's shoulder height, behind and to their right; near duelist large in the left third and cropped by the frame. The far duelist is nudged sideways (under 1m) so the camera→head line lands on the bell tower, which keeps the tower directly behind their head while the church stays centered on the street. Push-ins are a slight zoom, not a dolly, so there's no wide shot during play. Offsets scale with body width (tuned on Hector; Dusty sits further right and back). Tunables: `CAM_BACK`, `frameShot()` in `src/render/index.ts`.
- **Look, revised again by owner (latest wins):** back to a low-res 384x216 render with nearest-neighbor upscale, ~16-colour warm palette, 4x4 Bayer dither clearly visible everywhere; procedural pixel textures on every surface; papercraft low-poly characters; map.png is the visual target. Until map.png is on disk, the palette follows the owner's written description.
