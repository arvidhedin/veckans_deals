"""
categorizer.py - Product categorization module for Veckans Deals
Assigns standard grocery categories without emojis.
"""

import re

CATEGORIES = [
    ("Kött & Fågel", [
        r"kött", r"färs", r"kyckling", r"fläsk", r"nötkött", r"korv", r"bacon", r"skinka",
        r"karré", r"kotlett", r"entrecote", r"biff", r"kalkon", r"lever", r"chark", r"salami",
        r"medwurst", r"medwurt", r"pulled pork", r"ribs", r"rebensspjäll", r"lamm", r"späck",
        r"charkuterier", r"leverpastej", r"falukorv", r"grillkorv", r"wienerkorv", r"blodpudding",
        r"sylta", r"rostbiff", r"oxfilé", r"fläskfilé", r"högrev", r"fransyska", r"schnitzel",
        r"kassler", r"fläskytterfilé", r"kebab", r"grytbitar", r"chorizo", r"cabanoss", r"prinskorv"
    ]),
    ("Fisk & Skaldjur", [
        r"fisk", r"lax", r"torsk", r"räkor", r"räka", r"sill", r"makrill", r"tunnfisk", r"tuna",
        r"kräftor", r"kräfta", r"sej", r"spätta", r"musslor", r"skaldjur", r"lutfisk", r"rogn",
        r"rom\b", r"fiskpinnar", r"fiskkaka", r"fiskgratäng", r"surströmming", r"hummer", r"krabba",
        r"fiskfilé", r"panerad fisk"
    ]),
    ("Mejeri & Ägg", [
        r"mjölk", r"grädde", r"smör", r"ost\b", r"ostar\b", r"margarin", r"yoggi", r"yoghurt",
        r"fil\b", r"filmjölk", r"kvarg", r"ägg", r"crème fraiche", r"creme fraiche", r"keso",
        r"halloumi", r"mozzarella", r"vispgrädde", r"matlagningsgrädde", r"bregott", r"flora",
        r"lätta", r"kesella", r"gräddfil", r"riposta", r"ricotta", r"feta", r"vitost", r"brie",
        r"camembert", r"parmesan", r"goudabron", r"gouda", r"hushållsost", r"prästost", r"herrgård",
        r"grevé", r"svecia", r"västerbottensost", r"havredryck", r"mandeldryck", r"sojadryck", r"oatly"
    ]),
    ("Frukt & Grönt", [
        r"frukt", r"grönsak", r"bär", r"äpple", r"äpplen", r"banan", r"bananer", r"potatis",
        r"tomat", r"tomater", r"gurka", r"gurkor", r"sallad", r"lök", r"morot", r"morötter",
        r"majs", r"avokado", r"melon", r"citron", r"citroner", r"apelsin", r"apelsiner", r"druvor",
        r"jordgubb", r"hallon", r"blåbär", r"paprika", r"vitlök", r"champinjon", r"svamp",
        r"clementin", r"satsumas", r"nektarin", r"persika", r"plommon", r"kiwi", r"kolv", r"broccoli",
        r"blomkål", r"spenat", r"rotfrukter", r"sparris", r"purjolök", r"ruccola", r"basilika",
        r"persilja", r"dill", r"krasse", r"selleri", r"palsternacka", r"rödbetor", r"kål",
        r"salladskål", r"vitkål", r"rödkål", r"grönkål", r"lime", r"ingefära", r"chili",
        r"mango", r"ananas", r"päron", r"vindruvor", r"grapefrukt", r"småbladsmix"
    ]),
    ("Bröd & Bageri", [
        r"bröd", r"kaka", r"kakor", r"bulle", r"bullar", r"tårta", r"knäcke", r"knäckebröd",
        r"fralla", r"frallor", r"pita", r"tortilla", r"toast", r"croissant", r"korvbröd",
        r"hamburgerbröd", r"limpa", r"pågen", r"fazer", r"skogaholm", r"våffl", r"donut",
        r"muffin", r"bagel", r"wienerbröd", r"kanelbulle", r"vaniljbulle", r"semla", r"kladdkaka",
        r"surdeg", r"ljust bröd", r"mörkt bröd", r"rågbröd", r"lingongrova", r"hönökaka"
    ]),
    ("Snacks & Godis", [
        r"chips", r"dipp?\b", r"godis", r"choklad", r"popcorn", r"nötter", r"kex", r"ostbågar",
        r"lakrits", r"tuggummi", r"marabou", r"estrella", r"olw", r"cloetta", r"haribo",
        r"cheez", r"snacks", r"wafer", r"proteinbar", r"cashew", r"mandel", r"pistage",
        r"valnöt", r"jordnötter", r"lösgodis", r"palle kuling", r"mentos", r"aladdin", r"paradise",
        r"kexchoklad", r"daim", r"twix", r"snickers", r"mars", r"bounty", r"dumle", r"geisha"
    ]),
    ("Dryck", [
        r"läsk", r"saft", r"vatten", r"juice", r"energidryck", r"öl", r"cider", r"alkoholfri",
        r"must", r"coca-cola", r"coca cola", r"cola", r"pepsi", r"fanta", r"sprite", r"nocco",
        r"celsius", r"red bull", r"ramlösa", r"loka", r"monster", r"tonic", r"iskaffe",
        r"smoothie", r"kombucha", r"dricka", r"måltidsdryck", r"lättöl", r"festis", r"mer\b",
        r"tropicana", r"god morgon", r"brämhults", r"funktion dryck"
    ]),
    ("Skafferi", [
        r"pasta", r"ris\b", r"mjöl", r"socker", r"olja", r"vinäger", r"kaffe", r"te\b",
        r"sås", r"ketchup", r"senap", r"konserv", r"linser", r"bönor", r"krydda", r"kryddor",
        r"buljong", r"müsli", r"musli", r"flingor", r"havregryn", r"pesto", r"taco", r"tacos",
        r"spaghetti", r"macaroni", r"makaroner", r"matolja", r"rapsolja", r"olivolja",
        r"majonnäs", r"mayo", r"sylt", r"marmelad", r"honung", r"gevalia", r"zoegas",
        r"arvid nordquist", r"löfbergs", r"nescafé", r"nudlar", r"couscous", r"bulgur",
        r"havrefras", r"kallpressad", r"dressing", r"marinad", r"salsa", r"tomatkross",
        r"passerade tomater", r"kokosmjölk", r"tonfisk", r"majsstärkelse", r"ströbröd",
        r"bakpulver", r"vaniljsocker", r"jäst"
    ]),
    ("Frys & Färdigmat", [
        r"fryst", r"djupfryst", r"apfelstrudel", r"pizza", r"pizzor", r"pytt", r"färdigrätt",
        r"glass", r"paj", r"nuggets", r"pommes", r"gb glace", r"triumf", r"dafgård",
        r"findus", r"felix", r"pirog", r"gorbys", r"billys", r"hamburgare", r"kebabtallrik"
    ]),
    ("Hushåll & Hygien", [
        r"tvättmedel", r"sköljmedel", r"rengöring", r"schampo", r"tvål", r"blöjor",
        r"toalettpapper", r"hushållspapper", r"tandkräm", r"diskmedel", r"fryspåsar",
        r"plastpåsar", r"avfallspåsar", r"deodorant", r"deo", r"balsam", r"duschcreme",
        r"duschgel", r"lotion", r"kattmat", r"hundmat", r"multivitamin", r"omega 3",
        r"vitam", r"listerine", r"munskölj", r"städservetter", r"diskborste", r"disksvamp",
        r"servetter", r"hälsa & skönhet", r"tandborste", r"tandsmörj", r"hudkräm"
    ])
]


