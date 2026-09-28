import requests
from bs4 import BeautifulSoup
import json
import re

from scrapers.pricing import format_kr, parse_price_per_kg, price_per_kg_fields

# Coop butiker att hämta erbjudanden för
STORES = {
    "Coop (Centralhuset)": "036910",
    "Coop (Liljegatan)": "036002",
    "Coop (Ekeby)": "036906"
}

# Coops webbutik – erbjudande-API:et saknar ordinarie pris, så det hämtas härifrån
# (tillsammans med innehållsförteckningen). Webbutikens priser kan skilja något
# från hyllpriserna i de enskilda butikerna.
SEARCH_URL = "https://external.api.coop.se/personalization/search/products"
ONLINE_STORE_ID = "251300"

_headers_cache = {}
_search_cache = {}

# Fallback keys if dynamic retrieval fails
FALLBACK_KEYS = [
    "3becf0ce306f41a1ae94077c16798187",  # extApimSubscriptionKey
    "32895bd5b86e4a5ab6e94fb0bc8ae234",  # dkeKey
    "990520e65cc44eef89e9045b57f4e9"     # User-provided key (storeApiSubscriptionKey)
]

def _get_headers() -> dict:
    """Hämtar headers och försöker extrahera API-nyckeln dynamiskt."""
    headers = {
        "Origin": "https://www.coop.se",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/120.0.0.0 Safari/537.36"
    }

    try:
        url = "https://www.coop.se/butiker-erbjudanden/coop/coop-centralhuset/"
        r = requests.get(url, headers={"User-Agent": headers["User-Agent"]}, timeout=5)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, 'html.parser')
            for s in soup.find_all('script'):
                if s.string and 'coopSettings' in s.string:
                    match = re.search(r'window\.coopSettings\s*=\s*(\{.*?\});', s.string, re.DOTALL)
                    if match:
                        settings = json.loads(match.group(1))
                        sa = settings.get('serviceAccess', {})
                        sub_key = sa.get('extApimSubscriptionKey') or sa.get('dkeKey') or sa.get('storeApiSubscriptionKey')
                        if sub_key:
                            headers["Ocp-Apim-Subscription-Key"] = sub_key
                            return headers
    except Exception:
        pass

    headers["Ocp-Apim-Subscription-Key"] = FALLBACK_KEYS[0]
    return headers

def _search_products(query: str, headers: dict) -> list[dict]:
    """Söker i Coops webbutik (cachas, så samma sökning görs bara en gång per körning)."""
    if query not in _search_cache:
        params = {"api-version": "v1", "store": ONLINE_STORE_ID, "groups": "CUSTOMER_PRIVATE",
                  "device": "desktop", "direct": "false"}
        body = {"query": query, "resultsOptions": {"skip": 0, "take": 30, "sortBy": [], "facets": []},
                "relatedResultsOptions": {"skip": 0, "take": 0}}
        response = requests.post(SEARCH_URL, params=params, headers={**headers, "Accept": "application/json"},
                                 json=body, timeout=10)
        response.raise_for_status()
        _search_cache[query] = (response.json().get("results") or {}).get("items") or []
    return _search_cache[query]

def find_products(offer: dict) -> dict:
    """Hittar erbjudandets varor i Coops webbutik via EAN-koderna: {ean: produkt}."""
    wanted = [v["ean"] for v in offer.get("eans", [])]
    if not wanted:
        return {}
    if "headers" not in _headers_cache:
        _headers_cache["headers"] = _get_headers()

    # Sök först på namnet (ger alla varianter på en gång), annars direkt på EAN-koderna
    found = {}
    for query in [offer.get("product", "")] + wanted[:2]:
        for product in _search_products(query, _headers_cache["headers"]):
            if product.get("ean") in wanted:
                found[product["ean"]] = product
        if found:
            break
    return found

def _add_ordinary_price(offer: dict, item: dict) -> None:
    """Sätter ordinarie pris och rabattprocent utifrån webbutikens pris för samma varor."""
    price_info = item.get("priceInformation", {})
    deal = price_info.get("discountValue")
    if not deal:
        return
    deal_per_unit = deal / (price_info.get("minimumAmount") or 1)
    is_per_kg = price_info.get("unit") == "kg"

    ordinary = []
    for product in find_products(offer).values():
        if is_per_kg:
            # Kilovara: jämför med ordinarie jämförpris per kg
            if (product.get("comparativePriceUnit") or {}).get("unit") == "kg":
                ordinary.append((product.get("comparativePriceData") or {}).get("b2cPrice"))
        else:
            ordinary.append((product.get("salesPriceData") or {}).get("b2cPrice"))
    ordinary = [p for p in ordinary if p]
    if not ordinary:
        return

    # Lägsta ordinarie priset bland varianterna, som för ICA
    low, high = min(ordinary), max(ordinary)
    price_range = format_kr(low) if low == high else f"{format_kr(low)}-{format_kr(high)}"
    offer["original_price"] = f"{price_range} kr/kg" if is_per_kg else f"{price_range} kr"
    if deal_per_unit < low:
        offer["discount_percentage"] = round((1 - deal_per_unit / low) * 100)

