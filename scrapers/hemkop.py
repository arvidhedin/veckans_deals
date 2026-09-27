import requests
import re

from scrapers.pricing import parse_number, parse_price_per_kg, price_per_kg_fields

# Etikett per kampanjtyp ("GENERAL" = vanligt erbjudande, visas inte)
CAMPAIGN_LABELS = {"LOYALTY": "Klubbpris"}

# Hemköp butiker att hämta erbjudanden för
STORES = {
    "Hemköp (Svava)": "4256",
    "Hemköp (Rosendal)": "4103"
}

API_URL = "https://www.hemkop.se/axfood/rest/v1/search/campaigns/offline"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

def _parse_offer(item: dict, store_name: str) -> dict:
    """Konvertera ett Hemköp-erbjudande till vårt standardformat."""
    promos = item.get("potentialPromotions", [])

    # Bygg prissträng från kampanjinfo
    price_str = item.get("price", "")
    condition = ""
    original_price = ""
    discount_percentage = 0
    product_code = ""
    restriction = ""
    per_kg = None

    if promos:
        promo = promos[0]
        # Produktkod för att hämta innehållsförteckning (se product_info.py)
        product_code = promo.get("mainProductCode") or ""
        reward = promo.get("rewardLabel") or ""
        cond = promo.get("conditionLabelFormatted", "") or promo.get("conditionLabel", "")
        if cond and reward:
            price_str = f"{cond} {reward}"
        elif reward:
            price_str = reward

        # Kampanjtypen är en intern kod ("GENERAL", "LOYALTY") – visa bara medlemspriser
        condition = CAMPAIGN_LABELS.get(promo.get("campaignType", ""), "")
        restriction = promo.get("redeemLimitLabel") or ""

        # Originalpris från item.priceNoUnit (kilopris för varor som säljs per kg)
        price_no_unit = item.get("priceNoUnit", "")
        is_per_kg = item.get("priceUnit") == "kr/kg"
        if price_no_unit:
            original_price = f"{price_no_unit} kr/kg" if is_per_kg else f"{price_no_unit} kr"

        # Kampanjpris – för kilovaror saknas "price", då står priset i rewardLabel ("274,80/kg")
        deal = promo.get("price")
        if deal is None and reward.endswith("/kg"):
            deal = parse_number(reward)

        # Jämförpris per kg, t.ex. "99:78 kr/kg"
        per_kg = parse_price_per_kg(promo.get("comparePrice"))
        if not per_kg and deal and reward.endswith("/kg"):
            per_kg = (deal, deal)

        # Beräkna rabattprocent
        cond_label = promo.get("conditionLabel", "") or ""
        orig = parse_number(price_no_unit)
        if orig and deal:
            # Hantera "2 för" erbjudanden
            multi_match = re.search(r'(\d+)\s*för', cond_label)
            quantity = int(multi_match.group(1)) if multi_match else 1
            deal_per_unit = deal / max(quantity, 1)
            if deal_per_unit < orig:
                discount_percentage = round((1 - deal_per_unit / orig) * 100)

    # Bild-URL
    image_url = ""
    img = item.get("image") or item.get("thumbnail")
    if img:
        img_url = img.get("url", "")
        if img_url.startswith("http"):
            image_url = img_url
        elif img_url.startswith("/"):
            image_url = f"https://www.hemkop.se{img_url}"

    return {
        "store": store_name,
        "product": item.get("name", "Okänd produkt"),
        "brand": item.get("manufacturer", ""),
        "price": price_str,
        "discount": condition,
        "description": item.get("displayVolume", ""),
        "image_url": image_url,
        "category": "",
        "restriction": restriction,
        "original_price": original_price,
        "discount_percentage": discount_percentage,
        "product_code": product_code,
        **price_per_kg_fields(per_kg),
    }

def get_offers() -> list[dict]:
    """Hämtar veckans erbjudanden från Hemköp via kampanj-API:et."""
    all_offers = []

    # Loopa igenom alla våra inlagda butiker
    for store_name, store_id in STORES.items():
        page = 0
        page_size = 100

        try:
            while True:
                params = {
                    "q": store_id,
                    "type": "PERSONAL_GENERAL",
                    "page": page,
                    "size": page_size,
                }

                response = requests.get(API_URL, params=params, headers=HEADERS, timeout=10)
                response.raise_for_status()

                data = response.json()
                results = data.get("results", [])

                if not results:
                    break

                for item in results:
                    # Vi skickar nu med store_name så att rätt butik hamnar på rätt erbjudande
                    parsed = _parse_offer(item, store_name)
                    all_offers.append(parsed)

                # Kolla om det finns fler sidor
                pagination = data.get("pagination", {})
                total_pages = pagination.get("numberOfPages", 1)

                page += 1
                if page >= total_pages:
                    break

        except Exception as e:
            print(f"Fel vid hämtning av Hemköp-erbjudanden för {store_name}: {e}")

    return all_offers