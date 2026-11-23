# Galoppen

Et 3D-browserspil inspireret af Galoppen i Tivoli. Bygget med Vite, Three.js og TypeScript.

Rul kuglerne op ad banen og ram hullerne i det mørkegrønne V: gul giver 1 point, blå 2 og rød 3.
Din hest løber på den øverste bane mod tre computerheste. Første til 20 point vinder.

## Styring

- Hold venstre museknap nede på en kugle i nedre bane.
- Før hånden opad. Hånden når kun en tredjedel op ad den grønne bane.
- Slip knappen for at kaste. Farten kommer fra musens bevægelse de sidste 160 ms.

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
| `src/ui/scoreboard.ts` | Scoretavlen med heste |
| `public/models/playfield.glb` | Bordet, eksporteret fra Blender |

Fysikken kører i 2D på bordet (meter, 1 m ≈ 100 px), mens visningen er 3D.

Push til `main` bygger og deployer automatisk til GitHub Pages.
