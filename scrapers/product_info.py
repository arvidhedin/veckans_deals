"""
product_info.py - Hämtar innehållsförteckning och näringsvärde för erbjudandena.

- Willys/Hemköp: produktdata hämtas via erbjudandets produktkod.
- ICA/Coop: varorna söks upp på Willys och matchas på EAN-kod (många
  märkesvaror säljs i båda kedjorna). Coop-varor hämtas i första hand från
  Coops webbutik. Resten slår sajten upp i Open Food Facts.

Axfoods API svarar 403 på anrop som kommer från en annan webbplats
(webbläsaren skickar då en Origin-header), så datan kan inte hämtas direkt i
webbläsaren. Den hämtas i stället här när deals.json byggs och sparas i
public/product_info.json, som sajten läser in när en vara öppnas.
"""

import datetime
import re
import time

import requests

from scrapers import coop

HOSTS = {
    "Willys": "https://www.willys.se",
    "Hemköp": "https://www.hemkop.se",
}

SEARCH_URL = "https://www.willys.se/axfood/rest/v1/search"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

# Sparad produktinfo återanvänds så här länge innan den hämtas på nytt
MAX_AGE_DAYS = 14

# Övre gräns för antal produktanrop per körning
MAX_FETCHES = 600

UNIT_LABELS = {
    "gram": "g",
    "milligram": "mg",
    "mikrogram": "µg",
    "milliliter": "ml",
    "kilojoule": "kJ",
    "kilokalori": "kcal",
}

# "INGREDIENSER ", "Ingredienser: ", "INNEHÅLL: " osv. i början av texten
INGREDIENTS_PREFIX = re.compile(r"^\s*(?:ingredienser|innehåll|ingredients)\s*:?\s*", re.IGNORECASE)

# Axfoods bild-URL:er innehåller varans GTIN, t.ex. .../07310861012443_C1R1_s06
IMAGE_GTIN = re.compile(r"/(\d{14})_")

# ICA:s och Coops egna märken säljs inte på Willys
OWN_BRANDS = re.compile(r"^(?:ica|coop)\b", re.IGNORECASE)


def _format_amount(quantity, unit_code) -> str:
    """'8.1' + 'gram' -> '8,1 g'"""
    unit = UNIT_LABELS.get(unit_code or "", unit_code or "")
    return f"{str(quantity).strip().replace('.', ',')} {unit}".strip()


def _parse_nutrition(product: dict) -> tuple[str, dict]:
    """Returnerar (bas, {näringsämne: mängd}), t.ex. ('per 100 g', {'Energi': '935 kJ / 224 kcal', ...})."""
    headers = product.get("nutrientHeaders") or []
    if not headers:
        return "", {}

    # Föredra värden per 100 g/ml om det finns flera (t.ex. även per portion)
    header = next((h for h in headers if str(h.get("nutrientBasisQuantity")) == "100"), headers[0])

    basis = ""
    if header.get("nutrientBasisQuantity"):
        basis = "per " + _format_amount(
            header["nutrientBasisQuantity"], header.get("nutrientBasisQuantityMeasurementUnitCode")
        )

    energy = []
    nutrition = {}
    for detail in header.get("nutrientDetails") or []:
        label = (detail.get("nutrientTypeCode") or "").strip()
        quantity = detail.get("quantityContained")
        if not label or quantity in (None, ""):
            continue
        amount = _format_amount(quantity, detail.get("measurementUnitCode"))
        if label.lower() == "energi":
            energy.append(amount)
        else:
            nutrition[label[0].upper() + label[1:]] = amount

    if energy:
        # kJ före kcal, och energi först i tabellen
        energy.sort(key=lambda a: 0 if a.endswith("kJ") else 1)
        nutrition = {"Energi": " / ".join(energy), **nutrition}

    return basis, nutrition


def _parse_product(product: dict, source: str) -> dict:
    """Plocka ut det sajten visar från Axfoods produktdata."""
    ingredients = INGREDIENTS_PREFIX.sub("", product.get("ingredients") or "").strip()
    basis, nutrition = _parse_nutrition(product)

    return {
        "name": product.get("name") or "",
        "details": product.get("productLine2") or "",
        "ingredients": ingredients,
        "nutrition_basis": basis,
        "nutrition": nutrition,
        "origin": (product.get("countryOfOriginStatement") or "").strip(),
        "source": source,
        "fetched": datetime.date.today().isoformat(),
    }


def _fetch_product(code: str, chain: str) -> dict | None:
    """Hämtar produkten från kedjans egen sajt, annars från den andra Axfood-kedjan
    (vissa kampanjvaror finns bara hos den ena). Returnerar None om ingen har den."""
    for source in [chain] + [c for c in HOSTS if c != chain]:
        response = requests.get(f"{HOSTS[source]}/axfood/rest/p/{code}", headers=HEADERS, timeout=10)
        if 400 <= response.status_code < 500:
            continue
        response.raise_for_status()
        return _parse_product(response.json(), source)
    return None


def _is_fresh(cached: dict, today: datetime.date) -> bool:
    try:
        fetched = datetime.date.fromisoformat(cached.get("fetched", ""))
    except ValueError:
        return False
    # Varor utan data hämtas igen vid nästa körning – de kan ha lagts upp sedan dess
    max_age = MAX_AGE_DAYS if cached.get("ingredients") or cached.get("nutrition") else 1
    return (today - fetched).days < max_age


