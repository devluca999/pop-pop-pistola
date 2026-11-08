# Custom music (optional)

The game synthesizes all of its music procedurally. To replace a track with your own
recording, drop a file here with one of these exact names:

| File                         | Used for                          | Playback  |
|------------------------------|-----------------------------------|-----------|
| `title.mp3` / `title.ogg`    | Title / menu screen               | looped    |
| `duel.mp3` / `duel.ogg`      | Duel standoff (keep it quiet!)    | looped    |
| `win.mp3` / `win.ogg`        | Victory stinger                   | one-shot  |
| `lose.mp3` / `lose.ogg`      | Defeat stinger                    | one-shot  |

- `.mp3` is tried first, then `.ogg`. Missing files are fine; that track stays procedural.
- Files are probed once when audio is unlocked (first click/tap). The server must send an
  `audio/*` content type.
- Loops should be trimmed to loop cleanly. Master at a moderate level: music sits under SFX.
- Only use music you have the rights to, and list it in `CREDITS.md`
  (committed samples must be CC0).
