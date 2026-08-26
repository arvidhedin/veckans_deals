"""
categorizer.py - Product categorization module for Veckans Deals
Assigns standard grocery categories without emojis.
"""

import re

CATEGORY_PATTERNS = [
    ("Hushåll & Hygien", r"\b(?:hundmat|kattmat|hund|katt|kattsand|pedigree|whiskas|latz|dentasticks|tvättmedel|tvättkapslar|sköljmedel|rengöring|schampo|shampoo|tvål|handtvål|duschtvål|duschgel|duschcreme|blöjor|blöjpåse|toalettpapper|hushållspapper|tandkräm|diskmedel|fryspåsar|plastpåsar|avfallspåsar|sopsäck|hundbajspåse|deodorant|deo|balsam|lotion|hudkräm|hårfärg|multivitamin|omega 3|vitamin|magnesium|kreatin|creatine|gummies|listerine|munskölj|städservetter|diskborste|disksvamp|diskduk|servetter|hälsa & skönhet|tandborste|tandborsthuvud|värmeljus|rakhyvel|ansiktsmask|bindor|trosskydd|intimtvätt|libresse|batterier|batteri|plastfolie|folie|pappmugg|hink|mopp|tvättlappar|maskindisktabletter)\b"),
    ("Fisk & Skaldjur", r"\b(?:fisk|lax|torsk|räkor|räka|sill|makrill|tonfisk|tuna|tunnfisk|kräftor|kräfta|sej|sejfärs|spätta|musslor|skaldjur|lutfisk|rom|fiskpinnar|fiskkaka|fiskgratäng|surströmming|hummer|krabba|fiskfilé|panerad fisk|bläckfisk|scampi|laxfilé|torskfilé|sejfilé|röding|öring|caviar|kaviar|tångcaviar|surströmmingsfiléer)\b"),
    ("Kött & Fågel", r"kyckling|fläsk|nötkött|oxfilé|lövbiff|rostbiff|entrecote|entrecôte|ryggbiff|högrev|fransyska|karré|karre|kotlett|kalkon|leverpastej|chark|salami|medwurst|pulled pork|revbensspjäll|lamm|blodpudding|falukorv|grillkorv|wienerkorv|varmkorv|ölkorv|bacon|skinka|kassler|kebab|grytbitar|chorizo|cabanoss|salsiccia|prinskorv|smörgåspålägg|prosciutto|jamon|mortadella|paté|pate|schnitzel|grillkarré|flapsteak|spickekött|fuet|grillskiva|grillskivor|grillkött|guldfågeln|kronfågel|familjefågel|\b(?:kött|färs|blandfärs|nötfärs|fläskfärs|korv|korvar|lever|sylta|späck|ribs|nöt|ox|bog|lägg|bringa)\b"),
    ("Mejeri & Ägg", r"\b(?:färskost|mjölk|grädde|smör|ost|ostar|margarin|yoggi|yoghurt|filmjölk|kvarg|ägg|crème fraiche|creme fraiche|fraiche|keso|halloumi|norrloumi|mozzarella|vispgrädde|matlagningsgrädde|bregott|flora|lätta|kesella|gräddfil|ricotta|feta|vitost|brie|camembert|parmesan|parmigiano|gouda|hushållsost|prästost|herrgård|grevé|svecia|västerbottensost|gräddost|havredryck|mandeldryck|sojadryck|oatly|yalla|actimel|danonino|skyr|hamburgerost|smältost|mjukost|skivost|rivost|proteinshake|fil)\b"),
    ("Frukt & Grönt", r"\b(?:frukt|grönsak|grönsaker|grönt|bär|äpple|äpplen|banan|bananer|potatis|färskpotatis|tomat|tomater|gurka|gurkor|sallad|lök|morot|morötter|majs|majskolv|avokado|melon|citron|citroner|apelsin|apelsiner|druvor|jordgubb|hallon|blåbär|paprika|vitlök|champinjon|svamp|clementin|satsumas|nektarin|persika|plommon|kiwi|kolv|broccoli|blomkål|spenat|rotfrukter|sparris|purjolök|ruccola|basilika|persilja|dill|krasse|selleri|palsternacka|rödbetor|kål|vitkål|rödkål|grönkål|lime|ingefära|chili|mango|ananas|päron|vindruvor|grapefrukt|småbladsmix|kronärtskocka|sharon|kaki|granatäpple|solrosor|blommor|bukett|krysantemum|växt|krukväxt)\b"),
    ("Frys & Färdigmat", r"\b(?:thaibox|thaiboxar|enportionsrätter|enportionsrätt|färdigrätt|färdigrätter|matlåda|matlådor|vårrullar|pytt|pizza|pizzor|kebabpizza|pirog|gorbys|billys|dafgård|felix|findus|gooh|nuggets|pommes|glass|gb glace|triumf|paj)\b"),
    ("Bröd & Bageri", r"\b(?:korvbröd|hamburgerbröd|bröd|kaka|kakor|bulle|bullar|tårta|knäcke|knäckebröd|fralla|frallor|pita|pitabröd|tortilla|toast|croissant|limpa|pågen|pågens|fazer|skogaholm|våffla|våfflor|donut|donuts|muffin|muffins|bagel|wienerbröd|kanelbulle|vaniljbulle|semla|kladdkaka|surdeg|rågbröd|lingongrova|hönökaka|vetekaka|tekaka|fullkornsbröd|småbröd|polarbröd|polarkaka|formbröd|formfranska|rostbröd|scones|bageri|pinsa|panini|mellangrova)\b"),
    ("Snacks & Godis", r"\b(?:chips|dipp|godis|choklad|popcorn|nötter|nötblandning|nötmix|kex|ostbågar|ostkrokar|lakrits|tuggummi|marabou|estrella|olw|cloetta|haribo|cheez|snacks|wafer|proteinbar|corny|cashew|mandel|pistage|valnöt|jordnötter|solroskärnor|chiafrön|lösgodis|kexchoklad|daim|twix|snickers|mars|bounty|dumle|geisha|alesto|nutella|halva|delicatoboll|läkerol|halstabletter|fisherman|mentos|gott & blandat|gott och blandat|gott&blandat|malaco)\b"),
    ("Dryck", r"\b(?:läsk|saft|vatten|juice|energidryck|öl|cider|alkoholfri|must|coca-cola|coca cola|cola|pepsi|fanta|sprite|nocco|celsius|red bull|ramlösa|loka|monster|tonic|iskaffe|smoothie|kombucha|dricka|måltidsdryck|lättöl|festis|tropicana|god morgon|brämhults|trocadero|pucko|zingo|7up|powerade|gainomax|proteindryck|fun light|nyponsoppa|fruktdryck|matlagningsvin|peroni|dr pepper|pepper|dryck|nåbe|aloe vera|aloe)\b"),
    ("Skafferi", r"\b(?:jordnötssmör|nötssmör|pasta|ris|basmati|jasminris|risotto|mjöl|socker|olja|vinäger|kaffe|te|sås|ketchup|senap|konserv|linser|bönor|krydda|kryddor|buljong|müsli|musli|granola|cheerios|frosties|cornflakes|havreringar|cereal|flingor|havregryn|pesto|taco|tacos|spaghetti|macaroni|makaroner|matolja|rapsolja|olivolja|majonnäs|mayo|sylt|marmelad|honung|gevalia|zoegas|arvid nordquist|löfbergs|nescafé|nesquik|nudlar|couscous|bulgur|dressing|marinad|salsa|tomatkross|passerade tomater|kokosmjölk|cornichons|oliver|kapris|barnmat|välling|gröt|sirap|ströbröd|tofu|hummus|fond|soja|lasagne|grytbas)\b"),
]


def categorize_offer(offer: dict) -> str:
    """Categorize an offer dict into a standard category name with priority order."""
    text = f"{offer.get('product', '')} {offer.get('brand', '')} {offer.get('description', '')}".lower()
    raw_cat = (offer.get("category") or "").lower()

    for cat_name, pattern in CATEGORY_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return cat_name

    if "frukt" in raw_cat or "grönt" in raw_cat:
        return "Frukt & Grönt"
    if "kött" in raw_cat or "chark" in raw_cat or "fågel" in raw_cat:
        return "Kött & Fågel"
    if "fisk" in raw_cat or "skaldjur" in raw_cat:
        return "Fisk & Skaldjur"
    if "mejeri" in raw_cat or "ost" in raw_cat:
        return "Mejeri & Ägg"
    if "bröd" in raw_cat or "bageri" in raw_cat:
        return "Bröd & Bageri"
    if "dryck" in raw_cat:
        return "Dryck"
    if "snacks" in raw_cat or "godis" in raw_cat:
        return "Snacks & Godis"
    if "djupfryst" in raw_cat or "fryst" in raw_cat:
        return "Frys & Färdigmat"

    return "Övrigt"

