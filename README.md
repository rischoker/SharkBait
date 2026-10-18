# Shark Bait 🦈

*Say it right… or feed the sharks.*

A classroom EFL game for the projector. Prisoners walk the plank one by one and each tells three versions of their story. Only one is proper English. The crew votes from their phones: if enough of them choose right (80% by default), the prisoner is saved. If not… the sharks are hungry.

- **Host screen** (projector): `https://<your-service>.onrender.com/`
- **Phones**: scan the QR code in the lobby (it opens `/play.html?room=CODE`), or type the 4-letter room code.

## How a round works

1. **Lobby** — Skull Island with the crew gathering on the beach as phones join. Each student picks a name, a pirate (Henry, Anne, Mako, Sharky, Bones, Rattles) and a clothes color.
2. **Set sail** — the camera flies to the ship and Captain Barbarossa explains the rules.
3. **Each prisoner** walks the plank and reads three sentences (read aloud with the browser's English voice if *Read aloud* is on).
4. **Vote** — phones show A / B / C. Students can change their answer until time runs out. Voting closes early when everybody has voted.
5. **Verdict** — the bar fills up to the crew's real percentage. Saved prisoners join the crew; the rest go to the shark.
6. **Round over** — grammar topics in green (strengths) or red (review in class), plus the top scorers. Each phone shows its own right answers, points and place.

Settings in the lobby: level (A1–C1 or Mixed), number of prisoners, voting time, score needed, captain's intro, sound, read aloud, and a demo crew of bots for testing without phones.

The sentence bank is in `public/bank.js` (24 trios per level). Add rows freely; the lobby counts them.

## Network (Render)

Built like Chicken Horde and Gato Swing so it works behind the academy proxy and on iPhones:

- One Express + Socket.IO server serves everything. All libraries are local in `public/vendor` (no CDNs), so only the Render domain has to be reachable.
- Socket.IO starts with HTTP long-polling and upgrades to WebSocket when allowed.
- Phones keep a client id: if the screen locks or the connection drops, they come back as the same pirate with their score.
- The host screen keeps its room for 3 minutes if it disconnects, and gets the same room code back after a server restart.
- `GET /healthz` for Render's health check.

### Deploy

1. On Render: **New → Blueprint**, pick this repo (it reads `render.yaml`), or **New → Web Service** with build `npm install` and start `npm start`.
2. Free plan works. The first visit after a while can take ~30 s while the service wakes up; open the host screen a minute before class.

Run locally: `npm install && npm run dev`, then open `http://localhost:3000`.

## Sounds (ElevenLabs)

The game plays these files from `public/assets/audio/` if they exist, and falls back to simple synth sounds if they don't:

| File | What it is |
|---|---|
| `sea-loop.mp3` | waves against the hull (loops in the background) |
| `splash.mp3` | prisoner falls into the sea |
| `bite.mp3` | shark bite |
| `cheer.mp3` | crew cheers (saved) |
| `groan.mp3` | crew groans (sharks) |
| `parrot.mp3` | Ernest the parrot |
| `fanfare.mp3` | saved sting |
| `doom.mp3` | sharks sting |
| `bell.mp3` | a pirate joins / voting opens |
| `tick.mp3` | last 5 seconds of the vote |
| `captain-intro.mp3` | Captain's rules speech |
| `captain-saved.mp3` | "Well spoken! Welcome to the crew, matey!" |
| `captain-doom.mp3` | "Walk the plank! Feed the sharks!" |

They were generated in the ElevenLabs flow **Shark Bait – sounds**: pick your favorite take of each, download it as MP3 and drop it in that folder with the name above.

## Credits

- 3D models: [Pirate Kit by Quaternius](https://poly.pizza/bundle/Pirate-kit-0q5ulmIYqQ) (CC0).
- Fonts: Pirata One and Baloo 2 (SIL Open Font License), see `public/vendor/fonts`.
- three.js r128 (MIT), Socket.IO (MIT), QR Code Generator by Kazuhiko Arase (MIT).
