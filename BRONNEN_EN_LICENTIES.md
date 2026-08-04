# Bronnen en licenties

## BAG 2D

GeoBIM vraagt pandgeometrie op via de PDOK Basisregistratie Adressen en Gebouwen OGC API v2.

- Aanbieder: Kadaster / LV-BAG
- Dienst: `https://api.pdok.nl/kadaster/bag/ogc/v2`
- Licentie: Public Domain Mark 1.0

De API-selectie gebruikt eerst de omhullende rechthoek van de getekende vorm. GeoBIM filtert het resultaat daarna lokaal op de echte cirkel, rechthoek of vrije contour. Alleen passende panden worden in de browsersessie bewaard en getoond.

## Adreszoeker

- Aanbieder: Kadaster / PDOK
- Dienst: `https://api.pdok.nl/kadaster/location-api/v1/search`
- Collectie: adres
- Licentie: CC BY 4.0
- Authenticatie: niet vereist

## 3DBAG

GeoBIM gebruikt uitsluitend de officiële 3DBAG API.

- Dienst: `https://api.3dbag.nl`
- Endpoint per pand: `https://api.3dbag.nl/collections/pand/items/{BAG-identificatie}`
- Formaat: CityJSONFeature
- CRS: EPSG:7415 — Amersfoort / RD New + NAP height
- Makers: 3D geoinformation research group TU Delft en 3DGI
- Licentie: CC BY 4.0
- Bronvermelding: 3DBAG © TU Delft 3D Geoinformation group en 3DGI, CC BY 4.0

### Selectiegedrag

GeoBIM gebruikt voor 3DBAG geen bounding-boxdownload. Na het laden en contourfilteren van BAG 2D wordt ieder niet-verwijderd pand afzonderlijk op BAG-identificatie opgevraagd. Daardoor wordt geen 3D-geometrie gedownload van gebouwen die buiten de echte getekende contour vallen maar wel in de omhullende rechthoek liggen.

### Afgeschermde serverfunctie

GeoBIM v2.4.0 gebruikt geen AllOrigins, CORSproxy.nl, CorsProxy.io of vergelijkbare generieke tussenservice. De browser vraagt alleen een eigen route onder `/api/3dbag/building/{BAG-id}` op. De meegeleverde Cloudflare Pages Function controleert de BAG-identificatie en vraagt vervolgens precies dat ene pand op bij `api.3dbag.nl`. De functie is geen algemene proxy en accepteert geen willekeurige externe URL. IFC-bestanden, lokale wijzigingen en IFC-exportdata worden niet naar de bron gestuurd.

## Kaarten

- OpenStreetMap: © OpenStreetMap contributors
- PDOK luchtfoto
- PDOK BGT OGC API en officiële stijl
- PDOK Kadastrale Kaart OGC API en officiële stijl

## JavaScript-bibliotheken

De app laadt vastgepinde versies via openbare CDN's:

- MapLibre GL JS 5.6.1
- proj4 2.15.0
- web-ifc 0.0.77 — MPL-2.0
- earcut 3.0.2 — ISC

De bibliotheken zijn niet opgenomen in deze repository; hun eigen licentievoorwaarden blijven van toepassing.
