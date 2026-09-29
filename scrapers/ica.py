import requests
from bs4 import BeautifulSoup
import re
import json
import time

from scrapers.origin import country
from scrapers.pricing import parse_number, parse_price_per_kg, price_per_kg_fields


# ICA butiker att hämta erbjudanden för
STORES = {
    "ICA Nära Råbyvägen": "https://www.ica.se/erbjudanden/ica-nara-rabyvagen-1003963/",
    "ICA Supermarket Torgkassen": "https://www.ica.se/erbjudanden/ica-supermarket-torgkassen-1003821/",
    "ICA Nära Rosendal": "https://www.ica.se/erbjudanden/ica-nara-rosendal-1004328/",
    "ICA Supermarket Väst": "https://www.ica.se/erbjudanden/ica-supermarket-vast-1003761/",
    "ICA Vretgränd": "https://www.ica.se/erbjudanden/ica-vretgrand-1003558/",
    "ICA Supermarket City": "https://www.ica.se/erbjudanden/ica-supermarket-city-uppsala-1003381/",
    "ICA Supermarket Luthagens Livs": "https://www.ica.se/erbjudanden/ica-supermarket-luthagens-livs-1004458/",
    "ICA Folkes Livs": "https://www.ica.se/erbjudanden/ica-folkes-livs-1004181/",
    "ICA Nära Hörnan": "https://www.ica.se/erbjudanden/ica-nara-hornan-1003672/",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "sv-SE,sv;q=0.9",
}

# ICA:s sida svarar ibland utan erbjudanden eller inte alls, så varje butik får flera försök
ATTEMPTS = 3
RETRY_DELAY = 5  # sekunder

# Sidans status för veckans erbjudanden: 0 = NotLoaded, 1 = Loading, 2 = Loaded, 3 = Error
WEEKLY_OFFERS_LOADED = 2

# ICA:s varugrupper är breda ("Färskvaror" rymmer både kött, ost och fisk), så de finare
# grupperna (expandedArticleGroupId) används när de är kända. Kategoriseraren använder
# gruppen när varans namn inte räcker.
ARTICLE_GROUPS = {
    12: "Kött",
    13: "Ost",
    14: "Färdigmat",
    15: "Fisk",
    16: "Chark",
    17: "Blommor",
    18: "Dryck",
    19: "Godis & snacks",
    21: "Hushåll",
    22: "Djurmat",
}


def _parse_initial_data(html: str) -> dict | None:
    """Extrahera window.__INITIAL_DATA__ från HTML och parsa till dict."""
    soup = BeautifulSoup(html, "html.parser")
    script = soup.find("script", string=re.compile(r"window\.__INITIAL_DATA__"))
    if not script or not script.string:
        return None

    match = re.search(r"window\.__INITIAL_DATA__\s*=\s*(\{.*\});?", script.string)
    if not match:
        return None

    json_str = match.group(1)
    if json_str.endswith(";"):
        json_str = json_str[:-1]

    # Fixa JavaScript-specifika värden som inte är giltig JSON
    json_str = re.sub(r":\s*undefined", ":null", json_str)
    json_str = re.sub(r"new\s+Map\(\[.*?\]\)", "{}", json_str)

    return json.loads(json_str)


def _weekly_offers(html: str) -> list[dict]:
    """Veckans erbjudanden ur butikssidan. Sidan renderas hos ICA och svarar 200 även när
    ICA:s server inte fick fram erbjudandena – då är weeklyOffersStatus 3 (Error) och
    listan tom. Det ger ett fel, så att butiken hämtas igen i stället för att tyst försvinna."""
    data = _parse_initial_data(html)
    if not data:
        raise ValueError("sidan saknar window.__INITIAL_DATA__")

    offers = data.get("offers") or {}
    weekly_offers = offers.get("weeklyOffers") or []
    status = offers.get("weeklyOffersStatus")
    # Tom lista med status Loaded betyder att butiken inte har några erbjudanden
    if not weekly_offers and status != WEEKLY_OFFERS_LOADED:
        raise ValueError(f"sidan saknar erbjudanden (weeklyOffersStatus {status})")
    return weekly_offers


def _fetch_weekly_offers(store_name: str, url: str) -> list[dict]:
    """Hämtar butikens veckoerbjudanden. Försöker igen efter en kort paus om sidan inte
    svarar eller saknar erbjudanden, och skriver ut ett fel om alla försök misslyckas."""
    for attempt in range(1, ATTEMPTS + 1):
        try:
            response = requests.get(url, headers=HEADERS, timeout=10)
            response.raise_for_status()
            return _weekly_offers(response.text)
        except Exception as e:
            error = e
            if attempt < ATTEMPTS:
                print(f"ICA-erbjudanden ({store_name}): {e} – försöker igen om {RETRY_DELAY} s")
                time.sleep(RETRY_DELAY)

    print(f"Fel vid hämtning av ICA-erbjudanden ({store_name}), gav upp efter {ATTEMPTS} försök: {error}")
    return []


