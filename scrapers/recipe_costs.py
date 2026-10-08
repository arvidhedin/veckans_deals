"""
recipe_costs.py - Roughly what a recipe costs per portion.

Every ingredient line gets its amount in kg ("2 dl grädde" is 0.2 kg, "2 gula lökar" 0.24 kg,
"1 förp kokta bönor (à 400 g)" 0.4 kg) and what that amount costs at Willys' ordinary price
("cost"). The site uses the offer's price instead when the ingredient is on offer in the
chosen stores. Lines without an amount ("salt och peppar", "rostade rotfrukter" to serve
with) cost nothing.

Willys' ordinary prices come from its product search. A product counts for an ingredient when
it is that very product (recipes._Offer.is_, or the ingredient's words in Willys' order, "Lök
Röd" for rödlök), and the cheapest plausible price among them is used. A line with several
alternatives ("torsk eller sej", "t ex lax") costs the cheapest of them. Lines without a
price cost what their kind of food (category) usually does per kg. Stock (buljong, fond) is
not searched for but has fixed prices. Prices change slowly, so they are kept in
data/ingredient_prices.json and searched again after PRICE_MAX_AGE_DAYS.
"""

import copy
import datetime
import re
import statistics
import time
import urllib.parse

import requests

from scrapers import recipes as R
from scrapers.categorizer import categorize_offer

SEARCH_URL = "https://www.willys.se/axfood/rest/v1/search"
SEARCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}
SEARCH_SIZE = 30
SEARCH_DELAY = 0.15  # seconds between searches
PRICE_MAX_AGE_DAYS = 21
# Old prices searched again per build (new ingredients are always searched)
MAX_REFRESHES = 150

# Never priced: water from the tap, and sub-recipes ("2 sats marinad (från ovan)")
FREE = re.compile(r"vatten$|\bis$|isbitar|\bsats\b|från ovan")

_UNICODE_FRACTIONS = {"½": " 1/2", "¼": " 1/4", "¾": " 3/4", "⅓": " 1/3", "⅔": " 2/3"}
_NUMBER = r"\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?"
_QUANTITY = re.compile(rf"^(?:ca\.?\s+|cirka\s+)?({_NUMBER})(?:\s*[-–]\s*(?:ev\.?\s+)?({_NUMBER}))?\s*(.*)$")

WEIGHT_UNITS = {"g": 0.001, "gram": 0.001, "hg": 0.1, "kg": 1}
VOLUME_UNITS = {"krm": 0.001, "tsk": 0.005, "msk": 0.015, "ml": 0.001, "cl": 0.01, "dl": 0.1, "l": 1, "liter": 1}  # litres
# Bought whole: "1 förp grönsallad" costs a package
PACK_UNITS = re.compile(r"^(?:förp|förpackning(?:ar)?|burk(?:ar)?|ask(?:ar)?|påse|påsar|paket|pkt|flask(?:a|or)|"
                        r"kruk(?:a|or)|knipp(?:e|en|a)|tub(?:er)?|bägare|nät|kartong(?:er)?)$")
PORTION_UNITS = {"port", "portion", "portioner"}

# kg per piece of a unit that depends on the ingredient: "4 skivor cheddarost"
UNIT_WEIGHTS = {
    "skiva": [(r"bröd|limpa|toast|franska", 0.035), (r"citron|lime|apelsin|ingefära", 0.008), (r"rökt|gravad", 0.02),
              (r"karré|kotlett|fläsk|kött|biff", 0.12), ("", 0.02)],
    "kvist": [("", 0.002)],
    "blad": [(r"gelatin", 0.002), ("", 0.0005)],
    "nypa": [("", 0.0005)],
    "näve": [("", 0.025)],
    "stjälk": [("", 0.04)],
    "cm": [(r"purjo|gurka|selleri|zucchini", 0.012), (r"kanel|vanilj", 0.0005), ("", 0.005)],
}
COUNT_UNITS = {
    "st": None, "styck": None, "bit": None, "bitar": None, "huvud": None, "huvuden": None,
    "skiva": "skiva", "skivor": "skiva", "kvist": "kvist", "kvistar": "kvist", "blad": "blad",
    "nypa": "nypa", "näve": "näve", "nävar": "näve", "stjälk": "stjälk", "stjälkar": "stjälk", "cm": "cm",
}

