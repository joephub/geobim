# GeoBIM publiceren vanuit GitHub via Cloudflare Pages

Deze versie gebruikt GitHub als bronrepository en Cloudflare Pages als websitehost. Dat is nodig omdat 3DBAG een kleine serverfunctie gebruikt.

## 1. Bestanden naar GitHub uploaden

1. Pak de ZIP uit.
2. Open de GitHub-repository `geobim`.
3. Kies **Code → Add file → Upload files**.
4. Upload alle bestanden en mappen uit de uitgepakte map naar de hoofdmap van de repository.
5. Controleer vooral dat dit in de repository staat:

```text
public/
  index.html
  app.js
  core.js
  style.css
  _routes.json
functions/
  api/
    3dbag/
      health.js
      building/
        [bagId].js
```

6. Laat bestaande bestanden met dezelfde naam vervangen.
7. Commit de wijzigingen.

## 2. Cloudflare-account openen

1. Open Cloudflare en log in of maak een gratis account.
2. Ga naar **Workers & Pages**.
3. Kies **Create application**.
4. Kies **Pages**.
5. Kies de optie om een bestaande Git-repository te verbinden.
6. Verbind GitHub en selecteer de repository `geobim`.

Gebruik Git-integratie. De knop voor een rechtstreekse bestandsupload is niet geschikt voor deze versie, omdat Cloudflare Pages Functions daarbij niet wordt meegenomen.

## 3. Buildinstellingen

Gebruik deze waarden:

```text
Production branch: main
Framework preset: None
Build command: exit 0
Build output directory: public
Root directory: leeg laten
```

Er is geen npm-installatie of buildproces nodig. `exit 0` vertelt Cloudflare dat de bestaande bestanden direct mogen worden gepubliceerd.

## 4. Publiceren

1. Kies **Save and Deploy**.
2. Wacht tot de deployment groen is.
3. Open de URL die eindigt op `.pages.dev`.
4. Controleer dat bovenaan `v2.4.0` staat.
5. Teken een klein gebied rond enkele gebouwen.
6. Kies **BAG 2D binnen contour laden**.
7. Kies daarna **3DBAG binnen contour laden**.

## 5. Controleren of de serverfunctie werkt

Open achter de `pages.dev`-domeinnaam:

```text
/api/3dbag/health
```

Een werkende installatie geeft ongeveer dit terug:

```json
{"ok":true,"service":"GeoBIM 3DBAG-service","upstream":"api.3dbag.nl"}
```

## 6. Oude GitHub Pages-site

De repository mag in GitHub blijven staan. GitHub Pages is voor deze versie niet nodig. Je kunt de oude GitHub Pages-publicatie uitschakelen via:

```text
Repository → Settings → Pages → Unpublish site
```

De `pages.dev`-URL is daarna de werkende GeoBIM-website. Later kan daar ook een eigen domein aan worden gekoppeld.

## 7. Nieuwe versies publiceren

Na de eenmalige koppeling is alleen nog dit nodig:

1. nieuwe bestanden naar de GitHub-repository uploaden;
2. committen;
3. Cloudflare Pages publiceert de wijziging automatisch.
