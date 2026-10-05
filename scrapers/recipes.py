"""
recipes.py - Dinner recipes from ica.se/recept built around this week's offers.

A recipe is chosen when its protein (chicken, minced meat, salmon, ...) is on offer in any
store. Every ingredient is matched against all food offers, so the site can rank the recipes
with the most ingredients on offer first (for the stores the visitor has chosen).

An offer counts only when it is that very product (_Offer.is_): the same word or a more
specific kind ending with it ("Svensk nötfärs" is nötfärs, "Delikatesspotatis" potatis), not
another product starting with it ("Högrevsburgare" is no högrev), from another animal
("Lammkotlett") or processed ("Varmrökt lax", "Marinerad kycklingfilé").

The recipe pages don't change, so their ingredients are reused from the previous build and
only new recipes are fetched.
"""

import json
import re
import time
from functools import lru_cache

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

# (protein, ICA list pages, offer, recipe ingredient). The offer pattern decides which list
# pages are fetched: those of the proteins with a meat or fish offer this week. The
# ingredient pattern finds the recipe's protein ("kycklingfilé eller kycklinginnerfilé") and
# names it (the first that matches). The protein is on offer when an offer is that very
# product (_Offer.is_), so "Högrevsburgare" on offer is no högrev recipe.
PROTEINS = [
    ("Kycklinglår", ["kyckling/lar/middag"],
     r"kyckling\w*lår|kycklinglår", r"kyckling\w*lår|lårfilé"),
    ("Kycklingklubbor", ["kyckling/klubbor"],
     r"kyckling(?:ben|klubb|vingar)", r"kyckling(?:ben|klubb|vingar)|kycklingdelar"),
    ("Kycklingfilé", ["kyckling/file/middag"],
     r"kyckling(?!\w*lår)\w*(?:filé|bröst|strimlor)|strimlad kyckling|marinerad kyckling",
     r"kyckling(?!\w*lår)\w*(?:filé|bröst|strimlor)|strimlad kyckling"),
    ("Hel kyckling", ["kyckling/hel"],
     r"\bhel\b.*kyckling|majskyckling|kryddad kyckling", r"^(?:hel |färsk |)(?:maj)?kyckling\b"),
    ("Kycklingfärs", ["kyckling/fars"], r"kycklingfärs", r"kycklingfärs"),
    ("Köttfärs", ["kott/fars/middag"],
     r"(?<!kyckling)(?<!fisk)(?<!kalkon)(?<!taco)färs\b", r"(?:nöt|bland|kött|fläsk|lamm|älg|vilt|hjort)färs|^färs\b"),
    ("Fläskfilé", ["flask/file/middag"], r"fläsk\w*filé", r"fläsk\w*filé"),
    ("Kotlett & karré", ["kotlett", "karre"], r"kotlett|karré", r"kotlett|karré"),
    ("Högrev", ["hogrev/middag"], r"högrev", r"högrev(?!s?(?:burgare|färs))"),
    ("Grytbitar", ["grytbitar/middag"], r"grytbitar", r"grytbit"),
    ("Rostbiff & fransyska", ["rostbiff", "fransyska"], r"fransyska|nötstek|rostbiff", r"fransyska|nötstek|(?<!lamm)rostbiff"),
    ("Lövbiff & ryggbiff", [], r"lövbiff|ryggbiff|entrecôte", r"lövbiff|ryggbiff|entrecôte"),
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

PROTEIN_CATEGORIES = {"Kött & Fågel", "Fisk & Skaldjur"}

FOOD_CATEGORIES = {
    "Kött & Fågel", "Chark & Pålägg", "Fisk & Skaldjur", "Mejeri & Ägg", "Frukt & Grönt",
    "Bröd & Bageri", "Skafferi", "Frys & Färdigmat",
}
# Frozen vegetables are in Frys & Färdigmat, fresh ones in Frukt & Grönt
SAME_CATEGORY = {"Frys & Färdigmat": "Frukt & Grönt"}

# Ingredients everyone has at home are never matched (stems: "grovt salt", "neutral olja")
STAPLES = {"salt", "flingsalt", "havssalt", "peppar", "svartpeppar", "vitpeppar", "vatt", "isbit",
           "olj", "olivolj", "rapsolj", "matolj", "sock", "strösock"}

# Words that say how an ingredient is prepared or packed, not what it is ("finhackad persilja",
# "benfria kotletter", "portionsbitar laxfilé")
PREPARATION_WORDS = re.compile(
    r"^(?:färsk|färska|färskt|fryst|frysta|tinad|tinade|hackad|hackade|finhackad|finhackade|"
    r"grovhackad|riven|rivet|rivna|strimlad|strimlade|skivad|skivade|skivat|tunnskivad|tunnskivade|"
    r"tärnad|tärnade|kokt|kokta|stor|stora|liten|lilla|små|mogen|mogna|torkad|torkade|mald|malen|"
    r"malda|finmalen|grovmald|pressad|kall|kallt|kalla|varm|varmt|rumsvarmt|rumsvarm|smält|smälta|"
    r"mjukt|mjuk|fast|fasta|benfri|benfria|benfritt|tunn|tunna|tunt|tjock|tjocka|tjockt|odlad|"
    r"odlade|putsad|putsade|hel|hela|helt|svensk|svenska|färdig|färdiga|mittbit|mittbitar|"
    r"urbenad|urbenade|djupfryst|djupfrysta|avrunnen|avrunna|rå|råa|tinat|"
    r"portionsbit|portionsbitar|ca|förp|port|portioner|st|krm|tsk|msk|dl|cl|ml|l|g|kg|klyfta|"
    r"klyftor|kvist|kvistar|knippe|burk|burkar|paket|påse|ask|bit|bitar|skiva|skivor|sats|nypa|"
    r"näve|blad|till|att|servera|garnering|steka|stekning|valfri|valfritt|valfria|gärna|el|eller|"
    r"och|med|av|à|a|på|i|ev|evt|extra|ekologisk|ekologiska)$"
)
# "hel" is a preparation word except in "hel kyckling"
WHOLE_BIRD = re.compile(r"\bhel(?:a)?\s+(?:maj)?kyckling")

# The rest of the name says how the ingredient is cut or served: "lax i bit", "kycklinglår
# med skinn". Examples and wishes end the whole name: "nötkött t ex bog eller högrev" is
# nötkött, "nötfärs gärna ICAs nötfärs 12%" nötfärs.
NAME_END = re.compile(r"\s+(?:i|med|utan|till|för|på|som)\b.*$")
EXAMPLES = re.compile(r"\s+(?:t\s*\.?\s*ex\b|gärna|helst|typ)\b.*$")

# Things a recipe and an offer can disagree on although the product is the same:
# (in one, in the other)
CONFLICTS = [
    (re.compile(r"\bmed ben\b"), re.compile(r"\bbenfri|\butan ben\b|\burbenad")),
    (re.compile(r"\bmed skal\b|\boskalade?\b"), re.compile(r"\b(?:hand)?skalade?\b")),
]
# Sliced rostbiff in a recipe is pålägg, not the raw roast
SLICED = re.compile(r"\bskivad|\bskivor\b|\bi skivor\b")

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
    "revben": "revbensspjäll",
    "gris": "fläsk",
    "griskött": "fläsk",
}

