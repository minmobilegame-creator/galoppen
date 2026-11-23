# Playtest-rapport: Galoppen i Chrome

Spillet blev testet i Chrome (Claude in Chrome) på `localhost:5173`, med skærmbilleder, konsol, netværk og kast gennem pointer-events. Hvert kast startede på kuglens plads og varede 160 ms.

## Første kørsel

- **Konsol:** ingen fejl eller advarsler fra spillet.
- **Netværk:** `board.glb`, `holes.glb`, `ball.glb` og `horse.glb` svarede alle med 200.

### De 5 vigtigste problemer

| # | Problem | Type | Hvad vi så |
|---|---|---|---|
| 1 | **Kastet var ustabilt og alt for følsomt.** | Styring | Ens bevægelser gav meget forskellig fart (0,30–0,36 m gav 2,1 m/s én gang og 6,0 m/s en anden). Et ryk på ca. 50 px var nok til at nå de røde huller, og de fleste kast ramte toppen af banen. Det skyldtes få og tætte musepunkter i målevinduet. |
| 2 | **Bunden af hullerne glimtede og så støjet ud.** | Visuelt | Bunden af hver kop var glat-skygget sammen med væggen og havde lav ruhed. Det gav prikker og glimt fra omgivelseslyset. |
| 3 | **Markørringen blev vist overalt**, også uden for bordet. | Styring | Ringen fulgte musen ud på den mørke baggrund, og der var ingen forskel på, om en kugle kunne samles op eller ej. |
| 4 | **Grænsen for hånden var næsten usynlig.** | Styring | Den stiplede linje havde 25 % opacitet. Når kuglen slap af sig selv ved grænsen, virkede det tilfældigt. |
| 5 | **Lyset var fladt.** | Visuelt | Den lyse grønne bane og den hvide nedre bane var lige lyse overalt. Der var ingen dybde mod pointfeltet, og nedre bane så udbrændt ud. |

## Rettelser

1. Fartmålingen tager nu punktet lige før vinduet med og kræver mindst 40 ms data. Hvis musen holdes stille, tæller stilstanden med. Kastet ganges desuden med 0,6, så et naturligt ryk på 100–150 px rammer pointfeltet. To nye enhedstests dækker dette.
2. I Blender er bunden af hullerne nu flad-skygget (væggene er stadig glatte), og ruheden er hævet til 0,4. `holes.glb` er eksporteret igen.
3. Ringen vises kun på bordet inden for håndens rækkevidde. Den lyser op, og musen bliver til en "grab"-hånd, når man er over en kugle, der kan samles op.
4. Grænselinjen har nu 50 % opacitet og bliver gul og tydelig, mens man holder en kugle. Feltet under den er svagt tonet.
5. Et varmt spotlys over pointfeltet og et svagere himmellys giver en gradient fra hullerne ned mod spilleren.

## Anden kørsel

- **Konsol:** ingen fejl.
- **Kast:** ens bevægelser giver nu samme fart (0,6 m → 2,10 m/s begge gange). Farten stiger jævnt med bevægelsen: 0,55 m → 1,8–2,0 m/s, 0,65 m → 2,3 m/s og 0,70 m → 2,4 m/s.
- **Point:** 5 af 8 kast gav point, alle i den nederste del af V'et. De røde huller kræver nu et mere præcist og længere kast.
- **Mobil (420 px):** scoretavlen ligger øverst og bordet nedenunder. Begge kan bruges, men bordet er lille.

## Kendte, mindre ting

- En kugle, der ruller lige tilbage ned ad midten, falder ofte i det nederste gule hul (`Hole_Yellow_07`). Det minder om den rigtige Galoppen, men kan justeres med `captureSpeed`.
- På smalle skærme er bordet lille. Kameraet kan zoome tættere på og panorere, hvis det ønskes.