# kg per piece: "2 gula lökar", "4 ägg", "1 vitlöksklyfta". The first that matches the name.
PIECE_WEIGHTS = [
    (r"vitlöksklyft|klyft", 0.005),
    (r"vitlök", 0.05),
    (r"schalottenlök", 0.03),
    (r"salladslök|knipplök|vårlök", 0.02),
    (r"silverlök|pärllök", 0.01),
    (r"purjo", 0.25),
    (r"lök", 0.12),
    (r"sötpotatis", 0.3),
    (r"potatis", 0.1),
    (r"morot|morötter", 0.08),
    (r"palsternack", 0.14),
    (r"rotselleri|kålrot", 0.6),
    (r"kålrabbi", 0.3),
    (r"selleri", 0.04),
    (r"rödbet|gulbet|polkabet|beta\b", 0.12),
    (r"rädis", 0.01),
    (r"soltorkad", 0.006),
    (r"körsbärstomat|cocktailtomat|kvisttomat", 0.015),
    (r"plommontomat", 0.06),
    (r"bifftomat", 0.25),
    (r"tomat", 0.1),
    (r"paprik", 0.15),
    (r"chili|jalapeño|habanero|peppar\b|spansk peppar", 0.015),
    (r"gurka", 0.35),
    (r"zucchini|squash", 0.3),
    (r"aubergine", 0.3),
    (r"avokado", 0.2),
    (r"broccoli", 0.4),
    (r"blomkål", 0.7),
    (r"fänkål", 0.3),
    (r"pak ?choi", 0.12),
    (r"spetskål|vitkål|rödkål|savoykål", 1.0),
    (r"majskolv", 0.25),
    (r"sparris", 0.02),
    (r"champinjon|svamp", 0.02),
    (r"ärtor|ärter", 0.005),
    (r"salladsblad", 0.01),
    (r"salladskål", 0.8),
    (r"isbergs?sallad", 0.5),
    (r"sallad", 0.2),
    (r"citrongräs", 0.02),
    (r"citron", 0.12),
    (r"lime", 0.07),
    (r"apelsin", 0.2),
    (r"äpple|äpplen|päron", 0.15),
    (r"ananas", 1.0),
    (r"mango", 0.4),
    (r"banan", 0.12),
    (r"katrinplommon", 0.01),  # dried
    (r"fikon|aprikos|dadl", 0.04),
    (r"ägg", 0.06),
    (r"lagerblad", 0.0002),
    (r"kanelstång", 0.003),
    (r"stjärnanis", 0.001),
    (r"kardemumma|enbär|kryddpeppar|kryddnejlik|pepparkorn", 0.0001),
    (r"nötter|mandlar", 0.001),
    (r"kvist", 0.002),
    (r"ostskiv", 0.02),
    (r"tärning", 0.01),
    (r"hamburgerbröd|briochebröd|bagel", 0.07),
    (r"tortilla|libabröd|wrap", 0.04),
    (r"pitabröd|naanbröd|nanbröd", 0.08),
    (r"korvbröd", 0.04),
    (r"portionsbröd|minibaguette", 0.06),
    (r"baguette|franska", 0.1),
    (r"landgång", 0.075),
    (r"lasagneplatt|wonton", 0.02),
    (r"mozzarella", 0.125),
    (r"kycklingklubb|kycklingben", 0.12),
    (r"lårfilé", 0.1),
    (r"kycklinglår", 0.25),
    (r"kycklingfilé|kycklingbröst", 0.14),
    (r"kotlett", 0.15),
    (r"fläskfilé", 0.5),
    (r"burgare|hamburgare", 0.15),
    (r"korv", 0.08),
    (r"ansjovis", 0.003),
    (r"lax|torsk|sej|fisk|filé", 0.125),
    (r"kyckling", 1.2),
]
PIECE_WEIGHTS = [(re.compile(pattern), kg) for pattern, kg in PIECE_WEIGHTS]

# kg per portion of what is served with the food: "4 port ris"
PORTION_WEIGHTS = [
    (re.compile(r"potatis|gnocchi"), 0.2),
    (re.compile(r"couscous|bulgur|quinoa|matvete|gryn|korn"), 0.06),
    (re.compile(r"ris\b|ris$"), 0.07),
    (re.compile(r"bröd"), 0.06),
    (re.compile(""), 0.1),  # pasta, nudlar
]