# Names for the same product, on both the ingredients and the offers (without accents)
SYNONYMS = [
    (re.compile(r"^(kyckling|kalkon)bröst(?:file\w*)?$"), r"\1file"),  # kycklingbröstfilé is kycklingfilé
    (re.compile(r"^(?:fläsk|gris)(kotlett\w*|karre\w*)$"), r"\1"),     # an unqualified kotlett is fläsk
    (re.compile(r"(?:hamburgare|hamburger|burgers?)$"), "burgare"),
    (re.compile(r"^(älg|hjort|vilt|ren|vildsvin|lamm|kalv)köttfärs$"), r"\1färs"),
    (re.compile(r"^(\w+?)(nöt|lamm|kalv|vilt|älg|hjort)kött$"), r"\1\2"),
    (re.compile(r"filee(?:r|rna)$"), "file"),                         # filéer
]

# An unqualified ingredient means any of these: "köttfärs" is nötfärs or blandfärs
HEAD_ALTERNATIVES = {
    "köttfärs": ["köttfärs", "nötfärs", "blandfärs"],
    "viltfärs": ["viltfärs", "älgfärs", "hjortfärs", "vildsvinsfärs"],
}

# Words too general to stand for a more specific product: "bröd" is not korvbröd
GENERIC_HEADS = {"sås", "bröd", "kött", "fisk", "grönsak", "frukt", "krydd", "kryddmix", "mix", "biff"}

