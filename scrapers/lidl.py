import requests
import html
import re

# Fallback flyer identifier if dynamic search fails
DEFAULT_FLYER_ID = "gaeller-29-6-5-7-i-din-butik-erbjudanden-vecka-27"

OVERVIEW_URL = "https://endpoints.leaflets.schwarz/v4/overview?category_id=07e9e871-0e1a-11e7-a7b6-005056ab0fb6"
API_URL = "https://endpoints.leaflets.schwarz/v4/flyer"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json"
}

def _get_active_flyer_ids() -> list[str]:
    """Hämtar de aktuella reklamblads-ID:na dynamiskt."""
    try:
        response = requests.get(OVERVIEW_URL, headers=HEADERS, timeout=5)
        if response.status_code == 200:
            data = response.json()
            flyer_ids = []
            
            categories = data.get("categories", [])
            for category in categories:
                subcategories = category.get("subcategories", [])
                for subcat in subcategories:
                    # Hoppa över recept/broschyrer om vi bara vill ha matreklamblad
                    if "broschyr" in subcat.get("name", "").lower():
                        continue
                    for flyer in subcat.get("flyers", []):
                        if flyer.get("isActive"):
                            # Extrahera flyer_identifier
                            flyer_id = None
                            flyer_json_url = flyer.get("flyerJson", "")
                            match = re.search(r"flyer_identifier=([^&]+)", flyer_json_url)
                            if match:
                                flyer_id = match.group(1)
                            else:
                                abs_url = flyer.get("flyerUrlAbsolute", "")
                                match2 = re.search(r"/reklamblad/([^/]+)", abs_url)
                                if match2:
                                    flyer_id = match2.group(1)
                            
                            if flyer_id:
                                flyer_ids.append(flyer_id)
            
            if flyer_ids:
                return list(dict.fromkeys(flyer_ids))
    except Exception:
        pass
    
    return [DEFAULT_FLYER_ID]

def _parse_offer(page: dict) -> dict:
    """Mappar en reklambladssida till standardformatet."""
    page_number = page.get("number", 0)
    keywords_raw = page.get("keyWords", "")
    
    # Rensa upp HTML-entiteter och städa texten
    description = html.unescape(keywords_raw)
    description = re.sub(r'(?i)&amp;?', '&', description)
    description = description.strip()

    return {
        "store": "Lidl",
        "product": f"Reklamblad Sida {page_number}",
        "brand": "",
        "price": "Se bild",
        "discount": "",
        "description": description,
        "image_url": page.get("image", ""),
        "category": "",
        "restriction": ""
    }

def get_offers() -> list[dict]:
    """Hämtar Lidl-erbjudanden från alla aktiva reklamblad."""
    all_offers = []
    
    # Hämta de aktiva reklambladen dynamiskt
    flyer_ids = _get_active_flyer_ids()
    
    for flyer_id in flyer_ids:
        try:
            params = {
                "flyer_identifier": flyer_id,
                "region_id": "0",
                "region_code": "0",
                "client": "lidl",
                "version": "4"
            }
            
            response = requests.get(API_URL, params=params, headers=HEADERS, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            flyer_obj = data.get("flyer", {})
            pages = flyer_obj.get("pages", [])
            
            for page in pages:
                parsed = _parse_offer(page)
                all_offers.append(parsed)
                
        except Exception as e:
            print(f"Fel vid hämtning av Lidl-erbjudanden ({flyer_id}): {e}")
            
    return all_offers
