# GeoBIM v2.4.0

GeoBIM is een browserapp voor:

1. IFC-georeferentie visueel controleren op een kaart;
2. een exportgebied tekenen als vrije vorm, rechthoek of cirkel;
3. BAG 2D-panden exact op die contour selecteren;
4. uitsluitend voor die geselecteerde BAG-panden 3DBAG-geometrie ophalen;
5. panden lokaal verwijderen, terugzetten of een andere exporthoogte geven;
6. de selectie als geogerefereerd IFC4-contextmodel exporteren.

IFC-bestanden en lokale bewerkingen blijven in de browser. De app verstuurt geen IFC-bestanden naar een server.

## Waarom v2.4.0 anders wordt gepubliceerd

De officiële 3DBAG API levert de juiste data, maar de API staat niet toe dat een willekeurige website het antwoord rechtstreeks met JavaScript uitleest. Dat is een browserbeperking rond CORS. Een puur statische GitHub Pages-site kan dit niet oplossen.

Daarom bevat deze versie een kleine, afgeschermde Cloudflare Pages Function:

- de website vraagt een BAG-pand op via hetzelfde domein als de app;
- de serverfunctie vraagt dat ene pand op bij `api.3dbag.nl`;
- de functie accepteert alleen geldige BAG-pandidentificaties;
- het is geen algemene open proxy;
- openbare CORS-proxy's worden niet gebruikt;
- Windows Defender hoeft daardoor geen algemene proxy-domeinen meer te blokkeren.

De broncode blijft gewoon in GitHub. Cloudflare Pages publiceert dezelfde GitHub-repository en voert alleen de meegeleverde map `functions` uit.

## Selectie binnen de getekende contour

De BAG API wordt eerst met de omhullende rechthoek van het getekende gebied bevraagd. Daarna filtert GeoBIM de ontvangen BAG-geometrie lokaal op de echte cirkel, rechthoek of vrije vorm.

Je kunt kiezen uit:

- **Alleen panden volledig binnen de contour** — standaard en strengste optie;
- **Middelpunt binnen de contour**;
- **Ook panden die de contour raken**.

Bij een nieuwe contour of een gewijzigde selectieregel wordt de bestaande BAG/3DBAG-selectie gewist. Daardoor kunnen geen oude panden uit een eerdere selectie blijven staan.

3DBAG wordt vervolgens per overgebleven BAG-identificatie opgehaald. Er wordt dus geen 3DBAG-bounding-boxdownload gedaan en geen 3D-gebouw buiten de gefilterde selectie aangevraagd.

## 3DBAG API

De officiële 3DBAG API ondersteunt onder andere:

- één gebouw via een BAG-pandidentificatie;
- alle gebouwen in een bounding box;
- CityJSONFeature als 3D-resultaat;
- LoD 1.2, LoD 1.3 en LoD 2.2.

GeoBIM gebruikt bewust de aanvraag per BAG-pandidentificatie, omdat daarmee de getekende contour nauwkeurig kan worden gevolgd.

## IFC-georeferentiecontrole

De app probeert onder andere te herkennen:

- IFC4/IFC4.3 `IfcMapConversion` en `IfcMapConversionScaled`;
- IFC4.3 `IfcRigidOperation`;
- IFC2X3 `ePSet_MapConversion` en `ePSet_ProjectedCRS`;
- `IfcSite.RefLatitude`, `IfcSite.RefLongitude` en `RefElevation` als fallback;
- `IfcProjectedCRS`, EPSG-code, rotatie, schaal en `TrueNorth`.

De IFC-geometrie wordt lokaal met `web-ifc` gelezen. De kaartcontour wordt als vlakke XY-projectie opgebouwd. Z wordt apart gecontroleerd, maar kan de 2D-contour niet verbergen.

Ingebouwde projecties:

- EPSG:28992 — Amersfoort / RD New;
- EPSG:7415 — RD New + NAP;
- EPSG:25831 en EPSG:25832;
- EPSG:32631 en EPSG:32632;
- EPSG:4326 en EPSG:3857.

## IFC-export

De export is IFC4 en bevat onder andere:

- `IfcProject` en `IfcSite`;
- één `IfcBuilding` per geëxporteerd BAG-pand;
- `IfcTriangulatedFaceSet`-geometrie;
- `IfcProjectedCRS` met EPSG:7415;
- `IfcMapConversion` met een lokale oorsprong in RD/NAP;
- BAG-identificatie, bron, LoD, status en exportinformatie als propertysets.

Panden met 3DBAG krijgen CityJSON-LoD-geometrie. Panden zonder 3DBAG krijgen een extrusie van de BAG 2D-contour met de ingestelde standaardhoogte. Wanneer de 3DBAG-service tijdens export niet bereikbaar is, gaat de IFC-export dus alsnog door met BAG-extrusies.

## Grenzen

- maximaal 3.000 BAG-panden per BAG-opdracht;
- maximaal 400 panden per gerichte 3DBAG-opdracht;
- maximaal 100 ontbrekende 3DBAG-panden automatisch ophalen tijdens één IFC-export;
- gebieden groter dan 100 km² worden geweigerd.

## Publiceren

Lees `PUBLICEREN_VIA_CLOUDFLARE_PAGES.md`.

Belangrijk:

- upload de bestanden naar je GitHub-repository;
- koppel die repository daarna aan Cloudflare Pages;
- gebruik in Cloudflare **Git-integratie**, niet Direct Upload;
- zet de buildopdracht op `exit 0`;
- zet de build output directory op `public`;
- gebruik daarna de `pages.dev`-URL van Cloudflare.

De oude `github.io`-URL kan de statische onderdelen tonen, maar kan de serverfunctie voor 3DBAG niet uitvoeren.

## Bronnen

- PDOK BAG OGC API v2: `https://api.pdok.nl/kadaster/bag/ogc/v2`
- PDOK Location API: `https://api.pdok.nl/kadaster/location-api/v1`
- 3DBAG API: `https://api.3dbag.nl`
- 3DBAG-documentatie: `https://docs.3dbag.nl/nl/delivery/webservices/`
- PDOK BGT OGC API: `https://api.pdok.nl/lv/bgt/ogc/v1`
- PDOK Kadastrale Kaart OGC API: `https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1`

## Licenties

- BAG: Kadaster / LV-BAG, Public Domain Mark 1.0.
- 3DBAG: 3D geoinformation research group TU Delft en 3DGI, CC BY 4.0.
- OpenStreetMap: © OpenStreetMap contributors.
- MapLibre GL JS.
- proj4js.
- web-ifc, MPL-2.0.
- earcut, ISC.

Controleer een gegenereerd IFC vóór projectmatig gebruik in een tweede IFC-viewer, vooral op positie, NAP-hoogte, gekozen LoD en het toegepaste grensgedrag.