# "Nötstek av fransyska" is fransyska, but "Lövbiff av innanlår" is lövbiff
GENERIC_FORMS = {"stek", "nötstek", "kött", "nötkött"}
# In a recipe, "lövbiff av fransyska" and "mittbit av oxfilé" are fransyska and oxfilé, but
# "pizzadeg av surdeg" is pizzadeg
CUT_FORMS = {"stek", "nötstek", "kött", "nötkött", "lövbiff", "pepparbiff", "biff", "mittbit", "skiv", "bit"}

# Animals. An unqualified cut ("kotlett", "rostbiff", "grytbitar") is nöt or fläsk, so an
# offer from another animal is another product ("Lammkotlett", "Rostbiff av hjort",
# "Kycklingburgare").
ANIMALS = ("nöt", "fläsk", "lamm", "kalv", "älg", "hjort", "vilt", "ren", "rådjur", "vildsvin",
           "kyckling", "kalkon", "anka", "lax", "torsk", "sej", "beef")
DEFAULT_ANIMALS = {"nöt", "fläsk"}
# "viltfärs" is älgfärs, hjortfärs, ...
GAME = {"älg", "hjort", "rådjur", "vildsvin", "ren"}
ANIMAL_WORD = re.compile(rf"^(?:{'|'.join(ANIMALS)}|gris)(?:kött)?$")

# Processed products are another product than the raw ingredient: "varmrökt lax" is not lax,
# "marinerad kycklingfilé" is not kycklingfilé. An offer must not be processed in any way the
# ingredient isn't, and an ingredient that is bought processed ("kallrökt lax", "inlagd gurka",
# "torkad timjan") must be processed in the same way. "kokt potatis" is cooked at home.
PROCESSED = re.compile(
    r"(varmrökt|kallrökt|(?<!lätt)rökt|gravad|inlagd|syrad|picklad|torkad|lufttorkad|panerad|"
    r"sprödbakad|griljerad|kryddad|marinerad|marinad|grillad|stekt|rostad|friterad|smaksatt|kokt|"
    r"provencal)"
)
COOKED_AT_HOME = {"kryddad", "marinerad", "marinad", "grillad", "stekt", "rostad", "friterad", "smaksatt",
                  "kokt", "provencal"}
# A list item that is only an adjective takes the product of the next item ("Gravad, kallrökt lax")
ADJECTIVE = re.compile(r"(?:ade|ad|at|ada|kta|isk|iska|ig|iga|kt)$")

# Words that make an offer a flavoured or sweet product ("Dessert yoghurt", "Filmjölk lemonad")
FLAVOURED = re.compile(r"^(?:vanilj|dessert|frukt|choklad|kola|lemonad|smak|kaffe|espresso|mellanrost|mörkrost|snacks|chips|shot)")

# Fish is sold as fillets, sides or pieces: "lax" is laxfilé or laxsida
FISH_CUTS = ("ryggfil", "rygg", "fil", "sid", "bit")

# Compounds that are another food than their last word ("sötpotatis" is not potatis)
DIFFERENT_FOODS = re.compile(
    r"(?:sötpotatis|vitlök|purjolök|salladslök|gräslök|grillost|stekost|kokosmjölk|"
    r"jordnötssmör|kryddsmör|vitlökssmör|kycklingbuljong|grönsaksbuljong|köttbuljong|fiskbuljong|"
    r"tomatpuré|ketchup|äppelmos|vaniljsås|chokladsås|kolasås|kapris|currypasta|tomatpasta|"
    r"färskost|vitost|mjukost|smältost|drickyoghurt|mjölkchoklad|filmjölk|kärnmjölk|havremjölk|"
    r"sojamjölk|mandelmjölk|chokladmjölk|kattmjölk|fruktyoghurt|dessertyoghurt|granatäpple|"
    r"havreris|kaffebönor|chiliolja|schalottenlök|underlägg)\w*$|^(?:vego|veggie|vegan|quorn|ärt)"
)

# Ends of compounds, to complete "nöt- eller blandfärs" and "kycklingfilé eller -lårfilé"
COMPOUND_TAILS = (
    "lårfilé", "innerfilé", "ytterfilé", "filé", "färs", "kotlett", "kotletter", "karré", "stek",
    "grytbitar", "korv", "buljong", "fond", "skav", "burgare",
)

_ACCENTS = str.maketrans("éèêëáàâãíìîóòôõúùûüñç", "eeeeaaaaiiioooouuuunc")
_ENDINGS = ("orna", "arna", "erna", "or", "ar", "er", "na", "en", "et", "a", "e", "n")