_HERBS = ("persilja|dill|koriander|basilika|gräslök|mynta|timjan|rosmarin|oregano|dragon|körvel|salvia|mejram|"
          "örter|kaffir")

# kg per litre of what is measured by volume: "1 dl havregryn" is 0.035 kg. The first that
# matches the name; what matches none weighs 1 kg per litre ("mjölk", "kokosmjölk", "krossade
# tomater"). Order matters: the oil in "sesamolja" and the paste in "röd currypasta" must be
# found before the sesame and the curry.
DENSITIES = [
    (re.compile(r"soltorkad"), 0.5),                       # also "i olja"
    (re.compile(r"(?<!o)kokt"), 0.6),                      # kokt ris, kokta bönor
    (re.compile(r"olja|smör|margarin"), 0.92),             # sesamolja, jordnötssmör
    (re.compile(r"honung|sirap"), 1.4),
    (re.compile(r"risoni|okokt|\bris\b|basmati|jasmin|couscous|bulgur|quinoa|matvete|linser|polenta"), 0.8),
    (re.compile(r"sås|paste\b|pasta\b|pesto|puré|redning|mjölk|grädde|fraiche|yoghurt|kvarg|smetana|ketchup|"
                r"senap(?!s?frö)|soja|sambal|krossade|passerade|juice|saft|vatten"), 1.0),
    (re.compile(r"mjöl(?!k)|maizena|stärkelse|florsocker"), 0.6),
    (re.compile(r"socker"), 0.85),
    (re.compile(r"salt\b"), 1.2),
    (re.compile(r"flakes|flingor"), 0.3),                  # chiliflakes
    (re.compile(r"pepparrot"), 0.6),                       # not a peppar
    (re.compile(r"pulver|malen|mald|malda|stött|peppar|kummin|kanel|curry|cayenne|kajenn|gurkmeja|kardemumma|"
                r"muskot|nejlik|krydda|kryddmix|blandning|paprika|garam|saffran|sumak|ras el hanout|"
                r"five spices|kakao|enbär"), 0.45),
    (re.compile(r"ingefära"), 0.6),                        # riven ingefära (malen is a spice)
    (re.compile(r"havregryn|havre"), 0.35),
    (re.compile(r"ströbröd"), 0.45),
    (re.compile(r"panko|chips"), 0.3),
    (re.compile(r"parmesan|grana|pecorino"), 0.35),        # riven parmesan
    (re.compile(r"ost\b|västerbotten|cheddar"), 0.4),      # riven ost, smulad ädelost
    (re.compile(rf"(?:färsk|hackad|plockad|finskuren|fryst|blad).*(?:{_HERBS})|(?:{_HERBS}).*blad"), 0.12),
    (re.compile(_HERBS), 0.16),                            # dried (or no word for fresh)
    (re.compile(r"rostad lök"), 0.2),                      # crispy onion
    (re.compile(r"salladslök|knipplök|vårlök"), 0.4),
    (re.compile(r"spenat|rucola|sallad|grönkål|mangold|krasse|skott"), 0.08),
    (re.compile(r"frö|frön|kärnor|sesam|solros"), 0.6),    # before kål: fänkålsfrön
    (re.compile(r"skal\b"), 0.4),                          # citronskal
    (re.compile(r"kål"), 0.4),                             # riven rödkål
    (re.compile(r"lök"), 0.55),
    (re.compile(r"nötter|nöt\b|mandel|cashew|pistage|hasselnöt|valnöt|pecan"), 0.5),
    (re.compile(r"bär\b|jordgubb|hallon|lingon|russin"), 0.6),
    (re.compile(r"kapris|oliver|jalapeño|inlagd"), 0.6),
    (re.compile(r"majs|ärtor|ärter|bönor"), 0.7),
    (re.compile(r"räkor"), 0.6),
    (re.compile(r"flis"), 0.15),                           # rökflis
    (re.compile(r"riven|rivna|rivet|hackad|hackade|strimlad|skivad|tärnad"), 0.5),
]

