"""
origin.py - Varornas ursprungsland, t.ex. "Sverige" eller "Danmark".

Sajten väljer den svenska varan när samma sorts vara kostar lika mycket i en annan
butik (Veckans bästa deal). Butikerna anger landet på olika sätt: ICA i märket
("Kronfågel. Ursprung Sverige"), Coop före märket ("Danmark/Danish Crown"), Lidl i
punktlistan ("Ursprung: Sverige") och Axfood i produktdatan, ibland på engelska.
"""

import re

# Engelska namn som Axfood (Willys/Hemköp) ibland använder -> svenska
ENGLISH_NAMES = {
    "Sweden": "Sverige", "Denmark": "Danmark", "Norway": "Norge", "Finland": "Finland",
    "Iceland": "Island", "Estonia": "Estland", "Latvia": "Lettland", "Lithuania": "Litauen",
    "Poland": "Polen", "Germany": "Tyskland", "Netherlands": "Nederländerna",
    "Belgium": "Belgien", "France": "Frankrike", "Spain": "Spanien", "Portugal": "Portugal",
    "Italy": "Italien", "Greece": "Grekland", "Ireland": "Irland",
    "United Kingdom": "Storbritannien", "Austria": "Österrike", "Switzerland": "Schweiz",
    "Czechia": "Tjeckien", "Czech Republic": "Tjeckien", "Slovakia": "Slovakien",
    "Hungary": "Ungern", "Bulgaria": "Bulgarien", "Romania": "Rumänien", "Turkey": "Turkiet",
    "China": "Kina", "India": "Indien", "Thailand": "Thailand", "Vietnam": "Vietnam",
    "Cambodia": "Kambodja", "Brazil": "Brasilien", "Argentina": "Argentina",
    "Uruguay": "Uruguay", "Chile": "Chile", "Peru": "Peru", "New Zealand": "Nya Zeeland",
    "Australia": "Australien", "South Africa": "Sydafrika", "Morocco": "Marocko",
    "Egypt": "Egypten", "Kenya": "Kenya", "European Union": "EU",
}

# Kända länder, med gemener: engelskt eller svenskt namn -> svenskt
_KNOWN = {name.lower(): name for name in ENGLISH_NAMES.values()}
_KNOWN.update({english.lower(): name for english, name in ENGLISH_NAMES.items()})

# "Svensk nötfärs", "Svenska äpplen", "Svenskt sidfläsk"
_SWEDISH_NAME = re.compile(r"\bsvensk[at]?\b", re.IGNORECASE)


def _clean(text) -> str:
    """Utan punkt och extra blanksteg (även hårda mellanslag): ' Sverige.\\xa0' -> 'Sverige'"""
    return " ".join(str(text or "").split()).strip(" .")


def country(text) -> str:
    """Landets svenska namn: 'Sweden' och 'Sverige.' -> 'Sverige'. Okända länder lämnas
    som de är, och 'se förp.' eller 'se i butik' ger en tom sträng."""
    text = _clean(text)
    if re.match(r"se\b", text, re.IGNORECASE):
        return ""
    return _KNOWN.get(text.lower(), text)


def known_country(text) -> str:
    """Som country(), men tomt om det inte är ett känt land (Coops märke kan också vara
    "Coca-Cola/Fanta")."""
    return _KNOWN.get(_clean(text).lower(), "")


def from_name(product) -> str:
    """'Sverige' när varans namn säger att den är svensk, annars tomt."""
    return "Sverige" if _SWEDISH_NAME.search(product or "") else ""
