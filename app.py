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
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv
import requests

load_dotenv()

MOLLIE_API_KEY = os.environ.get("MOLLIE_API_KEY")
MOLLIE_PAYMENTS_URL = "https://api.mollie.com/v2/payments"
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL")

# SMTP: verstuurt de "bedankt voor je bestelling"-mail na een bevestigde
# Mollie-betaling. Gebruikt Gmail SMTP met een App Password (geen gewoon
# Google-wachtwoord — dat accepteert Gmail niet voor SMTP-toegang).
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_EMAIL = os.environ.get("SMTP_EMAIL", "oilsmixio@gmail.com")
SMTP_APP_PASSWORD = os.environ.get("SMTP_APP_PASSWORD")

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

# Bekende producten + prijzen, server-side, zodat een bezoeker de prijs
# nooit via het verzoek zelf kan aanpassen.
PRICES = {
    "Hair Food + Grow|100 ml": 34.99,
}

# Productfoto per product+maat, gebruikt in de bevestigingsmail.
PRODUCT_IMAGES = {
    "Hair Food + Grow|100 ml": "assets/img/hair-food-oil.jpg",
}

# Staffelkorting per productregel (zelfde product+maat):
# 1 stuk = normale prijs, 2 stuks = 25% korting, 3+ stuks = 35% korting.
# Moet exact in de pas lopen met getDiscountRate() in js/script.js.
DISCOUNT_TIERS = [(3, 0.35), (2, 0.25)]


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
    email_line_items = []
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

        email_line_items.append({
            "product": item.get("product"),
            "size": item.get("size"),
            "qty": qty,
            "lineTotal": round(line_total, 2),
        })

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
            "orderItems": email_line_items,
            "orderTotal": f"{total:.2f}",
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


# ---------- Bevestigingsmail ----------

# Onthoudt welke payment-id's al een mail hebben gekregen, zodat een dubbele
# webhook-call (Mollie kan retryen) geen dubbele mail stuurt. Leeft alleen in
# het geheugen van dit serverproces — reset bij een herstart/nieuwe deploy,
# wat op de gratis Render-laag kan gebeuren. Voor een klein aantal
# bestellingen per dag is dat een acceptabele afweging; een echte oplossing
# vereist een database.
_emailed_payment_ids = set()


def send_order_confirmation_email(to_email, customer_name, order_items, order_total):
    if not SMTP_APP_PASSWORD:
        print("WAARSCHUWING: SMTP_APP_PASSWORD ontbreekt — kan geen bevestigingsmail versturen.")
        return False
    if not to_email:
        print("WAARSCHUWING: geen klant-e-mailadres bekend, bevestigingsmail overgeslagen.")
        return False

    first_name = (customer_name or "there").split(" ")[0] or "there"
    base_url = (PUBLIC_BASE_URL or "https://www.mixioorganic.nl").rstrip("/")

    def product_image_url(item):
        key = f"{item.get('product')}|{item.get('size')}"
        path = PRODUCT_IMAGES.get(key)
        return f"{base_url}/{path}" if path else None

    rows_html = "".join(
        f"<tr>"
        f"<td style='padding:8px 0;width:64px;'>"
        + (
            f"<img src='{img}' alt='{item['product']}' width='56' height='56' "
            f"style='width:56px;height:56px;object-fit:cover;border-radius:8px;display:block;'>"
            if (img := product_image_url(item)) else ""
        )
        + f"</td>"
        f"<td style='padding:8px 0;'>{item['qty']}x {item['product']} ({item['size']})</td>"
        f"<td style='padding:8px 0;text-align:right;'>€ {item['lineTotal']:.2f}</td></tr>"
        for item in order_items
    )
    rows_text = "\n".join(
        f"  {item['qty']}x {item['product']} ({item['size']}) — € {item['lineTotal']:.2f}"
        for item in order_items
    )

    html_body = f"""
    <div style="font-family:Arial,sans-serif;color:#25382a;max-width:520px;margin:0 auto;">
      <h2 style="color:#25382a;">Thank you for your order!</h2>
      <p>Hi {first_name},</p>
      <p>We've received your payment and your Mixio Organic order is confirmed. Here's your order summary:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        {rows_html}
        <tr style="border-top:1px solid #ddd;font-weight:bold;">
          <td colspan="2" style="padding:10px 0 0;">Total</td>
          <td style="padding:10px 0 0;text-align:right;">€ {order_total:.2f}</td>
        </tr>
      </table>
      <p>We'll carefully pack your order and ship it from Amsterdam. You'll hear from us again once it's on its way.</p>
      <p>Questions about your order? Just reply to this email or reach us at oilsmixio@gmail.com.</p>
      <p style="margin-top:24px;">With love,<br>Mixio Organic</p>
    </div>
    """
    text_body = (
        f"Thank you for your order!\n\n"
        f"Hi {first_name},\n\n"
        f"We've received your payment and your Mixio Organic order is confirmed. "
        f"Here's your order summary:\n\n"
        f"{rows_text}\n\n"
        f"Total: € {order_total:.2f}\n\n"
        f"We'll carefully pack your order and ship it from Amsterdam. "
        f"You'll hear from us again once it's on its way.\n\n"
        f"Questions about your order? Just reply to this email or reach us at oilsmixio@gmail.com.\n\n"
        f"With love,\nMixio Organic"
    )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Thank you for your order — Mixio Organic"
    msg["From"] = f"Mixio Organic <{SMTP_EMAIL}>"
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(SMTP_EMAIL, SMTP_APP_PASSWORD)
            server.sendmail(SMTP_EMAIL, [to_email], msg.as_string())
        return True
    except Exception as exc:
        print(f"[e-mail] versturen mislukt: {exc}")
        return False


@app.route("/api/webhook", methods=["POST"])
def mollie_webhook():
    payment_id = request.form.get("id")
    print(f"[Mollie webhook] payment id: {payment_id}")
    if not payment_id or not MOLLIE_API_KEY:
        return "", 200

    try:
        resp = requests.get(
            f"{MOLLIE_PAYMENTS_URL}/{payment_id}",
            headers={"Authorization": f"Bearer {MOLLIE_API_KEY}"},
            timeout=10,
        )
        resp.raise_for_status()
        payment = resp.json()
    except requests.RequestException as exc:
        print(f"[Mollie webhook] kon betaalstatus niet ophalen: {exc}")
        return "", 200

    if payment.get("status") != "paid":
        return "", 200

    if payment_id in _emailed_payment_ids:
        return "", 200

    metadata = payment.get("metadata") or {}
    order_items = metadata.get("orderItems") or []
    try:
        order_total = float(metadata.get("orderTotal", 0))
    except (TypeError, ValueError):
        order_total = 0.0

    sent = send_order_confirmation_email(
        to_email=metadata.get("email"),
        customer_name=metadata.get("naam"),
        order_items=order_items,
        order_total=order_total,
    )
    if sent:
        _emailed_payment_ids.add(payment_id)

    return "", 200


if __name__ == "__main__":
    if not MOLLIE_API_KEY:
        print("WAARSCHUWING: MOLLIE_API_KEY ontbreekt — zet 'm in .env")
    # Poort 5000 is op macOS vaak al bezet door de AirPlay Receiver
    # (ControlCenter), dus we gebruiken hier bewust een andere poort.
    app.run(port=5050, debug=True)