_PER_UNIT = re.compile(rf"[àá]\s*(?:ca\.?\s*)?({_NUMBER})\s*(g|hg|kg|ml|cl|dl|l)\b")
# "(4 st motsvarar ca 550 g)", "(10 st = ca 800 g)", "(1/2 blomkål motsvarar ca 250 g)",
# "(2 dl motsvarar ca 120 g)": the number, its unit, the weight
_PIECES_WEIGH = re.compile(rf"({_NUMBER})\s*([a-zåäöé]*)\s*(?:motsvarar|=)\s*(?:ca\.?\s*)?({_NUMBER})\s*"
                           r"(g|hg|kg)\b")
_TOTAL = re.compile(rf"\(\s*(?:ca\.?\s*)?({_NUMBER})\s*(g|hg|kg)\b")


def _number(text: str) -> float:
    total = 0.0
    for part in text.replace(",", ".").split():
        if "/" in part:
            numerator, denominator = part.split("/")
            total += float(numerator) / float(denominator) if float(denominator) else 0
        else:
            total += float(part)
    return total


def _kg(number: str, unit: str) -> float:
    """'400', 'g' -> 0.4 (a litre weighs a kg)"""
    return _number(number) * WEIGHT_UNITS.get(unit, VOLUME_UNITS.get(unit, 0))


def _first(table, name: str, default=None):
    return next((value for pattern, value in table if pattern.search(name)), default)


def _density(alternatives: list[str]) -> float:
    """kg per litre of the first alternative that a rule knows: "färsk eller torkad oregano"
    is oregano"""
    return next((kg for kg in (_first(DENSITIES, alt) for alt in alternatives) if kg), 1.0)


def parse_amount(text: str, name: str) -> dict:
    """How much of the ingredient a line uses: {"kg": 0.4}, {"st": 2, "kg": 0.24} (pieces,
    their weight when known) or {"st": 1, "pack": True} (packages, "1 förp grönsallad").
    Empty when the line has no amount ("salt och peppar")."""
    text = str(text or "").lower()
    for fraction, replacement in _UNICODE_FRACTIONS.items():
        text = text.replace(fraction, replacement)
    match = _QUANTITY.match(re.sub(r"\s+", " ", text).strip())
    if not match:
        return {}
    quantity = _number(match.group(1))
    if match.group(2):
        quantity = (quantity + _number(match.group(2))) / 2
    rest = match.group(3)
    if quantity <= 0:
        return {}
    alternatives = R._alternatives(name) or [str(name or "").lower()]
    name = alternatives[0]
    unit = re.sub(r"[.,]$", "", (rest.split() or [""])[0])
    pieces_weigh = _PIECES_WEIGH.search(text)
    pieces = _number(pieces_weigh.group(1)) if pieces_weigh else 0

    if unit in WEIGHT_UNITS:
        return {"kg": quantity * WEIGHT_UNITS[unit]}
    if unit in VOLUME_UNITS:
        # "2 dl skalade räkor (2 dl motsvarar ca 120 g)": the weight is given for the same unit
        if pieces_weigh and pieces_weigh.group(2) == unit and pieces > 0:
            return {"kg": quantity * _kg(pieces_weigh.group(3), pieces_weigh.group(4)) / pieces}
        return {"kg": quantity * VOLUME_UNITS[unit] * _density(alternatives)}
    if unit in PORTION_UNITS:
        return {"kg": quantity * _first(PORTION_WEIGHTS, name)}

    # The weight of one piece or package: "(à 400 g)", "(4 st motsvarar ca 550 g)"
    per_unit = _PER_UNIT.search(text)
    total = _TOTAL.search(text)
    if per_unit:
        piece_kg = _kg(per_unit.group(1), per_unit.group(2))
    elif pieces_weigh and pieces > 0:
        piece_kg = _kg(pieces_weigh.group(3), pieces_weigh.group(4)) / pieces
    elif total:
        piece_kg = _kg(total.group(1), total.group(2)) / quantity
    else:
        piece_kg = None

    if PACK_UNITS.match(unit):
        return {"st": quantity, "pack": True, **({"kg": quantity * piece_kg} if piece_kg else {})}
    if unit in COUNT_UNITS and COUNT_UNITS[unit]:
        piece_kg = piece_kg or _first([(re.compile(p), kg) for p, kg in UNIT_WEIGHTS[COUNT_UNITS[unit]]], name)
    piece_kg = piece_kg or _first(PIECE_WEIGHTS, name)
    return {"st": quantity, **({"kg": quantity * piece_kg} if piece_kg else {})}