def _words(text: str) -> list[str]:
    text = re.sub(r"\(.*?\)", " ", str(text or "").lower()).translate(_ACCENTS)
    words = []
    for word in re.findall(r"[a-zåäö]+", text):
        word = ALIASES.get(word, word)
        for pattern, replacement in SYNONYMS:
            word = pattern.sub(replacement, word)
        words.append(word)
    return words


def _stem(word: str) -> str:
    for ending in _ENDINGS:
        if word.endswith(ending) and len(word) - len(ending) >= 3:
            return word[: -len(ending)]
    return word


def _fish_base(stem: str) -> str:
    for cut in FISH_CUTS:
        if stem.endswith(cut) and len(stem) - len(cut) >= 3:
            return stem[: -len(cut)]
    return stem


def _processing(words: list[str]) -> set[str]:
    return {m.group(1) for w in words for m in [PROCESSED.search(w)] if m}


def _animal(word: str) -> str | None:
    """The animal a word is from: "nötkött" nöt, "griskött" and "skinkgrytbitar" fläsk"""
    word = re.sub(r"^(?:gris|skink)", "fläsk", word)
    return next((a for a in ANIMALS if word.startswith(a)), None)


def _alternatives(name: str) -> list[str]:
    """ "kycklingfilé eller kycklinginnerfilé" -> both, without "(...)" except "(av nöt)".
    Half words are completed: "nöt- eller blandfärs" is nötfärs or blandfärs, and in
    "grytbitar av lamm eller nöt" the second alternative is grytbitar av nöt."""
    name = re.sub(r"\(\s*((?:av|från)\s[^)]*)\)", r" \1 ", name.lower())
    name = EXAMPLES.sub("", re.sub(r"\(.*?\)", " ", name))
    # "skinn- och benfri laxfilé": the half word is a list of adjectives
    name = re.sub(r"\b[a-zåäöé]+-\s*(?:och|&)\s+", " ", name)
    parts = [p.strip() for p in re.split(r"\s+(?:eller|alt|alternativt)\s+|\s*/\s*|,", name)]
    parts = [p for p in parts if p]

    result = []
    for i, part in enumerate(parts):
        if part.endswith("-") and i + 1 < len(parts):
            # "kalv-, lamm- eller nötfärs": the first whole word after the half words
            word = next((p for p in parts[i + 1:] if not p.endswith("-")), "-").split()[-1]
            tail = next((t for t in COMPOUND_TAILS if word.endswith(t)), None)
            part = part[:-1] + tail if tail else ""
        elif part.startswith("-") and result:
            word = result[-1].split()[-1]
            tail = next((t for t in COMPOUND_TAILS if word.endswith(t)), None)
            part = word[: -len(tail)] + part[1:] if tail else ""
        elif result and all(ANIMAL_WORD.match(w) for w in _words(part)) and " av " in result[0]:
            part = result[0].split(" av ")[0] + " av " + part
        if part and not part.endswith("-"):
            result.append(part)
    return result


class _Ingredient:
    """What an ingredient alternative is: the product word (head), the words that qualify it
    (modifiers, e.g. "soltorkade"), the animal ("grytbitar av nöt") and its category"""

    def __init__(self, alternative: str):
        self.text = alternative
        self.text_words = _words(alternative)
        self.processing = _processing(self.text_words)
        self.animals = {a for a in map(_animal, self.text_words) if a}
        if "vilt" in self.animals:
            self.animals |= GAME
        name = NAME_END.sub("", alternative)
        part, qualifier = (re.split(r"\s+(?:av|från)\s+", name, maxsplit=1) + [""])[:2]
        self.animal = None
        qualifier_words = [w for w in _words(qualifier) if not PREPARATION_WORDS.match(w)]
        part_words = [w for w in _words(part) if not PREPARATION_WORDS.match(w)]
        extra = []
        if qualifier_words and all(ANIMAL_WORD.match(w) for w in qualifier_words):
            self.animal = _animal(qualifier_words[0])
        elif qualifier_words and (not part_words or _stem(part_words[-1]) in CUT_FORMS):
            # "nötstek av fransyska", "mittbit av oxfilé": the product is the second part
            part = qualifier
        else:
            # "pizzadeg av surdeg"
            extra = qualifier_words
        words = [w for w in _words(part) if not PREPARATION_WORDS.match(w)]
        self.ok = bool(words)
        if not self.ok:
            return
        stems = [_stem(w) for w in words]
        self.heads = HEAD_ALTERNATIVES.get(stems[-1], [stems[-1]])
        self.modifiers = stems[:-1] + [_stem(w) for w in extra] + (["hel"] if WHOLE_BIRD.search(name) else [])
        self.category = categorize_offer({"product": " ".join(words + qualifier_words)})
        if stems[-1] == "rostbiff" and SLICED.search(alternative):
            self.category = "Chark & Pålägg"
        # "burkar hela tomater" and "burk majs" are tinned, not fresh
        if self.category == "Frukt & Grönt" and re.search(r"\bburk", alternative):
            self.category = "Skafferi"
        self.is_fish = self.category == "Fisk & Skaldjur"


