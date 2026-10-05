"""
recipes.py - Dinner recipes from ica.se/recept built around this week's offers.

A recipe is chosen when its protein (chicken, minced meat, salmon, ...) is on offer in any
store. Every ingredient is matched against all food offers, so the site can rank the recipes
with the most ingredients on offer first (for the stores the visitor has chosen).

The recipe pages don't change, so their ingredients are reused from the previous build and
only new recipes are fetched.
"""

import json
import re
import time

import requests

from scrapers.categorizer import categorize_offer

BASE_URL = "https://www.ica.se/recept/"
IMAGE_URL = "https://assets.icanet.se/t_ICAseAbsoluteUrl/"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "sv-SE,sv;q=0.9",
}

# Recipes per protein: ICA's list pages show the 24 most relevant recipes
RECIPES_PER_PAGE = 24
REQUEST_DELAY = 0.3  # seconds between recipe pages

# (protein, ICA list pages, offer, recipe ingredient). The offer pattern is matched against
# the product name of meat and fish offers, the ingredient pattern against the ingredient
# names of the recipes ("kycklingfilé eller kycklinginnerfilé"). Order matters for the
# ingredient: the first protein that matches it is the recipe's protein.
PROTEINS = [
    ("Kycklinglår", ["kyckling/lar/middag"],
     r"kyckling\w*lår|kycklinglår", r"kyckling\w*lår|lårfilé"),
    ("Kycklingklubbor", ["kyckling/klubbor"],
     r"kyckling(?:ben|klubb|vingar)", r"kyckling(?:ben|klubb|vingar)|kycklingdelar"),
    ("Kycklingfilé", ["kyckling/file/middag"],
     r"kyckling(?!\w*lår)\w*(?:filé|bröst|strimlor)|strimlad kyckling|marinerad kyckling",
     r"kyckling\w*(?:filé|bröst|strimlor)|strimlad kyckling"),
    ("Hel kyckling", ["kyckling/hel"],
     r"\bhel\b.*kyckling|majskyckling|kryddad kyckling", r"^(?:hel |färsk |)(?:maj)?kyckling\b"),
    ("Kycklingfärs", ["kyckling/fars"], r"kycklingfärs", r"kycklingfärs"),
    ("Köttfärs", ["kott/fars/middag"],
     r"(?<!kyckling)(?<!fisk)(?<!kalkon)(?<!taco)färs\b", r"(?:nöt|bland|kött|fläsk|lamm|älg|vilt|hjort)färs|^färs\b"),
    ("Fläskfilé", ["flask/file/middag"], r"fläsk\w*filé", r"fläsk\w*filé"),
    ("Kotlett & karré", ["kotlett", "karre"], r"kotlett|karré", r"kotlett|karré"),
    ("Högrev", ["hogrev/middag"], r"högrev", r"högrev"),
    ("Grytbitar", ["grytbitar/middag"], r"grytbitar", r"grytbit"),
    ("Rostbiff & fransyska", ["rostbiff", "fransyska"], r"fransyska|nötstek|rostbiff", r"fransyska|nötstek|(?<!lamm)rostbiff"),
    ("Oxfilé", ["oxfile"], r"(?<!fläsk)(?:oxfilé|nötytterfilé|ytterfilé av nöt)", r"oxfilé|(?<!fläsk)(?<!lamm)ytterfilé|nötfilé"),
    ("Revbensspjäll", ["revbensspjall"], r"revben|\bribs\b", r"revben"),
    ("Kassler", ["kassler/middag"], r"kassler", r"kassler"),
    ("Fläsklägg & sidfläsk", ["flask/middag"],
     r"stekfläsk|sidfläsk|fläsklägg|rimmat fläsk", r"stekfläsk|sidfläsk|fläsklägg|rimmat fläsk|\bfläsk\b"),
    ("Pulled pork", ["pulled-pork"], r"pulled pork", r"pulled pork|fläskkarré|fläskbog"),
    ("Hamburgare", ["hamburgare"], r"hamburgare|burgare|burger", r"hamburgare|(?<!vego)burgare|hamburgerkött"),
    ("Lamm", ["lamm"], r"lamm", r"lamm"),
    ("Kalv", ["kalv"], r"kalv", r"kalv"),
    ("Älg & vilt", ["alg"], r"älg|hjort|vildsvin|rådjur", r"älg|hjort|vildsvin|rådjur"),
    ("Kalkon", ["kalkon"], r"kalkon", r"kalkon"),
    ("Rökt lax", ["lax"], r"(?:varm|kall)rökt lax|gravad lax|rökt lax", r"rökt lax|gravad lax|rökt laxfilé"),
    ("Lax", ["lax/middag"], r"^(?!.*(?:rökt|gravad)).*lax", r"^(?!.*(?:rökt|gravad)).*lax"),
    ("Torsk", ["torsk"], r"torsk", r"torsk"),
    ("Sej", ["sej"], r"\bsej", r"\bsej"),
    ("Räkor", ["rakor/middag"], r"räk", r"räk"),
]