# --- Willys' ordinary prices ---

# Words in Willys' product names that don't say what the product is ("Lök Röd Klass 1")
NEUTRAL_WORDS = re.compile(r"^(?:klass|eko|ekologisk|ekologiska|ekologiskt|sverige|knippe|kruka|tetra|kvarn|pack|"
                           r"lösvikt|styck|nät|strut|i|och)$")
NOT_FOOD = {"Hushåll & Hygien"}
VEGETABLE_CATEGORIES = {"Frukt & Grönt", "Skafferi"}
PET_FOOD = re.compile(r"kattmat|hundmat|kattgodis|hundgodis|våtfoder|torrfoder|\bfoder\b")
# Baby food and snus carry the names of fruit and spices ("Banan Mango Från 6 Månader",
# "Lingon Portionssnus")
NOT_FOR_COOKING = re.compile(r"från \d+ mån|\d+\s*-\s*\d+ år|klämmis|tobaksfri|snus")
# Products that only carry the ingredient's name as a flavour ("Parmesan Lätt Crème Fraiche",
# "Jalapeño Amerikans Dressing", "Kryddost Spiskummin"): another product unless the
# ingredient is one too. And the other way round: "grytbas grön curry" is no "Curry Påse".
OTHER_PRODUCTS = re.compile(r"creme fraiche|gräddfil|kryddost|chips|dressing|dipp|salsa|soppa|marmelad|kex\b|"
                            r"wrap\b|skruvar|sås\b|juice|shot\b|nudlar|kattmat|grytbas")

# How an ingredient is prepared at home, which says nothing about the product to buy
# ("finriven ingefära" is ingefära)
HOME_PREPARATION = re.compile(r"\b(?:finriv|grovriv|finskur|grovskur|färskpress|nymal|rumstemperer|mortlad|halverad|"
                              r"urkärnad|plockad|uppvispad|mustig)\w*\s*")
# Ingredients priced as another product: oil is rapsolja, and Willys sells no wine
PRICE_ALIASES = [
    (re.compile(r"^(?:neutral |mat)?olja$"), "rapsolja"),
    (re.compile(r"^(?:torrt |torr )?(?:rött vin|rödvin)$"), "rött matlagningsvin"),
    (re.compile(r"^(?:torrt |torr )?(?:vitt vin|vitvin)$"), "vitt matlagningsvin"),
    (re.compile(r"^(citron|lime|apelsin)skal$"), r"\1"),
    (re.compile(r"^(?:riven |rivna |hyvlad )?parmesan(?:ost)?$"), "parmigiano reggiano"),
    (re.compile(r"^hjärtsallad\w*$"), "romansallad"),
    # Willys has no "pastasås basilika" or "crème fraiche vitlök": a flavour costs what the plain one does
    (re.compile(r"^(pastasås) \w+$"), r"\1"),
    (re.compile(r"^(?:smaksatt |lätt )?(crème fraiche) \S.*$"), r"\1"),
    (re.compile(r"^torkade? (timjan|salvia|rosmarin|oregano|basilika|dragon|mejram|persilja|dill|mynta|örter)$"), r"\1"),
]


# Stock is not searched for (Willys' kg price is for the cubes, so "6 dl hönsbuljong" would
# cost 100 kr): it costs what its cubes or its bottle of concentrate do
STOCK = re.compile(r"buljong|fond\b")
STOCK_PRICE = 4                # kr per litre of stock: "5 dl hönsbuljong", "2 dl kycklingfond"
STOCK_CONCENTRATE_PRICE = 150  # kr per litre of concentrate: "1 msk kalvfond", "konc grönsaksfond"
STOCK_CUBE_PRICE = 1.5         # kr per buljongtärning: "1/2 kycklingbuljongtärning"
CONCENTRATE_MAX_LITRES = 0.05  # fond up to 0.5 dl is concentrate, more of it is stock

# "t ex torsk, lax eller sejfilé" (inside parentheses or not) are alternatives too
EXAMPLES = re.compile(r"\bt(?:\.\s*|\s+)ex\b\.?\s*([^()]*)")
EXAMPLE_SEPARATOR = re.compile(r"\s*,\s*|\s+(?:eller|och)\s+|\s*/\s*")


