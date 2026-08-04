# GeoBIM v2.1.0

GeoBIM is een statische browserapp voor:

1. IFC-georeferentie visueel controleren op een kaart;
2. een exportgebied tekenen als vrije vorm, rechthoek of cirkel;
3. BAG 2D-panden binnen dat gebied ophalen;
4. 3DBAG-geometrie en hoogtedata laden;
5. panden lokaal verwijderen, terugzetten of van een andere exporthoogte voorzien;
6. de geselecteerde panden als geogerefereerd IFC4-contextmodel exporteren.

Er is geen server, database, npm-build of GitHub Action nodig. IFC-bestanden blijven lokaal in de browser. Alleen openbare kaart-, adres-, BAG- en 3DBAG-verzoeken worden via internet uitgevoerd.

## Nieuw in v2.1.0

- Nieuwe, compacte tekengereedschappen met pictogrammen voor vrije vorm, rechthoek en cirkel.
- Vrije vorm heeft uitsluitend **Start** en **Stop**.
- Rechthoek wordt direct met twee kaartklikken getekend.
- Cirkel vraagt alleen om een straal en een middelpunt op de kaart.
- De technische RD-invoervelden en overige cirkelknoppen zijn verwijderd.
- Boven de kaart staat een adres- en postcodezoeker op basis van de actuele PDOK Location API.
- 3DBAG wordt via drie automatische CORS-compatibiliteitsroutes geprobeerd; rechtstreeks ophalen is alleen de laatste terugval. Hierdoor loopt de statische GitHub Pages-site niet direct vast op een browserblokkade van de 3DBAG API.
- 3DBAG wordt in kleine pagina's opgehaald om grote CityJSON-antwoorden beter verwerkbaar te houden.

## IFC-georeferentiecontrole

De app probeert onder andere de volgende informatie te herkennen:

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

## Adres zoeken

De zoekbalk boven de kaart gebruikt de PDOK Location API. Typ minimaal drie tekens van een adres of postcode. Kies een resultaat om de kaart naar die locatie te verplaatsen. De adreszoeker verandert de exportselectie niet automatisch.

## Exportgebied tekenen

### Vrije vorm

1. Klik op het pictogram voor vrije vorm.
2. Klik op **Start**.
3. Klik de gewenste hoekpunten op de kaart.
4. Klik op **Stop**.

### Rechthoek

1. Klik op het rechthoekpictogram.
2. Klik twee tegenoverliggende hoeken op de kaart.

### Cirkel

1. Klik op het cirkelpictogram.
2. Vul de straal in meters in.
3. Klik op **Kies middelpunt op kaart**.
4. Klik het middelpunt aan.

Met `Esc` wordt een actieve tekenactie geannuleerd. Het prullenbakpictogram verwijdert het getekende exportgebied.

## BAG 2D en 3DBAG

- BAG 2D komt uit de officiële PDOK LV-BAG OGC API.
- 3DBAG komt uit de 3DBAG API en wordt als CityJSONFeature gelezen.
- Beschikbare LoD-keuzes zijn 1.2, 1.3 en 2.2.
- De kaart toont BAG-contouren en een snelle 3D-massavoorvertoning.
- Bij IFC-export gebruikt de app waar beschikbaar de echte gekozen 3DBAG-LoD-geometrie, inclusief dakvlakken.

### Browsertoegang tot 3DBAG

De 3DBAG API kan vanuit een statische website door het CORS-beleid van de browser worden geblokkeerd. Daarom probeert GeoBIM de aanvraag via AllOrigins, CORSproxy.nl en CorsProxy.io uit te voeren. Rechtstreeks ophalen is alleen de laatste poging wanneer de browser dit inmiddels toestaat. Alleen de openbare 3DBAG-URL met het zoekgebied of BAG-ID gaat via deze route. IFC-bestanden, lokale bewerkingen en gegenereerde IFC-data worden niet verstuurd.