# Ingredients that are not the protein itself ("kalvfond", "lammkorv")
NOT_PROTEIN = re.compile(r"fond|buljong|korv|lever|vego|sås\b|kryddmix|marinad")

# Proteins whose cuts differ a lot: the recipe's cut must be on offer (lammgrytbitar on offer
# is no lammracks recipe)
SAME_CUT_PROTEINS = {"Lamm", "Kalv", "Älg & vilt"}

PROTEIN_CATEGORIES = {"Kött & Fågel", "Fisk & Skaldjur"}
FOOD_CATEGORIES = {
    "Kött & Fågel", "Chark & Pålägg", "Fisk & Skaldjur", "Mejeri & Ägg", "Frukt & Grönt",
    "Bröd & Bageri", "Skafferi", "Frys & Färdigmat",
}
# Frozen vegetables are in Frys & Färdigmat, fresh ones in Frukt & Grönt
SAME_CATEGORY = {"Frys & Färdigmat": "Frukt & Grönt"}

# Ingredients everyone has at home are never matched
STAPLES = re.compile(
    r"^(?:salt|flingsalt|havssalt|svartpeppar|peppar|vitpeppar|vatten|isbitar|olja|olivolja|"
    r"rapsolja|neutral olja|matolja|socker|strösocker)$"
)

# Words that say how an ingredient is prepared, not what it is ("finhackad persilja")
PREPARATION_WORDS = re.compile(
    r"^(?:färsk|färska|färskt|fryst|frysta|hackad|hackade|finhackad|finhackade|grovhackad|"
    r"riven|rivet|rivna|strimlad|strimlade|skivad|skivade|tärnad|tärnade|kokt|kokta|"
    r"stor|stora|liten|små|mogen|mogna|torkad|torkade|mald|malen|malda|pressad|"
    r"kall|kallt|kalla|varm|varmt|rumsvarmt|rumsvarm|smält|smälta|mjukt|mjuk|fast|fasta|"
    r"ca|förp|port|portioner|st|krm|tsk|msk|dl|cl|ml|l|g|kg|klyfta|klyftor|kvist|kvistar|"
    r"knippe|burk|burkar|paket|påse|bit|bitar|skiva|skivor|nypa|näve|blad|till|att|"
    r"servera|garnering|steka|stekning|valfri|valfritt|valfria|gärna|el|eller|och|med|"
    r"av|à|a|på|i|ev|evt|extra|ekologisk|ekologiska)$"
)

# Irregular plurals and words for part of an ingredient
ALIASES = {
    "morötter": "morot",
    "vitlöksklyfta": "vitlök",
    "vitlöksklyftor": "vitlök",
    "äggula": "ägg",
    "äggulor": "ägg",
    "äggvita": "ägg",
    "äggvitor": "ägg",
    "limejuice": "lime",
    "citronsaft": "citron",
    "citronjuice": "citron",
    "limefrukt": "lime",
    "limefrukter": "lime",
    "potatisar": "potatis",
}

# Compounds that are another food than their last word ("sötpotatis" is not potatis)
DIFFERENT_FOODS = re.compile(
    r"(?:sötpotatis|vitlök|purjolök|salladslök|gräslök|grillost|stekost|kokosmjölk|"
    r"jordnötssmör|kryddsmör|vitlökssmör|kycklingbuljong|grönsaksbuljong|köttbuljong|fiskbuljong|"
    r"tomatpuré|ketchup|äppelmos|vaniljsås|chokladsås|kolasås|kapris|currypasta|tomatpasta|"
    r"färskost|vitost|mjukost|smältost|drickyoghurt|mjölkchoklad)\w*$"
)

