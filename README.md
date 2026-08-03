# GeoBIM IFC-georeferentiecontrole

Statische webapp voor GitHub Pages. Geen npm, buildproces of GitHub Actions nodig.

## Publiceren

1. Maak een lege openbare GitHub-repository met de naam `geobim`.
2. Upload `index.html`, `style.css`, `app.js` en `README.md` naar de hoofdmap.
3. Open **Settings → Pages**.
4. Kies **Deploy from a branch**.
5. Kies **main** en **/(root)** en klik op **Save**.
6. Open na enkele minuten `https://JOUWNAAM.github.io/geobim/`.

## Werking

- De IFC blijft lokaal in de browser.
- De app leest onder meer `IfcMapConversion`, `IfcProjectedCRS` en `IfcSite`.
- Voor RD New worden EPSG:28992 en EPSG:7415 ondersteund.
- De IFC-geometrie wordt lokaal met web-ifc gelezen en als kaartcontour getoond.
- Een groene status betekent dat de app voldoende gegevens vond om het model te plaatsen. Het blijft een visuele controle; de app kan niet bewijzen dat de modelleur de juiste landmeetkundige uitgangspunten heeft gebruikt.

## Externe bibliotheken

De app laadt MapLibre GL JS, proj4js en web-ifc via openbare CDN's. Daardoor heeft de website internettoegang nodig.