Deze gratis tussenroutes zijn externe diensten. Hun bereikbaarheid kan niet door GeoBIM worden gegarandeerd. Bij een grote selectie is een kleiner gebied betrouwbaarder en sneller.

## Panden aanpassen

Klik een BAG-pand op de kaart aan om:

- het pand lokaal uit de export te verwijderen;
- het pand terug te zetten;
- alleen voor deze export een andere gebouwhoogte op te geven;
- 3DBAG voor alleen dit pand op te halen.

De officiële BAG- en 3DBAG-bronnen worden nooit gewijzigd.

## IFC-export

De export wordt geschreven als IFC4 en bevat onder andere:

- `IfcProject` en `IfcSite`;
- één `IfcBuilding` per geëxporteerd BAG-pand;
- `IfcTriangulatedFaceSet`-geometrie;
- `IfcProjectedCRS` met EPSG:7415;
- `IfcMapConversion` met een lokale oorsprong in RD/NAP;
- BAG-identificatie, bron, LoD, status en exportinformatie als propertysets.

Panden met 3DBAG krijgen CityJSON-LoD-geometrie. Panden zonder 3DBAG krijgen een extrusie van de BAG 2D-contour met de ingestelde standaardhoogte.

## Gedrag aan de selectiegrens

De getekende vorm is een **selectiegrens**. Gebouwgeometrie wordt niet letterlijk langs de cirkel, rechthoek of vrije vorm doorgesneden. Je kunt kiezen tussen:

- een volledig pand meenemen zodra het de selectie raakt;
- een pand alleen meenemen wanneer het geometrische middelpunt binnen de selectie ligt.

Hierdoor bevat de IFC volledige en gesloten gebouwen in plaats van open volumes langs de grens.

## Grenzen en beveiligingen

- maximaal 3.000 BAG-panden per zoekopdracht;
- maximaal 1.200 gekoppelde 3DBAG-panden per gebiedsopdracht;
- maximaal 100 ontbrekende 3DBAG-panden automatisch ophalen tijdens één export;
- gebieden groter dan 100 km² worden geweigerd.

Maak het gebied kleiner wanneer een resultaatlimiet wordt bereikt of 3DBAG te lang nodig heeft.

## Publiceren met GitHub Pages

1. Pak de ZIP uit.
2. Upload alle bestanden uit de uitgepakte map naar de hoofdmap van de repository.
3. Laat bestaande bestanden met dezelfde naam vervangen.
4. Ga naar **Settings → Pages**.
5. Kies **Deploy from a branch**.
6. Kies branch **main** en map **/(root)**.
7. Gebruik geen eigen GitHub Actions-workflow.
8. Wacht enkele minuten en ververs de website eventueel met `Ctrl+F5`.

De hoofdmap bevat minimaal:

```text
index.html
style.css
app.js
core.js
.nojekyll
```

## Openbare bronnen

- PDOK BAG OGC API v2: `https://api.pdok.nl/kadaster/bag/ogc/v2`
- PDOK Location API: `https://api.pdok.nl/kadaster/location-api/v1`
- 3DBAG API: `https://api.3dbag.nl`
- 3DBAG-documentatie: `https://docs.3dbag.nl/nl/delivery/webservices/`
- PDOK BGT OGC API: `https://api.pdok.nl/lv/bgt/ogc/v1`
- PDOK Kadastrale Kaart OGC API: `https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1`

## Bronvermelding en bibliotheken

- BAG: Kadaster / LV-BAG, Public Domain Mark 1.0.
- 3DBAG: 3D geoinformation research group TU Delft en 3DGI, CC BY 4.0.
- OpenStreetMap: © OpenStreetMap contributors.
- MapLibre GL JS.
- proj4js.
- web-ifc, MPL-2.0.
- earcut, ISC.

## Controle van het resultaat

Gebruik het gegenereerde IFC als contextmodel en controleer het vóór projectmatig gebruik in een tweede IFC-viewer. Controleer vooral positie, NAP-hoogte, gekozen LoD, eenvoudige 2D-extrusies en de panden die de selectiegrens raken.
