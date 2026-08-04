# GeoBIM v2.0.0

GeoBIM is een statische browserapp voor:

1. IFC-georeferentie visueel controleren op een kaart;
2. BAG 2D-panden binnen een zelf getekend gebied ophalen;
3. 3DBAG-geometrie en hoogtedata laden;
4. panden lokaal verwijderen of terugzetten;
5. de exporthoogte per pand aanpassen;
6. de geselecteerde panden als geogerefereerd IFC4-contextmodel exporteren.

Er is geen server, database, npm-build of GitHub Action nodig. IFC-bestanden blijven lokaal in de browser. Alleen openbare kaart-, BAG- en 3DBAG-diensten worden via internet benaderd.

## Hoofdfuncties

### IFC-georeferentiecontrole

De app probeert de volgende informatie te herkennen:

- IFC4/IFC4.3 `IfcMapConversion` en `IfcMapConversionScaled`;
- IFC4.3 `IfcRigidOperation`;
- IFC2X3 `ePSet_MapConversion` en `ePSet_ProjectedCRS`;
- `IfcSite.RefLatitude`, `IfcSite.RefLongitude` en `RefElevation` als minder betrouwbare fallback;
- `IfcProjectedCRS`, EPSG-code, rotatie, schaal en `TrueNorth`.

De IFC-geometrie wordt lokaal met `web-ifc` gelezen. De app projecteert een contour van het model op de kaart. Een groene melding betekent dat een bruikbare native kaartconversie is gevonden. Een oranje melding betekent dat een fallback is gebruikt. De controle blijft visueel: de app kan niet zelfstandig bewijzen dat de door de modelleur ingevoerde landmeetkundige waarden inhoudelijk correct zijn.

Ingebouwde projecties:

- EPSG:28992 — Amersfoort / RD New;
- EPSG:7415 — RD New + NAP;
- EPSG:25831 en EPSG:25832;
- EPSG:32631 en EPSG:32632;
- EPSG:4326 en EPSG:3857.

### Exportgebied

Een exportgebied kan worden gemaakt als:

- cirkel door op de kaart te klikken;
- cirkel met RD X, RD Y en straal in meters;
- rechthoek door twee hoeken aan te klikken;
- vrije vorm door meerdere hoekpunten te tekenen.

Voor de cirkel kan ook het huidige kaartmiddelpunt of de positie van een geladen IFC worden overgenomen.

### BAG 2D en 3DBAG

- BAG 2D komt uit de officiële PDOK LV-BAG OGC API.
- 3DBAG komt uit de 3DBAG API en wordt als CityJSONFeature gelezen.
- De kaart toont BAG-contouren en een snelle 3D-massavoorvertoning.
- Bij IFC-export gebruikt de app waar beschikbaar de echte gekozen 3DBAG-LoD-geometrie, inclusief dakvlakken.
- Beschikbare LoD-keuzes: 1.2, 1.3 en 2.2.

### Panden aanpassen

Klik een BAG-pand op de kaart aan om:

- het pand lokaal uit de export te verwijderen;
- het pand terug te zetten;
- alleen voor deze export een andere gebouwhoogte op te geven;
- 3DBAG voor alleen dit pand op te halen.

De officiële BAG- en 3DBAG-bronnen worden nooit gewijzigd.

### IFC-export

De export wordt geschreven als IFC4 en bevat onder andere:

- `IfcProject` en `IfcSite`;
- één `IfcBuilding` per geëxporteerd BAG-pand;
- `IfcTriangulatedFaceSet`-geometrie;
- `IfcProjectedCRS` met EPSG:7415;
- `IfcMapConversion` met een lokale oorsprong in RD/NAP;
- BAG-identificatie, bron, LoD, status en exportinformatie als propertysets.

Panden met 3DBAG krijgen CityJSON-LoD-geometrie. Panden zonder 3DBAG krijgen een extrusie van de BAG 2D-contour met de ingestelde standaardhoogte.

## Belangrijk grensgedrag

De cirkel, rechthoek of vrije vorm is een **selectiegrens**. De app snijdt gebouwgeometrie niet letterlijk langs die grens door. Je kunt kiezen tussen:

- een volledig pand meenemen zodra het de selectie raakt;
- een pand alleen meenemen wanneer het geometrische middelpunt binnen de selectie ligt.

De IFC bestaat dus uit volledige gebouwen binnen de gekozen selectieregel. Dit voorkomt kapotte of open gebouwvolumes langs de grens.

## Grenzen en beveiligingen

Om de openbare API's en de browser niet onnodig te belasten:

- maximaal 3.000 BAG-panden per zoekopdracht;
- maximaal 1.200 gekoppelde 3DBAG-panden per gebiedsopdracht;
- maximaal 100 ontbrekende 3DBAG-panden automatisch ophalen tijdens één export;
- gebieden groter dan 100 km² worden geweigerd.

Maak het gebied kleiner wanneer een resultaatlimiet wordt bereikt.

## Publiceren met GitHub Pages

1. Pak de ZIP uit.
2. Upload alle bestanden uit de uitgepakte map naar de hoofdmap van de repository.
3. Ga naar **Settings → Pages**.
4. Kies **Deploy from a branch**.
5. Kies branch **main** en map **/(root)**.
6. Gebruik geen eigen GitHub Actions-workflow.
7. Wacht enkele minuten en ververs de website eventueel met `Ctrl+F5`.

De repository moet in de hoofdmap minimaal dit bevatten:

```text
index.html
style.css
app.js
core.js
.nojekyll
```

## Openbare bronnen

- PDOK BAG OGC API v2: https://api.pdok.nl/kadaster/bag/ogc/v2
- 3DBAG API: https://api.3dbag.nl
- 3DBAG documentatie: https://docs.3dbag.nl/nl/delivery/webservices/
- PDOK BGT OGC API: https://api.pdok.nl/lv/bgt/ogc/v1
- PDOK Kadastrale Kaart OGC API: https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1

## Bronvermelding en bibliotheken

- BAG: Kadaster / LV-BAG, Public Domain Mark 1.0.
- 3DBAG: 3D geoinformation research group TU Delft en 3DGI, CC BY 4.0.
- OpenStreetMap: © OpenStreetMap contributors.
- MapLibre GL JS.
- proj4js.
- web-ifc, MPL-2.0.
- earcut, ISC.

## Controle van het resultaat

Gebruik het gegenereerde IFC als contextmodel en controleer het vóór projectmatig gebruik in een tweede IFC-viewer. Controleer vooral:

- positie ten opzichte van luchtfoto, BGT en kadastrale kaart;
- hoogte ten opzichte van NAP/projectpeil;
- gekozen LoD;
- ontbrekende 3DBAG-panden die als eenvoudige extrusie zijn geëxporteerd;
- panden die de selectiegrens raken.
