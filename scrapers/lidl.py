import requests
import re

from scrapers.pricing import format_kr, parse_price_per_kg, price_per_kg_fields

API_URL = "https://www.lidl.se/q/api/search"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "*/*"
}

def _extract_restriction(data_dict: dict) -> str:
    """Extraherar datum/giltighetstid för erbjudandet."""
    stock_avail = data_dict.get("stockAvailability", {})
    if isinstance(stock_avail, dict):
        badges = stock_avail.get("badgeInfo", {}).get("badges", [])
        if badges and isinstance(badges, list):
            text = badges[0].get("text", "")
            if text:
                return text
        badges_v2 = stock_avail.get("badgeInfoV2", [])
        if isinstance(badges_v2, list) and badges_v2:
            inner_badges = badges_v2[0].get("badges", [])
            if inner_badges and isinstance(inner_badges, list):
                text = inner_badges[0].get("text", "")
                if text:
                    return text
    ribbons = data_dict.get("ribbons")
    if isinstance(ribbons, list) and ribbons:
        if isinstance(ribbons[0], dict):
            text = ribbons[0].get("text", "")
            if text:
                return text
        elif isinstance(ribbons[0], str):
            return ribbons[0]
    stickers = data_dict.get("stickers")
    if isinstance(stickers, list) and stickers:
        if isinstance(stickers[0], dict):
            text = stickers[0].get("text", "")
            if text:
                return text
        elif isinstance(stickers[0], str):
            return stickers[0]
    return ""