def _price(text) -> float | None:
    """'2 356,00 kr' -> 2356.0"""
    match = re.search(r"\d+(?:,\d+)?", str(text or "").replace(" ", "").replace("\xa0", ""))
    return float(match.group(0).replace(",", ".")) if match else None


def examples(name: str) -> list[str]:
    """The examples in an ingredient name: "djupfryst fisk (t ex torsk, lax eller sejfilé)"
    gives torsk, lax and sejfilé (recipes._alternatives leaves them out)"""
    match = EXAMPLES.search(name.lower())
    parts = EXAMPLE_SEPARATOR.split(match.group(1)) if match else []
    return [part.strip() for part in parts if part.strip()]


def stock_cost(text: str, alternatives: list[str], amount: dict) -> float | None:
    """What a line of stock costs (None when it isn't stock): "1/2 kycklingbuljongtärning" a
    cube, "5 dl hönsbuljong" or "2 dl kycklingfond" stock, "1 msk kalvfond" or "konc
    grönsaksfond" concentrate"""
    kinds = [alt for alt in alternatives if STOCK.search(alt)]
    if not amount or not kinds:
        return None
    if not amount.get("kg") or (amount.get("st") and not amount.get("pack")):
        return amount.get("st", 1) * STOCK_CUBE_PRICE
    litres = amount["kg"]  # a litre weighs a kg
    splash_of_fond = "buljong" not in kinds[0] and litres <= CONCENTRATE_MAX_LITRES  # "1 msk kalvfond"
    concentrate = re.search(r"\bkonc", text) or splash_of_fond
    return litres * (STOCK_CONCENTRATE_PRICE if concentrate else STOCK_PRICE)


def price_name(alternative: str) -> str:
    """The product to price for an ingredient alternative: "finrivet citronskal" is citron"""
    name = re.sub(r"\s+", " ", HOME_PREPARATION.sub("", alternative.lower())).strip()
    first, _, rest = name.partition(" ")
    if PACK_UNITS.match(first):  # "förp pastasås basilika"
        name = rest
    for pattern, replacement in PRICE_ALIASES:
        name = pattern.sub(replacement, name)
    return name


def search_query(name: str) -> str | None:
    """What to search for: the words that say what the ingredient is ("kruka koriander" is
    koriander)"""
    words = [w for w in R._words(R.NAME_END.sub("", name))
             if not R.PREPARATION_WORDS.match(w) and not PACK_UNITS.match(w)]
    return " ".join(words) or None


def _search(session: requests.Session, query: str) -> list[dict] | None:
    """Willys' products for a search, as offers (None when the search failed)"""
    url = f"{SEARCH_URL}?q={urllib.parse.quote(query)}&page=0&size={SEARCH_SIZE}"
    for attempt in range(3):
        try:
            response = session.get(url, headers=SEARCH_HEADERS, timeout=15)
            response.raise_for_status()
            results = response.json().get("results") or []
            break
        except (requests.RequestException, ValueError) as e:
            if attempt == 2:
                print(f"   [FAIL] Willys search '{query}': {e}")
                return None
            time.sleep(2)
    products = []
    for item in results:
        # Willys writes both "sallad" and "sallat" ("Krispsallat i Kruka")
        product = {"product": re.sub(r"sallat\b", "sallad", item.get("name") or "", flags=re.IGNORECASE),
                   "brand": item.get("manufacturer") or ""}
        product["category"] = categorize_offer(product)
        product.update({
            "price": item.get("priceValue"),
            "price_unit": item.get("priceUnit"),
            "compare_price": _price(item.get("comparePrice")),
            "compare_unit": item.get("comparePriceUnit"),
            "average_weight": item.get("averageWeight"),
        })
        products.append(product)
    return products


def search_price(session: requests.Session, query: str, name: str) -> dict | None:
    """Willys' ordinary price for an ingredient. "gula lökar" finds nothing and "rödlökar" only
    rödlök chips, so the stems ("gul lök", "rödlök") and then the last word are searched too.
    None when the search failed."""
    words = query.split()
    for q in dict.fromkeys([query, " ".join(map(R._stem, words)), words[-1]]):
        products = _search(session, q)
        if products is None:
            return None
        price = reference_price(name, products)
        if price:
            return price
        time.sleep(SEARCH_DELAY)
    return {}


