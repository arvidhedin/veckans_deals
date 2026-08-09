import requests
import re

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

    if promos:
        promo = promos[0]
        reward = promo.get("rewardLabel", "")
        cond = promo.get("conditionLabelFormatted", "") or promo.get("conditionLabel", "")
        if cond and reward:
            price_str = f"{cond} {reward}"
        elif reward:
            price_str = reward

        condition = promo.get("campaignType", "")

        # Originalpris från item.priceNoUnit
        price_no_unit = item.get("priceNoUnit", "")
        if price_no_unit:
            original_price = f"{price_no_unit} kr"

        # Beräkna rabattprocent
        promo_price = promo.get("price")
        cond_label = promo.get("conditionLabel", "") or ""
        if price_no_unit and promo_price is not None:
            try:
                orig = float(str(price_no_unit).replace(",", "."))
                deal = float(promo_price)
                # Hantera "2 för" erbjudanden
                multi_match = re.search(r'(\d+)\s*för', cond_label)
                if multi_match:
                    qty = int(multi_match.group(1))
                    deal_per_unit = deal / qty
                else:
                    deal_per_unit = deal
                if orig > 0 and deal_per_unit < orig:
                    discount_percentage = round((1 - deal_per_unit / orig) * 100)
            except (ValueError, TypeError, ZeroDivisionError):
                pass

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
        "restriction": "",
        "original_price": original_price,
        "discount_percentage": discount_percentage,
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