def get_offers() -> list[dict]:
    """Hämtar ALLA Lidl-erbjudanden via paginering i sök-API:et."""
    parsed_offers = []
    seen_ids = set()
    offset = 0
    fetchsize = 100

    while True:
        try:
            params = {
                "offset": str(offset),
                "fetchsize": str(fetchsize),
                "locale": "sv_SE",
                "assortment": "SE",
                "version": "1"
            }
            
            response = requests.get(API_URL, params=params, headers=HEADERS, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            items = data.get("items", [])
            num_found = data.get("numFound", 0)

            if not items:
                break
            
            for item in items:
                gridbox = item.get("gridbox", {})
                if not gridbox:
                    continue

                grid_id = gridbox.get("id")
                if grid_id and grid_id in seen_ids:
                    continue
                if grid_id:
                    seen_ids.add(grid_id)

                data_dict = gridbox.get("data", {})
                if not data_dict:
                    continue
                    
                # 1. store
                store = "Lidl"
                
                # 2. product
                product = data_dict.get("fullTitle") or data_dict.get("title") or "Okänd produkt"
                
                # 3. brand
                brand_obj = data_dict.get("brand", {})
                brand = ""
                if isinstance(brand_obj, dict):
                    brand = brand_obj.get("name", "")
                elif isinstance(brand_obj, str):
                    brand = brand_obj
                    
                # 4. Pris och rabatt. Med Lidl Plus är Lidl Plus-priset dealpriset
                #    och det vanliga priset ordinarie pris.
                price_dict = data_dict.get("price") or {}
                normal_price = price_dict.get("price")
                lidl_plus = data_dict.get("lidlPlus")
                lp = lidl_plus[0] if isinstance(lidl_plus, list) and lidl_plus else {}
                lp_price_dict = lp.get("price") or {}

                discount = ""
                original_price_num = None
                discount_percentage = 0
                if lp_price_dict.get("price") is not None:
                    discount = "Lidl Plus"
                    price_num = lp_price_dict["price"]
                    active_price = lp_price_dict
                    if normal_price is not None and normal_price > price_num:
                        original_price_num = normal_price
                    pct_match = re.search(r'(\d+)\s*%', lp.get("highlightText") or "")
                    if pct_match:
                        discount_percentage = int(pct_match.group(1))
                else:
                    price_num = normal_price
                    active_price = price_dict
                    # Vanligt erbjudande med överstruket pris
                    price_discount = price_dict.get("discount") or {}
                    old_price = price_discount.get("deletedPrice") or price_dict.get("oldPrice")
                    if old_price and price_num is not None and old_price > price_num:
                        original_price_num = old_price
                        discount_percentage = int(price_discount.get("percentageDiscount") or 0)

                if not discount_percentage and original_price_num and price_num:
                    discount_percentage = round((1 - price_num / original_price_num) * 100)

                pkg_info = active_price.get("packaging") or {}
                pkg_text = pkg_info.get("text", "") if isinstance(pkg_info, dict) else ""

                base_price_info = active_price.get("basePrice") or {}
                base_price_text = base_price_info.get("text", "") if isinstance(base_price_info, dict) else ""

                pkg_clean = pkg_text.strip().lower()
                base_clean = base_price_text.strip().lower()

                unit_suffix = ""
                description = pkg_text

                # Ett erbjudande är per-kg ENDAST om packaging eller basePrice startar med '/kg'
                if pkg_clean.startswith("/kg") or base_clean.startswith("/kg"):
                    unit_suffix = "/kg"
                    raw = pkg_text if pkg_clean.startswith("/kg") else base_price_text
                    clean_desc = re.sub(r'^/kg\s*', '', raw, flags=re.IGNORECASE).strip(' ()')
                    description = clean_desc
                elif pkg_clean.startswith("/st") or base_clean.startswith("/st"):
                    unit_suffix = "/st"
                    raw = pkg_text if pkg_clean.startswith("/st") else base_price_text
                    clean_desc = re.sub(r'^/st\s*', '', raw, flags=re.IGNORECASE).strip(' ()')
                    description = clean_desc
                else:
                    unit_suffix = ""
                    description = pkg_text

                original_price = f"{format_kr(original_price_num)} kr{unit_suffix}" if original_price_num else ""

                # Jämförpris per kg: kilopriset självt, annars Lidls jämförpris ("329,00 kr/kg")
                if unit_suffix == "/kg" and price_num:
                    per_kg = (price_num, price_num)
                else:
                    per_kg = parse_price_per_kg(base_price_text)

                # Extrahera rabattprocent från ribbons om den inte fanns ovan
                if discount_percentage == 0:
                    ribbons = data_dict.get("ribbons") or []
                    for r in ribbons:
                        r_text = r.get("text", "") if isinstance(r, dict) else str(r)
                        pct_m = re.search(r'-?(\d+)\s*%', r_text)
                        if pct_m:
                            discount_percentage = int(pct_m.group(1))
                            break

                if price_num is not None:
                    try:
                        price_val = float(price_num)
                        if price_val.is_integer():
                            base_price_str = f"{int(price_val)}:-"
                        else:
                            base_price_str = f"{price_val:.2f}".replace(".", ",")
                            if base_price_str.endswith(",00"):
                                base_price_str = base_price_str.replace(",00", ":-")

                        if unit_suffix:
                            price_str = f"{base_price_str}{unit_suffix}"
                        elif not price_val.is_integer() and not base_price_str.endswith(":-"):
                            price_str = f"{base_price_str}/st"
                        else:
                            price_str = base_price_str
                    except Exception:
                        price_str = str(price_num)
                else:
                    price_str = "Se pris i butik"
                    
                image_url = data_dict.get("image", "")
                # Lidls egen kategori, t.ex. "Food/Mat och nära mat/Kött & fågel/Korv & charkuterier"
                # eller "NonFood/Mode & accessoarer/Herrkläder" (används av kategoriseraren)
                keyfacts = data_dict.get("keyfacts") or {}
                won_category = (keyfacts.get("wonCategoryPrimary") or "").removeprefix("Världar i nöd/")
                category = "/".join(filter(None, [data_dict.get("category"), won_category]))
                restriction = _extract_restriction(data_dict)

                # Lidl publicerar ingen innehållsförteckning, men produktsidan kan länkas
                canonical_url = data_dict.get("canonicalUrl") or ""
                product_url = f"https://www.lidl.se{canonical_url}" if canonical_url.startswith("/") else ""

                parsed_offers.append({
                    "store": store,
                    "product": product,
                    "brand": brand,
                    "price": price_str,
                    "discount": discount,
                    "description": description,
                    "image_url": image_url,
                    "category": category,
                    "restriction": restriction,
                    "original_price": original_price,
                    "discount_percentage": discount_percentage,
                    "product_url": product_url,
                    **price_per_kg_fields(per_kg),
                })
            
            offset += len(items)
            if offset >= num_found:
                break
                
        except Exception as e:
            print(f"Fel vid hämtning av Lidl-erbjudanden vid offset {offset}: {e}")
            break
            
    return parsed_offers