def _strictly_is(index: int, product: dict, ingredient) -> bool:
    """recipes._Offer.is_, where an ingredient the categorizer doesn't know ("röda paprikor",
    "salladslökar") takes the product's category"""
    offer = R._Offer(index, product)
    if ingredient.category == "Övrigt":
        ingredient = copy.copy(ingredient)
        ingredient.category = offer.category
    return offer.is_(ingredient)


def _loosely_is(product: dict, ingredient) -> bool:
    """Willys puts the product first ("Lök Röd Klass 1", "Tomater Krossade"), so here every
    word that says what the product is must be part of the ingredient's name ("rödlök")"""
    category = R.SAME_CATEGORY.get(product["category"], product["category"])
    # Canned vegetables are in Skafferi or Frukt & Grönt ("Tomater Krossade")
    if ingredient.category not in ("Övrigt", category) and {ingredient.category, category} != VEGETABLE_CATEGORIES:
        return False
    words = R._words(product["product"])
    processing = R._processing(words)
    if processing - ingredient.processing or (ingredient.processing - R.COOKED_AT_HOME) - processing:
        return False
    name = "".join(ingredient.text_words)
    stems = [R._stem(w) for w in words if not R.PREPARATION_WORDS.match(w) and not NEUTRAL_WORDS.match(w)]
    # ... and say most of what it is: "Hjärta Ask" is no hjärtsalladshuvud
    return (bool(stems) and all(len(stem) >= 3 and stem in name for stem in stems)
            and sum(map(len, stems)) >= len(ingredient.heads[0]) / 2)


def reference_price(name: str, products: list[dict]) -> dict:
    """Willys' ordinary price for the products that are this ingredient: per kg (or litre),
    per piece ("st", eggs) and per package ("pack"), with the weight of a loose fruit or
    vegetable ("piece_kg", "Lök Gul" 0.175). Empty when no product is the ingredient."""
    ingredient = R._Ingredient(name)
    if not ingredient.ok or ingredient.category in NOT_FOOD:
        return {}
    ingredient.category = R.SAME_CATEGORY.get(ingredient.category, ingredient.category)
    ingredient_types = set(OTHER_PRODUCTS.findall(" ".join(ingredient.text_words)))
    matching = []
    for i, product in enumerate(products):
        text = " ".join(R._words(product["product"]))
        if (product["category"] in NOT_FOOD or PET_FOOD.search(text)
                or NOT_FOR_COOKING.search(product["product"].lower())
                or set(OTHER_PRODUCTS.findall(text)) != ingredient_types):
            continue
        if _strictly_is(i, product, ingredient) or _loosely_is(product, ingredient):
            matching.append(product)

    price = {}
    per_kg = [p for p in matching if p["compare_price"] and p["compare_unit"] in ("kg", "l")]
    if per_kg:
        chosen = _low(per_kg, "compare_price")
        price["kg"] = chosen["compare_price"]
        price["product"] = chosen["product"]
        loose = [p for p in per_kg if p["average_weight"] and p["category"] == "Frukt & Grönt"]
        if loose:
            price["piece_kg"] = _low(loose, "compare_price")["average_weight"]
    per_piece = [p for p in matching if p["compare_price"] and p["compare_unit"] == "st"]
    if per_piece:
        price["st"] = _low(per_piece, "compare_price")["compare_price"]
    packages = [p for p in matching if p["price"] and p["price_unit"] == "kr/st"]
    if packages:
        price["pack"] = _low(packages, "price")["price"]
        price.setdefault("product", _low(packages, "price")["product"])
    return price