_ACCENTS = str.maketrans("éèêëáàâãíìîóòôõúùûüñç", "eeeeaaaaiiioooouuuunc")
_ENDINGS = ("orna", "arna", "erna", "or", "ar", "er", "na", "en", "et", "a", "e", "n")


def _words(text: str) -> list[str]:
    text = re.sub(r"\(.*?\)", " ", str(text or "").lower()).translate(_ACCENTS)
    return re.findall(r"[a-zåäö]+", text)


def _stem(word: str) -> str:
    word = ALIASES.get(word, word)
    for ending in _ENDINGS:
        if word.endswith(ending) and len(word) - len(ending) >= 3:
            return word[: -len(ending)]
    return word


def _same_word(ingredient: str, offer: str, offer_word: str) -> bool:
    """Whether an offer word is the ingredient: the same word, or a compound ending with it
    ("jasminris" is ris, but "gris" is not). Not the other way around: "vitlök" is not lök."""
    if ingredient == offer:
        return True
    return (
        len(ingredient) >= 3
        and offer.endswith(ingredient)
        and len(offer) - len(ingredient) >= 3
        and not DIFFERENT_FOODS.search(offer_word)
    )


def _alternatives(name: str) -> list[str]:
    """ "kycklingfilé eller kycklinginnerfilé" -> both, without "(...)". Half words are left
    out: "kalv- eller nötfärs" is nötfärs, not kalv."""
    name = re.sub(r"\(.*?\)", " ", name.lower())
    parts = re.split(r"\s+eller\s+|\s*/\s*|,", name)
    return [p.strip() for p in parts if p.strip() and not p.strip().endswith("-")]


class _OfferIndex:
    """The food offers, with the stems of their product names"""

    def __init__(self, offers: list[dict]):
        self.offers = []
        for i, offer in enumerate(offers):
            category = SAME_CATEGORY.get(offer.get("category"), offer.get("category"))
            if offer.get("category") not in FOOD_CATEGORIES:
                continue
            # "Vitkål med morot" is vitkål
            name = re.split(r"\s+(?:med|&)\s+", offer.get("product") or "")[0]
            stems = [(w, _stem(w)) for w in _words(name)]
            self.offers.append((i, offer, category, stems))

    def matching(self, name: str) -> list[int]:
        """Indexes of the offers that are this ingredient"""
        found = set()
        for alternative in _alternatives(name):
            if STAPLES.match(alternative):
                continue
            words = [w for w in _words(alternative) if not PREPARATION_WORDS.match(w) and not w.isdigit()]
            if not words:
                continue
            words = [ALIASES.get(w, w) for w in words]
            head, modifiers = _stem(words[-1]), [_stem(w) for w in words[:-1]]
            # Unknown ingredients ("Övrigt") are not matched
            category = categorize_offer({"product": " ".join(words)})
            if category not in FOOD_CATEGORIES:
                continue
            category = SAME_CATEGORY.get(category, category)
            for i, offer, offer_category, stems in self.offers:
                if offer_category != category:
                    continue
                if not any(_same_word(head, stem, word) for word, stem in stems):
                    continue
                # "soltorkade tomater" is not any tomato
                if all(any(stem.startswith(m[:5]) for _, stem in stems) for m in modifiers):
                    found.add(i)
        return sorted(found)


def _get(session: requests.Session, url: str) -> str | None:
    for attempt in range(3):
        try:
            response = session.get(url, headers=HEADERS, timeout=30)
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return response.text
        except requests.RequestException as e:
            if attempt == 2:
                print(f"   [FAIL] {url}: {e}")
                return None
            time.sleep(3)
    return None


def _json_after(html: str, key: str):
    """The JSON value after "key": in the page's data (the whole data is JavaScript, not JSON)"""
    i = html.find(f'"{key}":')
    if i < 0:
        return None
    try:
        value, _ = json.JSONDecoder().raw_decode(html, i + len(key) + 3)
        return value
    except ValueError:
        return None


def get_recipe_cards(session: requests.Session, page: str) -> list[dict]:
    html = _get(session, f"{BASE_URL}{page}/")
    cards = _json_after(html or "", "recipeCards") or []
    return cards[:RECIPES_PER_PAGE]


