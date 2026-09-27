"""
pricing.py - Gemensamma hjälpfunktioner för priser i skraparna.
"""

import re

# Butikernas jämförpris per kg, t.ex. "115:00-127:78/kg" (ICA), "99:78 kr/kg" (Willys),
# "79,80-114kr/kg." (Coop) och "329,00 kr/kg" (Lidl)
_PER_KG = re.compile(r"(\d+(?:[.,:]\d+)?)\s*(?:-\s*(\d+(?:[.,:]\d+)?))?\s*(?:kr)?\s*/\s*kg\b", re.IGNORECASE)


def parse_number(text) -> float | None:
    """'14,90' / '283:33' / '8.1' / 39 -> float"""
    if text is None:
        return None
    match = re.search(r"\d+(?:[.,:]\d+)?", str(text).replace(" ", ""))
    if not match:
        return None
    return float(match.group(0).replace(",", ".").replace(":", "."))


def parse_price_per_kg(text) -> tuple[float, float] | None:
    """Jämförpris per kg ur butikens text -> (lägsta, högsta), t.ex. '115:00-127:78/kg' -> (115.0, 127.78)."""
    match = _PER_KG.search(str(text or ""))
    if not match:
        return None
    low = parse_number(match.group(1))
    high = parse_number(match.group(2)) if match.group(2) else low
    if not low or not high:
        return None
    # Orimligt låg undre gräns (t.ex. ICA:s "1:11-100:00/kg") -> lita bara på den övre
    if low < high * 0.2:
        low = high
    return low, high


def price_per_kg_fields(per_kg: tuple[float, float] | None) -> dict:
    """Fält för deals.json: price_per_kg (lägsta, t.ex. när man väljer den största förpackningen)
    och price_per_kg_max. Tomt om jämförpris per kg saknas."""
    if not per_kg:
        return {}
    low, high = per_kg
    return {"price_per_kg": round(low, 2), "price_per_kg_max": round(high, 2)}


def format_kr(value: float) -> str:
    """39.0 -> '39', 49.95 -> '49,95'"""
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.2f}".replace(".", ",")
