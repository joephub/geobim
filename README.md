# GeoBIM IFC-georeferentiecontrole — versie 1.2.0

Statische webapp voor GitHub Pages. Geen npm, buildproces of eigen GitHub Actions nodig.

## Wijzigingen in 1.2.0

- De foutieve losse WMTS-tegel-URL's voor BGT en Kadastrale kaart zijn verwijderd.
- BGT en Kadastrale kaart worden nu via de officiële PDOK OGC API Vector Tiles en officiële WebMercator-stijlen geladen.
- Kaartfouten worden niet meer honderden keren identiek in de console geschreven.
- `app.js` en `style.css` hebben een versienummer in de URL, zodat een oude browsercache de update niet blijft tonen.
- De IFC- en georeferentielogica is verder ongewijzigd gebleven.

BGT en Kadastrale kaart zijn detailkaarten en worden vanaf zoomniveau 17 zichtbaar. Bij een geladen IFC zoomt de viewer normaal gesproken automatisch voldoende ver in.

## Bestaande GitHub-site bijwerken

1. Pak de ZIP uit.
2. Upload alle bestanden uit de uitgepakte map naar de hoofdmap van de repository `geobim`.
3. Bevestig dat GitHub de bestaande bestanden `index.html`, `style.css`, `app.js`, `README.md` en `UPLOADEN.txt` vervangt.
4. Commit de wijziging.
5. Laat **Settings → Pages → Deploy from a branch → main → /(root)** staan.
6. Wacht op de standaard Pages-publicatie.
7. Open de site opnieuw. In de titel moet `v1.2.0` staan.

## Werking

- De IFC blijft lokaal in de browser.
- De app leest onder meer `IfcMapConversion`, `IfcProjectedCRS` en `IfcSite`.
- Voor RD New worden EPSG:28992 en EPSG:7415 ondersteund.
- De IFC-geometrie wordt lokaal met web-ifc gelezen en als kaartcontour getoond.
- Een groene status betekent dat de app voldoende gegevens vond om het model te plaatsen. Het blijft een visuele controle; de app kan niet bewijzen dat de ingevoerde landmeetkundige uitgangspunten inhoudelijk juist zijn.

## Externe bronnen

De app laadt MapLibre GL JS, proj4js, web-ifc en openbare kaartdata via externe diensten. Daarom is internettoegang nodig.