def get_ingredients(session: requests.Session, url: str) -> tuple[int | None, list[dict]] | None:
    """(portions, [{"text": "2 dl grädde", "name": "grädde"}]) from a recipe page"""
    html = _get(session, url)
    groups = _json_after(html or "", "ingredientGroups")
    if not groups:
        return None
    ingredients = []
    for group in groups:
        for ingredient in group.get("ingredients") or []:
            text = (ingredient.get("text") or "").strip()
            if text:
                ingredients.append({"text": text, "name": (ingredient.get("ingredient") or text).strip()})
    return groups[0].get("portions"), ingredients


def _protein_of(ingredients: list[dict], offer_index: dict[str, list[int]],
                index: "_OfferIndex") -> tuple[str, dict, list[int]] | None:
    """The recipe's protein that is on offer, the ingredient it is and its offers"""
    for protein, _, _, ingredient_pattern in PROTEINS:
        if protein not in offer_index:
            continue
        for ingredient in ingredients:
            if any(re.search(ingredient_pattern, alt) and not NOT_PROTEIN.search(alt)
                   for alt in _alternatives(ingredient["name"])):
                offers = offer_index[protein]
                if protein in SAME_CUT_PROTEINS:
                    offers = sorted(set(offers) & set(index.matching(ingredient["name"])))
                    if not offers:
                        continue
                return protein, ingredient, offers
    return None


def build_recipes(offers: list[dict], previous: list[dict] | None = None) -> list[dict]:
    """Recipes whose protein is on offer, with the offers (indexes in `offers`) per ingredient"""
    # Proteins on offer -> indexes of those offers
    protein_offers: dict[str, list[int]] = {}
    for i, offer in enumerate(offers):
        if offer.get("category") not in PROTEIN_CATEGORIES:
            continue
        name = (offer.get("product") or "").lower()
        for protein, _, offer_pattern, _ in PROTEINS:
            if re.search(offer_pattern, name):
                protein_offers.setdefault(protein, []).append(i)
    print(f"   Proteins on offer: {', '.join(f'{p} ({len(ix)})' for p, ix in protein_offers.items()) or 'none'}")

    cached = {r["id"]: r for r in previous or [] if r.get("id") and r.get("ingredients")}
    index = _OfferIndex(offers)
    session = requests.Session()
    recipes, seen, fetched = [], set(), 0

    for protein, pages, _, _ in PROTEINS:
        if protein not in protein_offers:
            continue
        for page in pages:
            for card in get_recipe_cards(session, page):
                recipe_id = card.get("id")
                if not recipe_id or recipe_id in seen or card.get("hasSponsorship"):
                    continue
                seen.add(recipe_id)

                if recipe_id in cached:
                    portions = cached[recipe_id].get("portions")
                    ingredients = [{"text": i["text"], "name": i["name"]} for i in cached[recipe_id]["ingredients"]]
                else:
                    time.sleep(REQUEST_DELAY)
                    result = get_ingredients(session, card.get("absoluteUrl") or BASE_URL + card["url"].lstrip("/"))
                    fetched += 1
                    if not result:
                        continue
                    portions, ingredients = result

                found = _protein_of(ingredients, protein_offers, index)
                if not found:
                    continue
                recipe_protein, protein_ingredient, offers_for_protein = found

                for ingredient in ingredients:
                    if ingredient is protein_ingredient:
                        ingredient["offers"] = offers_for_protein
                    else:
                        ingredient["offers"] = index.matching(ingredient["name"])
                    ingredient["protein"] = ingredient is protein_ingredient

                rating = card.get("rating") or {}
                recipes.append({
                    "id": recipe_id,
                    "title": card.get("title"),
                    "url": card.get("absoluteUrl"),
                    "image_url": IMAGE_URL + card["imageUrl"] if card.get("imageUrl") else None,
                    "cooking_time": card.get("cookingTime"),
                    "difficulty": card.get("difficulty"),
                    "rating": rating.get("averageRating"),
                    "votes": rating.get("numberOfVotes"),
                    "portions": portions,
                    "protein": recipe_protein,
                    "ingredients": ingredients,
                })

    print(f"   [OK] Recipes: {len(recipes)} ({fetched} recipe pages fetched, the rest from the previous build)")
    return recipes