@lru_cache(maxsize=None)
def _word_category(word: str) -> str:
    return categorize_offer({"product": word})


class _OfferPart:
    """One product in an offer's name ("Bacon, stekfläsk" is two)"""

    def __init__(self, text: str, words: list[str], qualifier_words: list[str]):
        self.text = text
        # Also what the name says after "i" and "med": "Vannameiräkor i marinad"
        self.processing = _processing(_words(text))
        self.flavoured = {w for w in words if FLAVOURED.match(w)}
        self.animals = {a for a in map(_animal, (w for w in words if ANIMAL_WORD.match(w))) if a}
        if qualifier_words and all(ANIMAL_WORD.match(w) for w in qualifier_words):
            # "Grytbitar av lax" is grytbitar, "Rostbiff av hjort" rostbiff
            self.animals.update(a for a in map(_animal, qualifier_words) if a)
        elif words and words[-1] in GENERIC_FORMS:
            # "Nötstek av fransyska" is fransyska
            words = words + qualifier_words
        self.candidates = [(w, _stem(w)) for w in words]
        self.stems = [_stem(w) for w in words + qualifier_words]


class _Offer:
    """What an offer is: its products, the animals they are from and how they are processed"""

    def __init__(self, index: int, offer: dict):
        self.index = index
        self.frozen = offer.get("category") in SAME_CATEGORY
        self.category = SAME_CATEGORY.get(offer.get("category"), offer.get("category"))
        self.text = (offer.get("product") or "").lower()
        # "Torsk- & laxtärningar"
        name = re.sub(r"\b[a-zåäöé]+-\s*(?:och|&|,)\s*", " ", self.text)
        self.parts = []
        texts = [t for t in re.split(r"\s*[,/]\s*", name) if t.strip()]
        for i, text in enumerate(texts):
            # "Kotlett med ben", "Delikatesspotatis i påse", "Surimi formade som räkor"
            product = re.split(r"\s+(?:med|i|som)\s+", text)[0]
            part, qualifier = (re.split(r"\s+(?:av|från)\s+", product, maxsplit=1) + [""])[:2]
            words = _words(part)
            # "Gravad, kallrökt lax" is gravad lax and kallrökt lax
            if i + 1 < len(texts) and words and (
                    _word_category(" ".join(words)) == "Övrigt" or (len(words) == 1 and ADJECTIVE.search(words[0]))):
                words += _words(re.split(r"\s+(?:med|i|som)\s+", texts[i + 1])[0])[-1:]
            self.parts.append(_OfferPart(text, words, _words(qualifier)))

    def is_(self, ingredient: _Ingredient) -> bool:
        """Whether this offer is the ingredient"""
        if self.category != ingredient.category:
            return False
        for part in self.parts:
            for head in ingredient.heads:
                for position, (word, stem) in enumerate(part.candidates):
                    prefix = self._prefix(head, word, stem, ingredient.is_fish)
                    if prefix is None:
                        continue
                    # Frozen: only the vegetable itself ("Fryst mango"), not "Halloweenpotatis"
                    if self.frozen and (prefix or position != len(part.candidates) - 1):
                        continue
                    if self._same_kind(part, word, ingredient, prefix):
                        return True
        return False

    def _same_kind(self, part: _OfferPart, word: str, ingredient: _Ingredient, prefix: str) -> bool:
        animals = part.animals | ({_animal(word), _animal(prefix)} - {None})
        # "Lammkotlett" is not kotlett (fläsk), "Kycklingburgare" not hamburgare
        if any(a not in DEFAULT_ANIMALS and a not in ingredient.animals for a in animals):
            return False
        # "grytbitar av nöt" is not "Grytbitar av gris", and "fransyska av viltkött" not Fransyska
        if ingredient.animal:
            wanted = {ingredient.animal} | (GAME if ingredient.animal == "vilt" else set())
            if (animals and not animals & wanted) or (not animals and ingredient.animal not in DEFAULT_ANIMALS):
                return False
        # "soltorkade tomater" is not any tomato
        if not all(any(s.startswith(m[:5]) for s in part.stems) for m in ingredient.modifiers):
            return False
        # "Varmrökt lax" is not lax, and "kallrökt lax" is not Lax
        if part.processing - ingredient.processing:
            return False
        if (ingredient.processing - COOKED_AT_HOME) - part.processing:
            return False
        # "Grekisk yoghurt citron", "Grillkorv ost & bacon", "Dessert yoghurt": another product
        # or a flavour
        if part.flavoured - set(ingredient.text_words):
            return False
        others = {w for w, _ in part.candidates if w != word and w not in ingredient.text_words}
        if any(_word_category(w) not in ("Övrigt", ingredient.category, self.category)
               and SAME_CATEGORY.get(_word_category(w)) != ingredient.category for w in others):
            return False
        for one, other in CONFLICTS:
            if (one.search(ingredient.text) and other.search(self.text)) or (
                    other.search(ingredient.text) and one.search(self.text)):
                return False
        return True

    @staticmethod
    def _prefix(head: str, word: str, stem: str, is_fish: bool) -> str | None:
        """What the offer word has before the ingredient ("jasmin" in "jasminris"): "" for the
        same word, None when the offer word is not the ingredient ("gris" is not ris, and
        "vitlök" is not lök)"""
        if stem == head:
            return ""
        if is_fish and head not in GENERIC_HEADS:
            base, offer_base = _fish_base(head), _fish_base(stem)
            if offer_base == base:
                return ""
            if offer_base.endswith(base) and len(offer_base) - len(base) >= 3:
                return offer_base[: -len(base)]
        if (
            len(head) >= 3
            and head not in GENERIC_HEADS
            and stem.endswith(head)
            and len(stem) - len(head) >= 3
            and not DIFFERENT_FOODS.search(word)
        ):
            return stem[: -len(head)]
        return None