def categorize_offer(offer: dict) -> str:
    """Categorize an offer dict into a standard category name."""
    raw_cat = (offer.get("category") or "").lower()

    if "frukt" in raw_cat or "grönt" in raw_cat:
        return "Frukt & Grönt"
    if "mejeri" in raw_cat:
        return "Mejeri & Ägg"
    if "bröd" in raw_cat or "bageri" in raw_cat or "kex" in raw_cat:
        return "Bröd & Bageri"
    if "skafferi" in raw_cat:
        prod_desc = f"{offer.get('product', '')} {offer.get('description', '')}".lower()
        if any(w in prod_desc for w in ["städ", "tvätt", "påse", "fryspåse", "servett", "disk"]):
            return "Hushåll & Hygien"
        return "Skafferi"
    if "kött" in raw_cat or "chark" in raw_cat:
        return "Kött & Fågel"
    if "fisk" in raw_cat or "skaldjur" in raw_cat:
        return "Fisk & Skaldjur"
    if "dryck" in raw_cat:
        return "Dryck"
    if "snacks" in raw_cat or "godis" in raw_cat:
        return "Snacks & Godis"

    text = f"{offer.get('product', '')} {offer.get('brand', '')} {offer.get('description', '')}".lower()
    for cat_name, patterns in CATEGORIES:
        for pat in patterns:
            if re.search(r"\b" + pat + r"\b", text) or (len(pat) > 4 and pat in text):
                return cat_name

    if "djupfryst" in raw_cat or "fryst" in raw_cat:
        return "Frys & Färdigmat"
    if "färskvaror" in raw_cat:
        return "Kött & Fågel"

    return "Övrigt"
