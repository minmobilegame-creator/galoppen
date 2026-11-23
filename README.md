# Galoppen

Et 3D-browserspil inspireret af Galoppen i Tivoli. Bygget med Vite, Three.js og TypeScript.

Rul kuglerne op ad banen og ram hullerne i det mørkegrønne V: gul giver 1 point, blå 2 og rød 3.
Din hest løber på den øverste bane mod tre computerheste. Første til 20 point vinder.

## Styring

- Hold venstre museknap nede på en kugle i nedre bane.
- Før hånden opad. Hånden når kun en tredjedel op ad den grønne bane.
- Slip knappen for at kaste. Farten kommer fra musens bevægelse de sidste 160 ms.

## Multiplayer (op til 4 spillere)

1. Tryk **Multiplayer**, skriv dit navn og tryk **Opret rum**. Du får en kode på 4 tegn.
2. Dine venner trykker **Multiplayer**, skriver deres navn og koden og trykker **Deltag**.
3. Alle trykker **Klar**. Værten (👑) trykker **Start løbet**. Tomme pladser bliver computerheste.
4. Hver spiller kaster på sit eget bræt. Din hest står øverst. Første til 20 point vinder, og alle ser vinderen.
5. Værten trykker **Tilbage til lobbyen** for en ny runde.

De hurtigste vindertider kommer på den globale **Top 10**.

### Sådan virker det

- **Supabase** står for login (anonymt, ét pr. fane), database og Realtime.
- Tabellerne er `rooms`, `players` og `highscores`, alle med Row Level Security.
- En spiller må kun opdatere sin egen række, og kun navn og klar-status.
- Point sendes kun gennem funktionen `record_score`. Den afviser ugyldige point, point der kommer for hurtigt efter hinanden og urealistisk hurtig scoring, og den afgør vinderen.
- Kun point går over nettet. Selve kuglerne simuleres lokalt hos hver spiller.
- Databasens opsætning ligger i [`supabase/migrations`](supabase/migrations).

## Udvikling

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # enhedstests af fysik, kast og væddeløb
npm run build
```

## Struktur

| Fil | Indhold |
|---|---|
| `src/game/layout.ts` | Bordets mål og de 16 huller (aflæst fra Blender-filen) |
| `src/game/physics.ts` | Ren 2D-fysik: hældning, friktion, bander, huller, kugle mod kugle |
| `src/game/throw.ts` | Kastets fart fra musebevægelsen |
| `src/game/race.ts` | Væddeløb, computerspillere og bedste tid |
| `src/render/scene.ts` | Three.js-scenen |
| `src/ui/scoreboard.ts` | Scoretavlen med animerede 3D-heste |
| `src/ui/lobby.ts` | Lobby og top 10 |
| `src/net/` | Supabase-klient og multiplayer-synkronisering |
| `public/models/*.glb` | Bræt, huller, kugle og hest (med galop-loop), eksporteret fra Blender |
| `assets/blender/galoppen_assets.blend` | Blender-kilden til alle modeller |
| `docs/previews/` | Forhåndsvisninger af modellerne |
| `docs/playtest-rapport.md` | Rapport fra automatisk playtest i Chrome |

Fysikken kører i 2D på bordet (meter, 1 m ≈ 100 px), mens visningen er 3D.

Push til `main` bygger og deployer automatisk til GitHub Pages.