class _OfferIndex:
    """The food offers"""

    def __init__(self, offers: list[dict]):
        self.offers = [_Offer(i, offer) for i, offer in enumerate(offers)
                       if offer.get("category") in FOOD_CATEGORIES]

    def matching(self, name: str) -> list[int]:
        """Indexes of the offers that are this ingredient (any of its alternatives)"""
        return sorted({i for alternative in _alternatives(name) for i in self.matching_alternative(alternative)})

    @lru_cache(maxsize=None)
    def matching_alternative(self, alternative: str) -> tuple[int, ...]:
        ingredient = _Ingredient(alternative)
        # Unknown ingredients ("Övrigt") are not matched
        if not ingredient.ok or ingredient.category not in FOOD_CATEGORIES or ingredient.heads[0] in STAPLES:
            return ()
        ingredient.category = SAME_CATEGORY.get(ingredient.category, ingredient.category)
        return tuple(offer.index for offer in self.offers if offer.is_(ingredient))


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


def _protein_of(ingredients: list[dict], index: _OfferIndex) -> tuple[str, dict, list[int]] | None:
    """The recipe's protein: the first meat or fish ingredient that is on offer, its name and
    its offers"""
    for ingredient in ingredients:
        alternatives = [alt for alt in _alternatives(ingredient["name"]) if not NOT_PROTEIN.search(alt)]
        proteins = [next((p for p, _, _, pattern in PROTEINS if re.search(pattern, alt)), None) for alt in alternatives]
        if not any(proteins):
            continue
        offers = index.matching(ingredient["name"])
        if offers:
            # Named after the alternative that is on offer: "högrev i bit eller fransyska" with
            # Fransyska on offer is a fransyska recipe
            on_offer = [p for p, alt in zip(proteins, alternatives) if p and index.matching_alternative(alt)]
            return (on_offer or [p for p in proteins if p])[0], ingredient, offers
    return None


def build_recipes(offers: list[dict], previous: list[dict] | None = None) -> list[dict]:
    """Recipes whose protein is on offer, with the offers (indexes in `offers`) per ingredient"""
    # The proteins with a meat or fish offer this week, whose list pages are fetched
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

                found = _protein_of(ingredients, index)
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
