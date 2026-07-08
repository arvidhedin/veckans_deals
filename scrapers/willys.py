import requests
from bs4 import BeautifulSoup
import urllib.parse
import json


# Willys butik att hämta erbjudanden för
# Uppsala Björkgatan store code is 2110
STORE_ID = "2110"
STORE_NAME = "Willys"

API_URL = "https://www.willys.se/axfood/rest/v1/search/campaigns/offline"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

IMAGE_BASE = "https://assets.axfood.se/image/upload/f_auto,t_200/"


def _parse_offer(item: dict) -> dict:
    """Konvertera ett Willys-erbjudande till vårt standardformat."""
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
                import re
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
            image_url = f"https://www.willys.se{img_url}"

    return {
        "store": STORE_NAME,
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
    """Hämtar veckans erbjudanden från Willys via kampanj-API:et."""
    all_offers = []
    page = 0
    page_size = 100

    try:
        while True:
            params = {
                "q": STORE_ID,
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
                parsed = _parse_offer(item)
                all_offers.append(parsed)

            # Kolla om det finns fler sidor
            pagination = data.get("pagination", {})
            total_pages = pagination.get("numberOfPages", 1)

            page += 1
            if page >= total_pages:
                break

    except Exception as e:
        print(f"Fel vid hämtning av Willys-erbjudanden: {e}")

    return all_offers


def search_regular_assortment(query: str) -> list[dict]:
    """Sök i Willys ordinarie sortiment via HTML-sidan och extrahera __NEXT_DATA__."""
    try:
        url = f"https://www.willys.se/sok?q={urllib.parse.quote(query)}"
        html_headers = HEADERS.copy()
        html_headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
        response = requests.get(url, headers=html_headers, timeout=15)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")
        script_tag = soup.find("script", id="__NEXT_DATA__", type="application/json")

        if not script_tag or not script_tag.string:
            print("Willys sök: Kunde inte hitta __NEXT_DATA__-taggen.")
            return []

        next_data = json.loads(script_tag.string)

        # Navigera in i JSON-trädet – Axfood/Next.js-strukturen kan variera
        props = next_data.get("props", {})
        page_props = props.get("pageProps", {})

        # Försök flera möjliga vägar till sökresultaten
        products = []

        # Väg 1: initialState -> search -> results
        initial_state = page_props.get("initialState", {})
        search_data = initial_state.get("search", {})
        products = search_data.get("results", [])

        # Väg 2: searchResult -> results
        if not products:
            search_result = page_props.get("searchResult", {})
            products = search_result.get("results", [])

        # Väg 3: products direkt under pageProps
        if not products:
            products = page_props.get("products", [])

        # Väg 4: Sök rekursivt efter en lista med "name"-fält
        if not products:
            products = _find_product_list(next_data)

        if not products:
            print("Willys sök: Hittade inga produkter i __NEXT_DATA__.")
            return []

        # Ta max 3 första produkterna
        results = []
        for item in products[:3]:
            # Bild-URL
            image_url = ""
            img = item.get("image")
            if isinstance(img, dict):
                img_url = img.get("url", "")
                if img_url:
                    if img_url.startswith("http"):
                        image_url = img_url
                    else:
                        image_url = IMAGE_BASE + img_url.lstrip("/")
            elif isinstance(img, str) and img:
                if img.startswith("http"):
                    image_url = img
                else:
                    image_url = IMAGE_BASE + img.lstrip("/")

            # Pris med enhet
            price_val = item.get("price", "")
            price_unit = item.get("priceUnit", item.get("comparePriceUnit", ""))
            price_str = f"{price_val} kr" if price_val else ""
            if price_unit and price_str:
                price_str += f" ({price_unit})"

            results.append({
                "store": "Willys Ord.pris",
                "product": item.get("name", "Okänd produkt"),
                "brand": item.get("manufacturer", ""),
                "price": price_str,
                "discount": "",
                "description": item.get("displayVolume", ""),
                "image_url": image_url,
                "original_price": "",
                "discount_percentage": 0,
            })

        return results

    except requests.RequestException as e:
        print(f"Willys sök: Nätverksfel – {e}")
        return []
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        print(f"Willys sök: Fel vid parsning av data – {e}")
        return []
    except Exception as e:
        print(f"Willys sök: Oväntat fel – {e}")
        return []


def _find_product_list(data, depth=0) -> list:
    if depth > 20: return []
    if isinstance(data, list):
        products = [i for i in data if isinstance(i, dict) and "name" in i and "price" in i]
        if products: return products
        for element in data:
            res = _find_product_list(element, depth + 1)
            if res: return res
    elif isinstance(data, dict):
        for key, val in data.items():
            res = _find_product_list(val, depth + 1)
            if res: return res
    return []
