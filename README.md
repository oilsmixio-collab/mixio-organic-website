# Mixio Organic — website

Website (HTML/CSS/JS-frontend + kleine Python/Flask-backend) voor Mixio Organic.

## Bestanden
- `index.html` — homepage (funnel-opbouw rond de Hair Food + Grow: herkenning → oplossing → vergelijking → voordelen → werkwijze → reviews → bestellen → FAQ)
- `producten.html` — productpagina Hair Food + Grow (met "Toevoegen aan winkelwagen" en de "koop 2, ontvang 10% korting"-actie)
- `cart.html` — winkelwagen: overzicht van toegevoegde producten, aantal aanpassen/verwijderen, subtotaal
- `checkout.html` — afrekenen: klantgegevens + besteloverzicht, stuurt door naar Mollie om te betalen
- `bedankt.html` — bedankpagina waar Mollie de klant na betaling naar terugstuurt
- `diensten.html` — salonbehandelingen (Scalp Treatment, Head Spa, Natuurlijk Verven)
- `contact.html` — over ons + contactformulier
- `css/style.css` — alle styling
- `js/script.js` — navigatie, scroll-animaties, promobanner/pop-up, winkelwagenlogica, checkout-/contactformulier-logica
- `app.py` — Flask-server: serveert de site én het `/api/checkout`-endpoint dat de Mollie-betaling aanmaakt
- `.env` — bevat `MOLLIE_API_KEY` (nooit in git zetten, staat al in `.gitignore`)
- `requirements.txt` — Python-dependencies (flask, requests, python-dotenv)

De "Toevoegen aan winkelwagen"-knop op `producten.html` heeft `data-product`/`data-size`-attributen, zodat `js/script.js` de juiste gegevens in de winkelwagen (localStorage) opslaat. Het winkelwagen-icoon met teller in de header (alle pagina's) linkt naar `cart.html`. Wil je later meer producten toevoegen, kopieer dan de product-detail-structuur uit `producten.html` naar een nieuwe pagina, en voeg de prijs toe aan de `PRICES`-dict in `app.py` — de winkelwagen ondersteunt meerdere producten/varianten naast elkaar, ook al bevat de catalogus nu maar 1 product.

## Lokaal bekijken (met werkende Mollie-koppeling)
```
pip install -r requirements.txt
python3 app.py
```
en ga naar `http://localhost:5050`. Dit start zowel de site als het checkout-endpoint op dezelfde server/poort.

(Poort 5000, de Flask-standaard, wordt op macOS meestal al gebruikt door de AirPlay Receiver — vandaar 5050.)

(De oude manier — `python3 -m http.server` — laat de site nog zien, maar dan werkt "Bestelling plaatsen" niet: die heeft het Flask-endpoint nodig.)

## Winkelwagen, afrekenen & Mollie
De volledige flow werkt nu end-to-end: product toevoegen (`producten.html`) → winkelwagen bekijken/bewerken (`cart.html`) → afrekenen (`checkout.html`) → betalen bij Mollie → terug naar `bedankt.html`. De winkelwagen zelf wordt lokaal in de browser bijgehouden (`localStorage`); er is geen eigen orderdatabase.

Bij het klikken op "Bestelling plaatsen" stuurt de browser de winkelwagen-inhoud naar `POST /api/checkout` in `app.py`. Die server:
1. Herberekent de prijs zelf aan de hand van de `PRICES`-dict (de prijs die de browser meestuurt wordt genegeerd, zodat een bezoeker die niet kan manipuleren) en past automatisch 10% korting toe als een productregel 2 of meer stuks bevat (`DISCOUNT_RATE`/`DISCOUNT_MIN_QTY` bovenin `app.py`).
2. Maakt de betaling aan bij Mollie met de geheime API-key uit `.env` (deze key komt nooit in de browser/JS terecht).
3. Stuurt de `checkoutUrl` terug, waar de browser de klant naartoe stuurt om te betalen.

De "koop 2, ontvang 10% korting"-actie is dus écht geautomatiseerd: dezelfde regel (`DISCOUNT_RATE = 0.10`, `DISCOUNT_MIN_QTY = 2`) zit zowel in `js/script.js` (voor de weergave in winkelwagen/afrekenen) als in `app.py` (voor het daadwerkelijk bij Mollie in rekening gebrachte bedrag) — die twee moeten in de pas blijven lopen als je de actie ooit aanpast.

**Status: TEST-modus.** De key in `.env` begint met `test_`, dus er wordt nog geen echt geld verwerkt — je krijgt op de Mollie-betaalpagina een testscherm waarin je een fictieve betaalstatus kiest (gelukt/mislukt/geannuleerd). Zodra je klaar bent om echt te lanceren: maak een **live** API-key aan in het Mollie Dashboard en vervang de waarde van `MOLLIE_API_KEY` in `.env`. De rest van de code hoeft niet te veranderen.

Voor livegang op een echte domeinnaam: zet de omgevingsvariabele `PUBLIC_BASE_URL` (bv. `https://mixioorganic.nl`) zodat de `redirectUrl`/`webhookUrl` naar Mollie niet naar `localhost` verwijzen. Zonder deze variabele wordt automatisch `localhost` gebruikt en de `webhookUrl` weggelaten (Mollie kan localhost toch niet bereiken).

## Nog te doen vóór livegang
- **Live Mollie API-key** aanmaken en in `.env` zetten zodra je echt wilt lanceren (nu staat er een test-key in).
- **Hosting kiezen** voor `app.py` (bv. Render, Railway, PythonAnywhere) — dit draait nu alleen lokaal. Zet daar ook `PUBLIC_BASE_URL` en `MOLLIE_API_KEY` als omgevingsvariabelen (niet in code/git).
- **Overige placeholder-vlakken** (sfeerfoto en kaart op de contactpagina) nog invullen met echte foto's — duidelijk zichtbaar met stippellijn + label.
- **Volledige INCI-ingrediëntenlijst** controleren en invullen (tab "Ingrediënten" op `producten.html`) — verplicht onder EU-cosmeticaregelgeving.
- **Algemene voorwaarden & privacybeleid** opstellen (nu placeholder-links in de footer) — als webshop ben je wettelijk verplicht klanten te informeren over herroepingsrecht (14 dagen bedenktijd), garantie en gegevensverwerking (AVG/GDPR).
- Prijs (€ 34,99 / 100 ml) is overgenomen van www.mixioorganic.nl als indicatie — controleer of deze nog actueel is.
- **Verzendkosten**: nog niet in de betaalde prijs verwerkt.
- Testimonials op de homepage zijn voorbeeldteksten — vervang door echte klantreviews.
- De Mollie-webhook (`/api/webhook` in `app.py`) logt nu alleen het payment-id in de server-console; er is nog geen orderdatabase om de betaalstatus in bij te werken.
