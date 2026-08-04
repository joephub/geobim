# Bronnen en licenties

## BAG 2D

GeoBIM vraagt pandgeometrie op via de PDOK Basisregistratie Adressen en Gebouwen OGC API v2.

- Aanbieder: Kadaster / LV-BAG
- Dienst: `https://api.pdok.nl/kadaster/bag/ogc/v2`
- Licentie: Public Domain Mark 1.0
- Actualisatie: dagelijks volgens de PDOK-dienstbeschrijving

## 3DBAG

GeoBIM vraagt individuele gebouwen of gebouwen binnen een bounding box op via de 3DBAG API. De 3D-geometrie wordt geleverd als CityJSONFeature in EPSG:7415.

- Dienst: `https://api.3dbag.nl`
- Makers: 3D geoinformation research group TU Delft en 3DGI
- Licentie: CC BY 4.0
- Verplichte bronvermelding: 3DBAG © TU Delft 3D Geoinformation group en 3DGI, CC BY 4.0

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