def _parse_offer(offer: dict, store_name: str) -> dict:
    """Konvertera ett ICA-erbjudande till vårt standardformat."""
    details = offer.get("details", {})
    mechanics = offer.get("parsedMechanics", {})
    stores = offer.get("stores", [])
    eans = offer.get("eans", [])

    # Bygg prissträng: value1 = "3 för", value2 = kronor, value3 = ören,
    # value4 = enhet ("/st", "/kg", "+pant"), unitSign = ":-" för jämna kronor
    value2 = str(mechanics.get("value2") or "").strip()
    value3 = str(mechanics.get("value3") or "").strip()
    unit = str(mechanics.get("value4") or "").strip()
    deal = parse_number(f"{value2},{value3}" if value3 else value2)

    if value2:
        amount = f"{value2},{value3}" if value3 else f"{value2}{mechanics.get('unitSign') or ''}"
        price_str = f"{mechanics.get('value1') or ''} {amount}".strip()
        if "pant" in unit:
            price_str += " +pant"
        elif unit.startswith("/"):
            price_str += unit
    else:
        price_str = details.get("mechanicInfo") or ""

    # Jämförpris per kg: kilopriset självt, annars ICA:s jämförpris (t.ex. "115:00-127:78/kg")
    if unit == "/kg" and deal:
        per_kg = (deal, deal)
    else:
        per_kg = parse_price_per_kg(offer.get("comparisonPrice"))

    # Ordinarie pris och rabattprocent
    original_price = ""
    discount_percentage = 0
    if stores:
        reg_price_str = stores[0].get("regularPrice", "")
        if reg_price_str:
            original_price = f"{reg_price_str} kr/kg" if unit == "/kg" else f"{reg_price_str} kr"
            # Hantera intervall som "67,35" eller "21,71-24,55" (lägsta ordinarie priset)
            orig = parse_number(reg_price_str.split("-")[0])
            # "3 för 149" → per-styck deal = 149/3
            quantity = int(mechanics.get("quantity") or 1)
            deal_per_unit = deal / quantity if deal and quantity > 1 else deal
            if orig and deal_per_unit and deal_per_unit < orig:
                discount_percentage = round((1 - deal_per_unit / orig) * 100)

    # Bild-URL
    image_url = ""
    if eans:
        image_url = eans[0].get("image", "")

    # EAN-koder för erbjudandets varianter – används för att hitta innehållsförteckningen
    # (se product_info.py). Max 30 för att hålla nere storleken på deals.json
    variant_eans = [
        {"ean": e["id"], "name": e.get("articleDescription", "")}
        for e in eans
        if str(e.get("id", "")).isdigit()
    ][:30]

    # ICA sätter ibland veckonumret först i namnet, t.ex. "V39 Wasa Sandwich"
    product_name = re.sub(r"^V\d{1,2}\s+", "", details.get("name") or "Okänd produkt")

    category = offer.get("category") or {}
    category_name = ARTICLE_GROUPS.get(category.get("expandedArticleGroupId")) or category.get("articleGroupName") or ""

    # Ursprunget står i märket, t.ex. "Kronfågel. Ursprung Sverige"
    brand = details.get("brand") or ""
    origin_match = re.search(r"\bUrsprung:?\s+(.+)$", brand)
    origin = country(origin_match.group(1)) if origin_match else ""

    return {
        "store": store_name,
        "product": product_name,
        "brand": brand,
        "price": price_str or "Se butik",
        "discount": f"Ord.pris {original_price}" if original_price else "",
        "description": details.get("packageInformation", ""),
        "image_url": image_url,
        "category": category_name,
        "restriction": offer.get("restriction", ""),
        "original_price": original_price,
        "discount_percentage": discount_percentage,
        "eans": variant_eans,
        "origin": origin,
        **price_per_kg_fields(per_kg),
    }


def get_offers() -> list[dict]:
    """Hämtar veckans erbjudanden från alla konfigurerade ICA-butiker."""
    all_offers = []

    for store_name, url in STORES.items():
        weekly_offers = _fetch_weekly_offers(store_name, url)
        try:
            for offer in weekly_offers:
                parsed = _parse_offer(offer, store_name)
                all_offers.append(parsed)

        except Exception as e:
            print(f"Fel vid hämtning av ICA-erbjudanden ({store_name}): {e}")

    return all_offers