def _parse_offer(item: dict, store_name: str) -> dict:
    """Konvertera ett Coop-erbjudande till vårt standardformat."""
    content = item.get("content", {})
    us = item.get("unifiedSplash", {})
    price_info = item.get("priceInformation", {})

    prefix = us.get("prefix", "").strip()
    value = us.get("value", "").strip()
    decimal = us.get("decimal", "").strip()
    unit = us.get("unit", "").strip()

    price_str = ""
    if prefix:
        price_str += f"{prefix} "

    if value:
        if decimal and decimal not in ["0", "00"]:
            price_str += f"{value},{decimal}"
        else:
            price_str += value
            if value.replace(":-", "").replace(",", "").replace(".", "").isdigit() and ":-" not in value:
                price_str += ":-"
        
        if unit:
            price_str += f"/{unit}"
    else:
        price_str = "Se butik"

    parent_amount = (item.get("parentAmountInformation") or content.get("parentAmountInformation") or "").strip()
    desc_text = content.get("description", "").strip()

    if parent_amount and desc_text:
        if parent_amount.endswith("."):
            description = f"{parent_amount} {desc_text}"
        else:
            description = f"{parent_amount}. {desc_text}"
    elif parent_amount:
        description = parent_amount
    else:
        description = desc_text

    image_url = content.get("imageUrl", "")
    if image_url.startswith("//"):
        image_url = f"https:{image_url}"

    original_price = ""
    discount_percentage = 0

    # Jämförpris per kg: kilopriset självt, annars Coops jämförpris (t.ex. "79,80-114kr/kg.")
    if price_info.get("unit") == "kg" and price_info.get("discountValue"):
        per_kg = (price_info["discountValue"], price_info["discountValue"])
    else:
        per_kg = parse_price_per_kg(content.get("comparativePriceText"))

    # EAN-koder för erbjudandets varianter – används för att hitta
    # innehållsförteckningen (se product_info.py)
    variant_eans = []
    for variant in [item] + (item.get("clusterInteriorOffers") or []):
        ean = str(variant.get("externalId") or "")
        if ean.isdigit() and ean not in [v["ean"] for v in variant_eans]:
            variant_content = variant.get("content", {})
            name = variant_content.get("onlineProductName") or variant_content.get("title", "")
            variant_eans.append({"ean": ean, "name": name})

    # Coops egen kategori, t.ex. "Färsk/Chark/Deli/Färdigmat" (används av kategoriseraren)
    category = "/".join(filter(None, [item.get("categoryGroup"), (item.get("categoryTeam") or {}).get("name")]))

    return {
        "store": store_name,
        "product": content.get("title", "Okänd produkt"),
        "brand": content.get("brand", ""),
        "price": price_str.strip(),
        "discount": us.get("tag", ""),
        "description": description,
        "image_url": image_url,
        "category": category,
        "restriction": "",
        "original_price": original_price,
        "discount_percentage": discount_percentage,
        "eans": variant_eans,
        **price_per_kg_fields(per_kg),
    }

def get_offers() -> list[dict]:
    """Hämtar veckans erbjudanden från alla konfigurerade Coop-butiker."""
    all_offers = []
    
    # Vi hämtar API-nyckeln en gång för alla butiker
    headers = _get_headers()
    _headers_cache["headers"] = headers

    for store_name, store_id in STORES.items():
        # Återställ set:et med id:n per butik, annars missar vi produkter 
        # som finns i båda butikerna
        seen_ids = set()
        
        # Dynamisk URL baserat på butikens ID
        api_url = f"https://external.api.coop.se/dke/offers/sorting-groups/{store_id}?api-version=v2&clustered=true&grouped=true"

        try:
            response = requests.get(api_url, headers=headers, timeout=10)
            
            if response.status_code == 401:
                for fallback_key in FALLBACK_KEYS:
                    headers["Ocp-Apim-Subscription-Key"] = fallback_key
                    response = requests.get(api_url, headers=headers, timeout=10)
                    if response.status_code == 200:
                        break

            response.raise_for_status()
            data = response.json()

            sorting_groups = data.get("sortingGroups", [])
            for group in sorting_groups:
                for offer in group.get("offers", []):
                    offer_id = offer.get("id")
                    if offer_id:
                        if offer_id in seen_ids:
                            continue
                        seen_ids.add(offer_id)
                    
                    parsed = _parse_offer(offer, store_name)
                    try:
                        _add_ordinary_price(parsed, offer)
                    except Exception as e:
                        print(f"Kunde inte hämta ordinarie pris för {parsed['product']} ({store_name}): {e}")
                    all_offers.append(parsed)

        except Exception as e:
            print(f"Fel vid hämtning av Coop-erbjudanden för {store_name}: {e}")

    return all_offers