def _search_query(offer: dict) -> tuple[str, str]:
    """Returnerar (märke, sökfras), t.ex. 'V39 Nyponsoppa (Pris med kupong)' -> 'Ekströms Nyponsoppa'."""
    # ICA: "Kronfågel. Ursprung Sverige", Coop: "Sverige/Scan"
    brand = (offer.get("brand") or "").split(".")[0].split("/")[-1].strip()
    name = re.sub(r"^V\d+\s+", "", offer.get("product") or "")
    name = re.sub(r"\(.*?\)", "", name).strip()
    return brand, f"{brand} {name}".strip()


def _match_eans(offers: list[dict], previous_eans: dict) -> dict:
    """Söker upp ICA-/Coop-erbjudandenas varor på Willys och matchar dem på EAN-kod.
    Returnerar {ean: produktkod}."""
    # Samla varianternas EAN-koder per sökfras (samma erbjudande finns i flera butiker)
    queries = {}
    for offer in offers:
        variants = offer.get("eans") or []
        brand, query = _search_query(offer)
        if not variants or OWN_BRANDS.match(brand):
            continue
        # Jämför utan inledande nollor (EAN-13 mot GTIN-14)
        queries.setdefault(query, {}).update({v["ean"].lstrip("0"): v["ean"] for v in variants})

    eans = {}
    failed = 0
    for query, wanted in queries.items():
        try:
            response = requests.get(SEARCH_URL, params={"q": query, "size": 30}, headers=HEADERS, timeout=10)
            response.raise_for_status()
            for item in response.json().get("results") or []:
                match = IMAGE_GTIN.search((item.get("image") or {}).get("url") or "")
                gtin = match.group(1).lstrip("0") if match else ""
                if gtin in wanted and item.get("code"):
                    eans[wanted[gtin]] = item["code"]
        except Exception:
            failed += 1
            # Behåll förra körningens kopplingar hellre än inga
            for ean in wanted.values():
                if ean in previous_eans:
                    eans[ean] = previous_eans[ean]
        time.sleep(0.1)

    print(f"   [OK] EAN matches on Willys: {len(eans)} ICA/Coop variants ({len(queries)} searches, {failed} failed)")
    return eans


def _fetch_products(wanted: dict, previous_products: dict) -> dict:
    """Hämtar {produktkod: info} för wanted = {produktkod: kedja}, med cache från förra körningen."""
    today = datetime.date.today()
    result = {}
    fetched = reused = failed = 0

    for code, chain in wanted.items():
        cached = previous_products.get(code)
        if cached and _is_fresh(cached, today):
            result[code] = cached
            reused += 1
            continue

        if fetched + failed >= MAX_FETCHES:
            if cached:
                result[code] = cached
            continue

        try:
            # Spara även varor som saknas, så att sajten kan visa att det inte finns någon data
            result[code] = _fetch_product(code, chain) or _parse_product({}, chain)
            fetched += 1
        except Exception as e:
            failed += 1
            if failed <= 3:
                print(f"   Kunde inte hämta produktinfo för {code} ({chain}): {e}")
            # Behåll gammal data hellre än ingen
            if cached:
                result[code] = cached

        time.sleep(0.1)

    print(f"   [OK] Product info: {len(result)} products ({fetched} fetched, {reused} cached, {failed} failed)")
    return result


def _coop_products(offers: list[dict]) -> tuple[dict, dict]:
    """Innehållsförteckningar för Coop-erbjudandena från Coops webbutik. coop.py har redan
    sökt upp varorna för ordinarie pris, så sökningarna kommer från dess cache."""
    products, eans = {}, {}
    for offer in offers:
        if not offer.get("store", "").startswith("Coop"):
            continue
        try:
            found = coop.find_products(offer)
        except Exception:
            continue
        for ean, product in found.items():
            ingredients = INGREDIENTS_PREFIX.sub("", product.get("listOfIngredients") or "").strip()
            if not ingredients:
                continue
            countries = ", ".join(c.get("value", "") for c in product.get("countryOfOriginCodes") or [] if c.get("value"))
            key = f"coop:{ean}"
            products[key] = {
                "name": product.get("name") or "",
                "details": product.get("manufacturerName") or "",
                "ingredients": ingredients,
                "nutrition_basis": "",
                "nutrition": {},
                "origin": f"Ursprungsland: {countries}" if countries else "",
                "source": "Coop",
                "fetched": datetime.date.today().isoformat(),
            }
            eans[ean] = key
    print(f"   [OK] Coop products: {len(products)} variants with ingredients")
    return products, eans


def build_product_info(offers: list[dict], previous: dict) -> dict:
    """Returnerar {"products": {produktkod: info}, "eans": {ean: produktkod}}.

    previous är innehållet från förra körningen; produkter som hämtats nyligen
    återanvänds så att bara nya varor behöver hämtas. Varor som inte längre är
    på erbjudande tas bort.
    """
    # Willys/Hemköp-erbjudanden (samma kod kan finnas hos båda kedjorna)
    wanted = {}
    for offer in offers:
        code = offer.get("product_code")
        if code and code not in wanted:
            wanted[code] = "Hemköp" if offer.get("store", "").startswith("Hemköp") else "Willys"

    # ICA/Coop-varor som också säljs på Willys
    eans = _match_eans(offers, previous.get("eans", {}))
    for code in eans.values():
        wanted.setdefault(code, "Willys")

    products = _fetch_products(wanted, previous.get("products", {}))
    eans = {ean: code for ean, code in eans.items() if code in products}

    # Coop-varornas egna uppgifter går före Willys-matchningen
    coop_products, coop_eans = _coop_products(offers)
    products.update(coop_products)
    eans.update(coop_eans)
    return {"products": products, "eans": eans}