def _low(products: list[dict], key: str) -> dict:
    """The cheapest plausible product: the cheapest one that costs at least half of what the
    lower quartile does. One wrong cheap product in the search ("Greek Style Oregano & Olive")
    can't decide the price, and the budget brand wins over the eco and premium ones. (Half the
    median would throw out the cheap "Lök Gul" when shallots and silverlök raise the median, and
    pick a salami for fänkål.)"""
    ranked = sorted(products, key=lambda p: p[key])
    floor = ranked[(len(ranked) - 1) // 4][key] / 2
    return next(p for p in ranked if p[key] >= floor)


def _line_cost(amount: dict, price: dict) -> float | None:
    if not amount or not price:
        return None
    kg = amount.get("kg")
    if not kg and amount.get("st") and price.get("piece_kg") and not amount.get("pack"):
        kg = amount["st"] * price["piece_kg"]
    if kg and price.get("kg"):
        return kg * price["kg"]
    if amount.get("st"):
        # Packages at a package's price, pieces at a price per piece (eggs): "35 briketter"
        # must not cost 35 packages
        per_piece = price.get("pack") if amount.get("pack") else price.get("st")
        if per_piece:
            return amount["st"] * per_piece
    return None


def _category(alternative: str) -> str | None:
    ingredient = R._Ingredient(alternative)
    return R.SAME_CATEGORY.get(ingredient.category, ingredient.category) if ingredient.ok else None


def add_costs(recipe_list: list[dict], prices: dict) -> dict:
    """Sets "kg", "st", "pack" and "cost" (kr at Willys' ordinary price) on every ingredient
    line, searching Willys for the ingredients without a recent price. Returns the prices
    to keep for the next build (only those still used)."""
    today = datetime.date.today()
    lines = []  # (ingredient, amount, [(name to price, search query)], cost of stock)
    for recipe in recipe_list:
        for ingredient in recipe["ingredients"]:
            for key in ("kg", "st", "pack", "cost"):
                ingredient.pop(key, None)
            alternatives = R._alternatives(ingredient["name"])
            if FREE.search(ingredient["text"].lower()) or any(FREE.search(alt) for alt in alternatives):
                alternatives = []
            else:
                alternatives = list(dict.fromkeys(alternatives + examples(ingredient["name"])))
            amount = parse_amount(ingredient["text"], ingredient["name"])
            stock = stock_cost(ingredient["text"].lower(), alternatives, amount)
            names = [] if stock is not None else map(price_name, alternatives)  # stock is not searched for
            queries = [(name, search_query(name)) for name in names]
            lines.append((ingredient, amount, [(alt, q) for alt, q in queries if q], stock))

    def age(query):
        try:
            return (today - datetime.date.fromisoformat(prices[query]["checked"])).days
        except (KeyError, TypeError, ValueError):
            return None

    # Searched: the ingredients without a price, and the oldest prices
    wanted = {}
    for _, amount, alts, _ in lines:
        if not amount:
            continue
        for alt, query in alts:
            wanted.setdefault(query, alt)
    new = [q for q in wanted if age(q) is None]
    old = sorted((q for q in wanted if (age(q) or 0) > PRICE_MAX_AGE_DAYS), key=age, reverse=True)
    session = requests.Session()
    searched = failed = 0
    for query in new + old[:MAX_REFRESHES]:
        price = search_price(session, query, wanted[query])
        searched += 1
        if price is None:
            failed += 1
            continue
        prices[query] = {"checked": today.isoformat(), **price}
        time.sleep(SEARCH_DELAY)

    # Lines without a Willys price cost what their kind of food usually does per kg
    category_prices = {}
    for query, alt in wanted.items():
        if prices.get(query, {}).get("kg"):
            category_prices.setdefault(_category(alt), []).append(prices[query]["kg"])
    typical = {category: statistics.median(values) for category, values in category_prices.items()
               if category in R.FOOD_CATEGORIES and len(values) >= 5}

    priced = unpriced = 0
    for ingredient, amount, alts, stock in lines:
        if amount.get("kg"):
            ingredient["kg"] = round(amount["kg"], 4)
        if amount.get("st"):
            ingredient["st"] = round(amount["st"], 2)
        if amount.get("pack"):
            ingredient["pack"] = True
        if not amount or not (alts or stock is not None):
            continue
        cost = stock
        if cost is None:
            # The cheapest alternative with a price: "torsk, sej eller kolja"
            costs = (_line_cost(amount, prices.get(query, {})) for _, query in alts)
            cost = min((c for c in costs if c is not None), default=None)
        if cost is None and amount.get("kg"):
            # None of them has one: what that kind of food usually costs
            category = _category(alts[0][0])
            if category in typical:
                cost = amount["kg"] * typical[category]
        if cost is None:
            unpriced += 1
        else:
            priced += 1
            ingredient["cost"] = round(cost, 2)

    print(f"   [OK] Recipe costs: {priced} lines priced, {unpriced} without a price "
          f"({searched} Willys searches, {failed} failed)")
    used = {q for _, _, alts, _ in lines for _, q in alts}
    return {q: prices[q] for q in sorted(used) if q in prices}
