import requests
from bs4 import BeautifulSoup
import urllib.parse
import json
import re

IMAGE_BASE = "https://assets.axfood.se/image/upload/f_auto,t_200/"
SEARCH_API = "https://www.willys.se/axfood/rest/v1/search"
START_URL = "https://www.willys.se/"

# Headers som liknar en vanlig Chrome-webbläsare
SESSION_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/149.0.0.0 Safari/537.36",
    "Accept-Language": "sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7",
    "sec-ch-ua": '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
}


def _extract_csrf_token(session: requests.Session, html: str) -> str | None:
    """Extrahera CSRF-token från HTML eller cookies, testar flera metoder."""

    # Metod 1: <meta name="csrf-token" content="...">
    soup = BeautifulSoup(html, "html.parser")
    meta = soup.find("meta", attrs={"name": "csrf-token"})
    if meta and meta.get("content"):
        return meta["content"]

    # Metod 2: Sök i __NEXT_DATA__ efter csrfToken eller liknande nyckel
    script_tag = soup.find("script", id="__NEXT_DATA__", type="application/json")
    if script_tag and script_tag.string:
        try:
            next_data = json.loads(script_tag.string)
            # Sök rekursivt efter csrf-relaterade nycklar
            token = _find_csrf_in_json(next_data)
            if token:
                return token
        except (json.JSONDecodeError, TypeError):
            pass

    # Metod 3: Sök efter csrf-token i en inline <script>-tagg
    for script in soup.find_all("script"):
        if script.string and "csrf" in script.string.lower():
            match = re.search(r'["\']csrf[_-]?[Tt]oken["\']\s*[:=]\s*["\']([^"\']+)["\']', script.string)
            if match:
                return match.group(1)

    # Metod 4: Hämta från cookien __Host-csrf-token (ibland sätts en separat x-csrf header-cookie)
    for cookie_name in ("x-csrf-token", "__Host-csrf-token", "csrf-token", "XSRF-TOKEN"):
        token = session.cookies.get(cookie_name)
        if token:
            return token

    return None


def _find_csrf_in_json(data, depth=0) -> str | None:
    """Rekursivt sök efter csrf-token i ett JSON-träd."""
    if depth > 10:
        return None
    if isinstance(data, dict):
        for key, val in data.items():
            if "csrf" in key.lower() and isinstance(val, str) and len(val) > 8:
                return val
            result = _find_csrf_in_json(val, depth + 1)
            if result:
                return result
    elif isinstance(data, list):
        for item in data:
            result = _find_csrf_in_json(item, depth + 1)
            if result:
                return result
    return None


def search_regular_assortment(query: str) -> list[dict]:
    """Sök i Willys ordinarie sortiment via REST-API med dynamisk session och CSRF-token."""
    try:
        # 1. Skapa en session som hanterar cookies automatiskt
        session = requests.Session()
        session.headers.update(SESSION_HEADERS)

        # 2. Besök startsidan för att ta emot session-cookies (JSESSIONID, __Host-csrf-token etc.)
        init_response = session.get(
            START_URL,
            headers={"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
            timeout=10,
        )
        init_response.raise_for_status()

        # 3. Extrahera CSRF-token dynamiskt
        csrf_token = _extract_csrf_token(session, init_response.text)
        if csrf_token:
            session.headers["x-csrf-token"] = csrf_token

        # 4. Gör sök-anropet mot Axfood REST-API:et
        search_url = f"{SEARCH_API}?q={urllib.parse.quote(query)}&page=0&size=3"
        api_response = session.get(
            search_url,
            headers={
                "Accept": "*/*",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
            },
            timeout=10,
        )
        api_response.raise_for_status()
        api_json = api_response.json()

        # 5. Hämta produkterna från JSON-svaret
        products = api_json.get("results", [])

        if not products:
            print("Willys sök: Inga sökresultat hittades i API-svaret.")
            return []

        # 6. Mappa de 3 första produkterna till standardformatet
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

            # Styckpris – bara siffror + "kr"
            price_val = str(item.get("price", ""))
            # Rensa bort eventuell befintlig "kr" och trimma
            price_clean = price_val.replace("kr", "").strip()
            price_str = f"{price_clean} kr" if price_clean else ""

            # Jämförpris (kr/kg, kr/l etc.)
            compare_price_raw = str(item.get("comparePrice", ""))
            compare_unit = item.get("comparePriceUnit", "")
            # Rensa "kr" från jämförpriset och normalisera decimaltecken
            compare_price_clean = compare_price_raw.replace("kr", "").replace(".", ",").strip()

            # Bygg description: "500g | Jmf: 153,11 kr/kg"
            display_volume = item.get("displayVolume", "")
            desc_parts = []
            if display_volume:
                desc_parts.append(display_volume)
            if compare_price_clean and compare_unit:
                desc_parts.append(f"Jmf: {compare_price_clean} kr/{compare_unit}")
            elif compare_price_clean:
                desc_parts.append(f"Jmf: {compare_price_clean} kr")
            description = " | ".join(desc_parts)

            results.append({
                "store": "Willys Ord.pris",
                "product": item.get("name", "Okänd produkt"),
                "brand": item.get("manufacturer", ""),
                "price": price_str,
                "discount": "",
                "description": description,
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
