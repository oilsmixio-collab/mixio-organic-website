"""
Mixio Organic — lokale server.
Serveert de statische site EN het /api/checkout-endpoint dat een
Mollie-betaling aanmaakt. De Mollie API-key blijft hierdoor volledig
server-side (via .env) en komt nooit in de browser-code terecht.

Starten:
    pip install -r requirements.txt
    python3 app.py
Site draait dan op http://localhost:5050
"""

import os
from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv
import requests

load_dotenv()

MOLLIE_API_KEY = os.environ.get("MOLLIE_API_KEY")
MOLLIE_PAYMENTS_URL = "https://api.mollie.com/v2/payments"
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL")

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

# Bekende producten + prijzen, server-side, zodat een bezoeker de prijs
# nooit via het verzoek zelf kan aanpassen.
PRICES = {
    "Hair Food + Grow|100 ml": 34.99,
}

# Staffelkorting per productregel (zelfde product+maat):
# 1 stuk = normale prijs, 2 stuks = 10% korting, 3+ stuks = 15% korting.
# Moet exact in de pas lopen met getDiscountRate() in js/script.js.
DISCOUNT_TIERS = [(3, 0.15), (2, 0.10)]


def get_discount_rate(qty):
    for min_qty, rate in DISCOUNT_TIERS:
        if qty >= min_qty:
            return rate
    return 0.0

HTML_PAGES = {
    "index.html", "producten.html", "diensten.html", "contact.html",
    "cart.html", "checkout.html", "bedankt.html",
    "privacybeleid.html", "voorwaarden.html",
}

app = Flask(__name__)


# ---------- Statische bestanden (expliciet gewhitelist, geen .env/app.py etc.) ----------

@app.route("/")
def serve_index():
    return send_from_directory(ROOT_DIR, "index.html")


@app.route("/<page>")
def serve_html_page(page):
    if page in HTML_PAGES:
        return send_from_directory(ROOT_DIR, page)
    return ("Not found", 404)


@app.route("/css/<path:filename>")
def serve_css(filename):
    return send_from_directory(os.path.join(ROOT_DIR, "css"), filename)


@app.route("/js/<path:filename>")
def serve_js(filename):
    return send_from_directory(os.path.join(ROOT_DIR, "js"), filename)


@app.route("/assets/<path:filename>")
def serve_assets(filename):
    return send_from_directory(os.path.join(ROOT_DIR, "assets"), filename)


# ---------- Checkout API ----------

@app.route("/api/checkout", methods=["POST"])
def create_checkout():
    if not MOLLIE_API_KEY:
        return jsonify({"error": "Mollie API-key ontbreekt op de server (.env)."}), 500

    data = request.get_json(silent=True) or {}
    cart = data.get("cart") or []
    customer = data.get("customer") or {}

    if not cart:
        return jsonify({"error": "Winkelwagen is leeg."}), 400

    total = 0.0
    order_lines = []
    for item in cart:
        key = f"{item.get('product')}|{item.get('size')}"
        price = PRICES.get(key)
        try:
            qty = int(item.get("qty", 0))
        except (TypeError, ValueError):
            qty = 0
        if price is None or qty < 1:
            return jsonify({"error": f"Onbekend product: {item.get('product')}"}), 400

        rate = get_discount_rate(qty)
        line_subtotal = price * qty
        line_total = line_subtotal * (1 - rate)
        total += line_total

        line_desc = f"{qty}x {item.get('product')} ({item.get('size')})"
        if rate > 0:
            line_desc += f" [-{int(rate * 100)}%]"
        order_lines.append(line_desc)

    total = round(total, 2)
    description = ("Mixio Organic bestelling: " + ", ".join(order_lines))[:255]

    base_url = (PUBLIC_BASE_URL or request.host_url).rstrip("/")
    is_local = base_url.startswith("http://127.0.0.1") or base_url.startswith("http://localhost")

    payload = {
        "amount": {"currency": "EUR", "value": f"{total:.2f}"},
        "description": description,
        "redirectUrl": f"{base_url}/bedankt.html",
        "metadata": {
            "naam": customer.get("naam", ""),
            "email": customer.get("email", ""),
        },
    }
    if not is_local:
        # Mollie kan localhost niet bereiken, dus alleen meesturen op een
        # publiek bereikbare deployment.
        payload["webhookUrl"] = f"{base_url}/api/webhook"

    try:
        resp = requests.post(
            MOLLIE_PAYMENTS_URL,
            headers={"Authorization": f"Bearer {MOLLIE_API_KEY}"},
            json=payload,
            timeout=10,
        )
    except requests.RequestException:
        return jsonify({"error": "Kon geen verbinding maken met Mollie."}), 502

    if resp.status_code >= 400:
        details = resp.json() if resp.content else {}
        return jsonify({"error": "Mollie kon de betaling niet aanmaken.", "details": details}), 502

    payment = resp.json()
    checkout_url = payment.get("_links", {}).get("checkout", {}).get("href")
    if not checkout_url:
        return jsonify({"error": "Geen betaal-URL ontvangen van Mollie."}), 502

    return jsonify({"checkoutUrl": checkout_url})


@app.route("/api/webhook", methods=["POST"])
def mollie_webhook():
    # Mollie stuurt hier alleen het payment-id naartoe; de status haal je
    # daarna zelf op via GET /v2/payments/{id}. Voor nu loggen we 'm alleen —
    # er is nog geen order-database om de status in bij te werken.
    payment_id = request.form.get("id")
    print(f"[Mollie webhook] payment id: {payment_id}")
    return "", 200


if __name__ == "__main__":
    if not MOLLIE_API_KEY:
        print("WAARSCHUWING: MOLLIE_API_KEY ontbreekt — zet 'm in .env")
    # Poort 5000 is op macOS vaak al bezet door de AirPlay Receiver
    # (ControlCenter), dus we gebruiken hier bewust een andere poort.
    app.run(port=5050, debug=True)
