# Bronnen en licenties

## BAG 2D

GeoBIM vraagt pandgeometrie op via de PDOK Basisregistratie Adressen en Gebouwen OGC API v2.

- Aanbieder: Kadaster / LV-BAG
- Dienst: `https://api.pdok.nl/kadaster/bag/ogc/v2`
- Licentie: Public Domain Mark 1.0
- Actualisatie: dagelijks volgens de PDOK-dienstbeschrijving

## Adreszoeker

De adres- en postcodezoeker gebruikt de PDOK Location API.

- Aanbieder: Kadaster / PDOK
- Dienst: `https://api.pdok.nl/kadaster/location-api/v1/search`
- Geactiveerde collectie: `adres`, versie 1
- Licentie: CC BY 4.0
- Authenticatie: niet vereist

## 3DBAG

GeoBIM vraagt individuele gebouwen of gebouwen binnen een bounding box op via de 3DBAG API. De 3D-geometrie wordt geleverd als CityJSONFeature in EPSG:7415.

- Dienst: `https://api.3dbag.nl`
- Makers: 3D geoinformation research group TU Delft en 3DGI
- Licentie: CC BY 4.0
- Verplichte bronvermelding: 3DBAG © TU Delft 3D Geoinformation group en 3DGI, CC BY 4.0

### CORS-compatibiliteit voor GitHub Pages

De 3DBAG API kan vanuit een statische browserapp door CORS worden geblokkeerd. GeoBIM probeert daarom automatisch:

1. AllOrigins raw: `https://api.allorigins.win/raw`;
2. CORSproxy.nl: `https://corsproxy.nl`;
3. CorsProxy.io: `https://corsproxy.io`;
4. rechtstreeks via `https://api.3dbag.nl` als laatste terugval.

Deze diensten ontvangen alleen de openbare 3DBAG-aanvraag-URL met een bounding box of BAG-identificatie. IFC-bestanden, lokale wijzigingen en geëxporteerde IFC-bestanden worden niet via deze diensten verstuurd. Het zijn externe gratis diensten; beschikbaarheid en gebruiksvoorwaarden kunnen veranderen.

## Kaarten

- OpenStreetMap: © OpenStreetMap contributors
- PDOK luchtfoto
- PDOK BGT OGC API en officiële Mapbox-stijl
- PDOK Kadastrale Kaart OGC API en officiële Mapbox-stijl

## JavaScript-bibliotheken

De app laadt vastgepinde versies via openbare CDN's:

- MapLibre GL JS 5.6.1
- proj4 2.15.0
- web-ifc 0.0.77 — MPL-2.0
- earcut 3.0.2 — ISC

De bibliotheken zijn niet opgenomen in deze repository; hun eigen licentievoorwaarden blijven van toepassing.
