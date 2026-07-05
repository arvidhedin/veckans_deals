import requests
from bs4 import BeautifulSoup
import json
import re

API_URL = "https://external.api.coop.se/dke/offers/sorting-groups/036910?api-version=v2&clustered=true&grouped=true"

# Fallback keys if dynamic retrieval fails
FALLBACK_KEYS = [
    "3becf0ce306f41a1ae94077c16798187",  # extApimSubscriptionKey
    "32895bd5b86e4a5ab6e94fb0bc8ae234",  # dkeKey
    "990520e65cc44eef89e9045b57f4e9"   # User-provided key (storeApiSubscriptionKey)
]

def _get_headers() -> dict:
    """Hämtar headers och försöker extrahera API-nyckeln dynamiskt."""
    headers = {
        "Origin": "https://www.coop.se",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/120.0.0.0 Safari/537.36"
    }

    # Försök hämta nyckeln dynamiskt från butikssidan för att undvika att nyckeln går ut
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

    # Fallback till den första fungerande kända nyckeln
    headers["Ocp-Apim-Subscription-Key"] = FALLBACK_KEYS[0]
    return headers

def _parse_offer(item: dict) -> dict:
    """Konvertera ett Coop-erbjudande till vårt standardformat."""
    content = item.get("content", {})
    us = item.get("unifiedSplash", {})

    # Bygg prissträng från unifiedSplash
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
            # Lägg till :- om värdet bara är siffror och saknar det
            if value.isdigit():
                price_str += ":-"
        
        if unit:
            price_str += f"/{unit}"
    else:
        price_str = "Se butik"

    # Bygg beskrivning genom att kombinera parentAmountInformation och description
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

    # Fixa protokoll-relativa bild-URL:er
    image_url = content.get("imageUrl", "")
    if image_url.startswith("//"):
        image_url = f"https:{image_url}"

    return {
        "store": "Coop",
        "product": content.get("title", "Okänd produkt"),
        "brand": content.get("brand", ""),
        "price": price_str.strip(),
        "discount": us.get("tag", ""),
        "description": description,
        "image_url": image_url,
        "category": "",
        "restriction": ""
    }

def get_offers() -> list[dict]:
    """Hämtar veckans erbjudanden från Coop via DKE-API:et."""
    all_offers = []
    seen_ids = set()

    try:
        headers = _get_headers()
        
        # Prova att hämta med den valda nyckeln
        response = requests.get(API_URL, headers=headers, timeout=10)
        
        # Om den valda nyckeln ger 401, prova fallback-nycklarna
        if response.status_code == 401:
            for fallback_key in FALLBACK_KEYS:
                headers["Ocp-Apim-Subscription-Key"] = fallback_key
                response = requests.get(API_URL, headers=headers, timeout=10)
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
                
                parsed = _parse_offer(offer)
                all_offers.append(parsed)

    except Exception as e:
        print(f"Fel vid hämtning av Coop-erbjudanden: {e}")

    return all_offers
