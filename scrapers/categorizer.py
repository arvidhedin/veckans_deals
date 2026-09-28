"""
categorizer.py - Sorts the offers into the site's categories.

The product name decides. The last part of a Swedish compound word says what the
product is ("leverpastej" is a pastej, "kebabpizza" a pizza, "vetemjöl" a mjöl), so a
keyword matches a whole word or the end of a compound. When several keywords match,
the first product word wins ("Grillkorv ost & bacon" is korv, "Kvarg vit choklad" kvarg).

When no keyword matches, the store's own category (set by the scrapers) is used.
"""

import re
from collections import defaultdict

# In the order the site shows them
CATEGORIES = [
    "Kött & Fågel",
    "Chark & Pålägg",
    "Fisk & Skaldjur",
    "Mejeri & Ägg",
    "Frukt & Grönt",
    "Bröd & Bageri",
    "Skafferi",
    "Snacks & Godis",
    "Dryck",
    "Frys & Färdigmat",
    "Hushåll & Hygien",
    "Övrigt",
]

# Keywords per category, separated by spaces ("_" is a space inside a phrase):
#   korv         the word or the end of a compound: "korv", "grillkorv"
#   =te          the whole word only (not "baguette")
#   -burgare     only the end of a compound: "kycklingburgare" but not "burgare"
#   kyckling*    the start of a compound: "kycklingfilé" but not "kyckling". The end
#                of a word wins over the start ("kycklingkorv" is korv).
# A longer keyword wins over a shorter one for the same word ("hamburgare" over
# "-burgare"). Accents don't matter: "entrecôte" and "entrecote" are the same.
KEYWORDS = {
    "Kött & Fågel": """
        kött -kyckling kyckling* kycklingfilé kycklingfiléer fläsk fläsk* kalv* lamm*
        kalkon* höna hjort* älg* vildsvin* rådjur* renskav renstek =anka ankbröst färs
        stek biff kotlett kotletter karré entrecôte entrecöte högrev fransyska grytbitar
        bog bringa fläsklägg nötlägg kalvlägg lammlägg innerfilé innerfiléer ytterfilé
        ytterfiléer bröstfilé bröstfiléer lårfilé lårfiléer oxfilé fläsksida grillskiva
        grillskivor revben revbensspjäll ribs kassler picanha pluma steak flapsteak
        tomahawk medaljonger -vingar -klubbor -lår -ben -delar -strimlor =lever -lever
        bräss skav hamburgare =burgare =burger smashburger smash_burger högrevsburgare
        nötburgare lammburgare viltburgare älgburgare hjortburgare vildsvinsburgare
        angusburgare bifteki cevapcici spett pulled_pork pulled_chicken porchetta
        schnitzel schnitzlar hel_kyckling kryddad_kyckling fryst_kyckling färsk_kyckling
    """,
    "Chark & Pålägg": """
        korv korvar korvett isterband salami salame chorizo salsiccia fuet cabanoss
        kabanoss pepperoni medwurst mortadella wurst krainer lukanka sucuk nduja skinka
        prosciutto proscuitto jamón serrano pancetta guanciale bresaola coppa bacon
        pastej paté pålägg smörgåsmat sylta blodpudding lufttorkad lufttorkade
        lufttorkat skivad_grillad_kyckling antipasti tapas tapastallrik delikatesser
        chark charkuterier vegoskivor
    """,
    "Fisk & Skaldjur": """
        fisk fisk* lax lax* laxfilé torsk torsk* torskfilé =sej sej* sejfärs sill sill*
        sillsallad strömming strömming* surströmming* makrill makrill* tonfisk* tuna
        räkor räka räk* kräftor kräfta kräft* hummer krabba krabb* musslor ostron
        skaldjur scampi calamares calamari bläckfisk gös abborre röding öring gädda
        hälleflundra spätta rödspätta* pollock kolja kummel pangasius* tilapia hoki
        sjötunga rödtunga piggvar havskatt surimi surimi* sardeller ansjovis kaviar
        caviar =rom löjrom stenbitsrom torskrom laxrom forellrom sikrom
    """,
    "Mejeri & Ägg": """
        mjölk mjölkdryck =fil a-fil filmjölk gräddfil kefir yoghurt yogurt yoguhurt
        kvarg skyr keso kesella cottage_cheese grädde gräddis fraiche fraice smetana
        smör bregott =lätta =flora margarin -ost -ostar ostskivor präst herrgård greve
        svecia gouda edamer cheddar brie camembert mozzarella burrata mascarpone ricotta
        parmesan parmigiano grana_padano pecorino halloumi norrloumi grilloumi =feta
        chèvre manchego gruyère gruyér comté appenzeller jarlsberg norvegia havarti
        port_salut provolone scamorza raclette emmentaler taleggio gorgonzola roquefort
        kaltbach tomme babybel philadelphia billinge familjefavoriter familjefavorit
        familje_favoriter delice_de_bourgogne bavaria_blu cream_cheese cream_ch
        västerbottens* smakrike =ysta riven_ost rivna_ost pizzatopping pizza_topping
        pizzamix ägg pudding mousse crème_caramel vaniljsås vaniljkräm risifrutti
        mannafrutti rismellis actimel yoggi danonino havredryck mandeldryck sojadryck
        ärtdryck risdryck barista milkshake proteinshake propud ikaffe yalla dessert
        desserter hamburgerost råggyberry
    """,
    "Frukt & Grönt": """
        -frukt grönsaker grönsak rotfrukter äpplen päron banan bananer apelsiner
        clementiner klementiner mandariner satsumas citroner citrus grapefrukt =grape
        kiwi ananas melon meloner druvor royal_gala granny_smith pink_lady plommon
        persikor persika nektarin nektariner aprikoser fikon dadlar granatäpple papaya
        avokado jordgubbar hjortron björnbär vinbär körsbär physalis litchi drakfrukt
        sharon kaki potatis morot morötter gurka gurkor tomater paprikamix sallad
        sallader sallater salladsmix småbladsmix spenat ruccola rucola kål grönkål*
        pak_choi zucchini squash aubergine pumpa champinjoner kantareller skivling
        shiitake palsternacka rödbetor betor selleri sparris majs majskolv majskolvar
        majskorn haricots_verts haricot_verts sockerärtor brytbönor bambuskott groddar
        krasse kålrot jordärtskocka kronärtskocka ärter ärtor basilika persilja
        koriander mynta timjan rosmarin oregano färska_kryddor
    """,
    "Bröd & Bageri": """
        bröd limpa limpan bulle bullar längd fläta kringla kringlor brezel croissant
        croissanter baguette baguetter ciabatta focaccia levain frallor fralla kaka
        kakor tårta tårtor bakelse bakelser muffins muffin munkar munk donut donuts
        bagel bagels kanelsnäck* semla semlor lussekatt lussekatt* scones skorpor knäcke
        tunnbröd pita naan tortilla tortillas wraps toast =rosta rasker -franska gifflar
        brioche pinsa surdeg deg pizzakit brödpinnar éclair macarons pasteis_de_nata
        cheesecake mazarin mazariner =wasa kaffebröd våffla våfflor cinelle pizzabotten
        pizzabottnar fiberrost originalrost strudel grova kusar rågbitar rågform
        kondisbitar =pane pavé panini madalenas magdalenas
    """,
    "Skafferi": """
        kaffe kaffe* espresso espresso* mellanrost mörkrost ljusrost skånerost mörrost
        bönor hela_bönor kapslar =te tepåsar tepåse örtte rooibos =chai earl_grey kakao
        =oboy o'boy nesquik pasta spagetti spaghetti makaroner penne fusilli fusilloni
        tagliatelle fettuccine linguine farfalle rigatoni tortellini tortelloni ravioli
        gnocchi lasagneplattor nudlar =ramen =ris basmatiris jasminris fullkornsris
        risottoris sushiris avorioris havreris råris risotto couscous bulgur quinoa
        quinoamix matvete mathavre gryn gröt välling müsli musli mysli granola flingor
        flakes havrefras kalaspuffar frosties cheerios havreringar havrering choco_rice
        frukostflingor cereal mjöl socker bakpulver jäst sirap honung sylt marmelad
        kompott mos rårörda olja oljor vinäger ättika ättiksprit salt peppar krydda
        kryddor kryddmix kryddblandning kryddspray saffran vaniljstång spiskummin
        paprikapulver chilipulver pulver buljong buljong* fond marinad =taco =tacos sås
        såser sauce =soya =soja dressing majonnäs majonäs mayonnaise =mayo majo aioli
        ketchup senap pesto ajvar salsa gochujang guchujang sambal sriracha ketjap
        tahini hummus kimchi surkål syltlök smörgåsgurka hamburgergurka saltgurka
        bostongurka ättiksgurka syrad_gurka inlagd_gurka cornichons oliver kapris
        kronärtskockshjärtan soltorkade_tomater -puré passerade_tomater krossade_tomater
        tomatkross burk konserv konserver kikärter kikärtor linser gulasch kokosmjölk
        kokosgrädde russin sviskon frön frö kärnor nori rispapper panko ströbröd
        potatismospulver pannkaksmix kakmix brödmix muffinsmix dipmix tacokit taco_kit
        tacoskal tex-mex grytbas grytbaser matlagningsvin barnmat klämmis klämmisar
        nötcreme nötkräm chokladkräm nutella jordnötssmör nötsmör mandelsmör kolakräm
        grönsaksröra sushi-kit sushi_majonnäs snack_pot snackpot passerade krossade
        konserverade rostad_lök stekt_lök sweet_chili jalapeno spice_mix bearnaise
    """,
    "Snacks & Godis": """
        chips snacks snack popcorn popcornkärnor bågar krokar nachos cheez_doodles
        doodles flips nötter nötmix nötblandning mandlar cashew cashew* pistage*
        macadamia djungelmix lakritsmix godismix partymix godis godis* lösviktgodis
        choklad choklad* chokladkaka chokladkakor chokladägg påskägg godisägg
        marsipanbröd praliner tryffel =kola kolor tuggummi pastiller halstabletter
        marshmallows skumtomtar skumbollar gelehallon sega_råttor =bilar ferrari
        ferrari* s-märken gott_&_blandat delicato delicato* mozartkulor nougat marsipan
        marsipan* kex cookies =rån vaniljrån wafer wafers =bar =bars proteinbar
        proteinbars protein_bar chokladbar kvargbar müslibar energibar godisbar nötbar
        fruktbar havrebar frukostbar flapjack stycksaker fruktstång riskakor riskaka
        majskakor majskaka seaweed =dip =dipp cantuccini biscotti digestive digestives
        ballerina brago singoalla oreosandwich tutti_frutti tyrkisk_peber huesitos
        chocolate skumtoppar tuggumi nötsmix russinmix tortilla_chips torkad_frukt halva
    """,
    "Dryck": """
        läsk saft juice must nektar dryck drycker vatten cola pepsi fanta sprite 7up
        zingo trocadero pommac loka ramlösa bonaqua vichy tonic ginger_ale ginger_beer
        iste ice_tea iskaffe energidryck nocco celsius red_bull =monster powerking
        powerade gatorade festis smoothie smoothies shot kombucha cider =öl lättöl
        folköl mojito lemonad limonad lemonade sodavatten glögg nyponsoppa blåbärssoppa
        fun_light god_morgon tropicana brämhults gainomax fruit_crush ramune radler
        peroni dr_pepper pucko cocio vitamin_well ice_coffee iced_coffee ice_coffe
        frappe =dricka nåbe aloe_vera
    """,
    "Frys & Färdigmat": """
        pizza pizzor ristorante grandiosa billys gorbys paj pajer pirog piroger
        empanadas lasagne gratäng soppa gazpacho pytt paella dumplings knödel
        flammkuchen crepes mac_and_cheese gyoza dim_sum wontons vårrullar vårrulle
        bao_buns =sushi nuggets kycklingsnacks chickensnacks =wings buffalo_wings
        fish_bites fish_&_crisp fish_nuggets fish_fingers fiskpinnar fiskbullar
        fiskkakor fiskkaka fiskbiffar panerad panerade sprödbakad cordon_bleu
        gordon_bleu kroketter pommes frites fries potatisklyftor klyftpotatis rösti
        potatisspiral potatisbullar potatismos kroppkakor pannkakor pannkaka plättar
        köttbullar delikatessbullar vegobullar falafel kåldolmar kålpudding laxpudding
        nudellåda leverlåda portionsrätt portionsrätter thaibox thaiboxar wokmix
        wokgrönsaker glass glass* glasspinnar glasspinne glace sorbet gelato gelati
        glasscookies glasstårta ben_&_jerry triumf triumph gelatelli harvest_basket
        fläskschnitzel kycklingschnitzel ostschnitzel ostschnitzlar findus dafgård
        dafgårds chef_select gooh kebab kebabkött gyros döner shawarma -biffar pannbiff
        järpar frikadeller -burgare vegofärs sojafärs quornfärs formbar_färs umamifärs
        oumph quorn tofu tempeh seitan vegetariska_produkter måltidsdelar nothing_fishy
        pizzasallad potatissallad pastasallad räksallad kycklingsallad coleslaw röra
        röror pizzarulle minitoast arancini churros profiteroles knyten grillad_kyckling
    """,
    "Hushåll & Hygien": """
        hundmat kattmat kattfoder hundfoder foder kattsand kattgodis djursnacks
        tuggpinnar tuggben dentastix dentasticks =hund =katt pedigree whiskas latz
        frolic purina sheba tvättmedel tvättkapslar tvättpulver tvättlappar sköljmedel
        fläckborttagning fläck* oxi_action rengöring rengöring* spolglans diskmedel
        maskindisk disktabletter disk* disksvamp rengöringssvamp =wc toalettpapper
        hushållspapper torkpapper bakplåtspapper papper servetter hushållsduk
        microfiberduk tvål tvål* schampo schampo* shampoo =balsam hårbalsam skölj
        munskölj* tandkräm tandborste tandborstar tandborsthuvud tandborsthuvuden
        tandtråd deodorant deoderant =deo duschgel duschkräm duschcreme duschtvål
        rakhyvel rakgel raklödder rakvård rakblad after_shave aftershave ansikts* hud*
        handkräm fotkräm dagkräm nattkräm lotion serum micellar moisturizer babyolja
        baby_oil babytvätt intim* bindor trosskydd tamponger always libresse blöjor
        hårfärg hårvård hårprodukter hårspray hårinpackning hårvax aktiv-gel plåster
        vitamin* vitamin multivitamin omega_3 omega-3 magnesium kreatin creatine
        kosttillskott hälsokost nutrilett måltidsersättning gummies alvedon ipren
        avfallspåse avfallspåsar matlåda matlådor sopsäck sopsäckar pappmugg pappmuggar
        engångs engångs* blöjpåse blöjpåsar soppåse soppåsar fryspåsar plastpåsar
        bajspåsar hundbajspåse påsklämmor folie formar -ljus glödlampa glödlampor
        led_lampor batterier tändstickor tändare grillkol grillbriketter briketter
        tändvätska luftfräschare doftpinnar textilspray swiffer =mopp =hink wettex
    """,
    # Plants and flowers, so that e.g. "Chiliplanta" isn't sorted as a vegetable
    "Övrigt": """
        blommor bukett rosor =ros tulpan tulpaner orkidé orkidé* ljung ljung* azalea
        kalanchoe cyklamen bromelia begonia calathea calathea* kaktus kaktusar suckulent
        suckulent* krysantemum liljor lilja saint_paulia gloxinia campanula alunrot
        murgröna fredskalla beaucarnea pilea palettblad växt växter calandiva amaryllis
        hyacint julstjärna pelargon blomsterlökar blomlökar alliumlökar planta plantor
        kruka krukor prydnadspumpor strumpor
    """,
}

# Words that often name a flavour, a variety or a brand rather than the product:
# "Kvarg vit choklad", "Chips ost & lök", "Ost & broccoli soppa". They only decide
# when no ordinary keyword matches.
WEAK_KEYWORDS = {
    "Kött & Fågel": "=kyckling =kalkon =kalv =lamm =hjort =älg =vildsvin =gris kronfågel guldfågeln familjefågeln",
    "Chark & Pålägg": "lithells pärsons",
    "Fisk & Skaldjur": "kapten_royal",
    "Mejeri & Ägg": """
        =ost =ostar arla skånemejerier norrmejerier valio lindahls oatly alpro castello
        kvibille wernerssons wernersson granarolo
    """,
    "Frukt & Grönt": """
        äpple apelsin citron =lime mango jordgubb hallon blåbär lingon bär =banan
        persika =frukt passionsfrukt rabarber ingefära broccoli spenat tomat paprika
        svamp champinjon chili lök vitlök gräslök dill =mint gurkmeja
    """,
    "Skafferi": """
        kanel kardemumma vanilj curry wasabi kokos inlagd inlagda picklad picklade
        gevalia zoégas löfbergs arvid_nordquist lavazza bellarom santa_maria knorr
        uncle_ben uncle_bens dolmio barilla kungsörnen heinz kania
    """,
    "Snacks & Godis": """
        lakrits karamell =mandel jordnöt pistage torkad torkade marabou cloetta haribo
        malaco olw estrella alesto dumle daim twix snickers bounty kitkat kit_kat =mars
        toblerone toffifee werthers after_eight ahlgrens läkerol mentos fisherman
        stimorol =polly =smash oreo lindt suffeli cruspies geisha corny
    """,
    "Bröd & Bageri": "pågen pågens skogaholm bonjour leksands fazer",
    "Dryck": "kolsyrat alkoholfri",
    "Frys & Färdigmat": "fryst frysta djupfryst =vego vego* vegetariskt =sandwich anamma =magnum kartanon",
    "Hushåll & Hygien": "refill listerine",
}

# Words that decide even when another product word comes first: "Ostschnitzel färdigrätt"
STRONG_KEYWORDS = {
    "Frys & Färdigmat": "färdigrätt färdigrätter färdigmat",
    "Skafferi": "på_burk",  # "Tomater på burk"
}

# Words that never count, e.g. "frukost" isn't a cheese although it ends with "ost"
IGNORED_WORDS = re.compile(r"\b(?:frukost|kompost)\b")

# Frozen fruit, berries and vegetables are sorted with the frozen food
FROZEN = re.compile(r"\b(?:fryst|frysta|djupfryst|findus|freshona|apetit)\b")

# The store's own category, used when no keyword matches (first match wins).
# Lidl: "Food/Mat och nära mat/Kött & fågel/Korv & charkuterier", Coop: "Färsk/Mejeri",
# ICA: "Chark", "Skafferivaror" (see the scrapers).
STORE_CATEGORIES = [
    (r"färdigrätt", "Frys & Färdigmat"),
    (r"frukt|grönt|grönsaker", "Frukt & Grönt"),
    (r"blommor|växter|trädgård", "Övrigt"),
    (r"korv|chark", "Chark & Pålägg"),
    (r"fryst|djupfryst", "Frys & Färdigmat"),
    (r"godis|snacks|konfektyr", "Snacks & Godis"),
    (r"glass|färdigmat|vegetari", "Frys & Färdigmat"),
    (r"fisk|skaldjur", "Fisk & Skaldjur"),
    (r"kött|fågel|fjäderfä|protein", "Kött & Fågel"),
    (r"\bost\b|mejeri|ägg", "Mejeri & Ägg"),
    (r"bröd|bageri|kakor", "Bröd & Bageri"),
    (r"varm dryck|kaffe", "Skafferi"),
    (r"dryck", "Dryck"),
    (r"hushåll|städ|djur|hälsa|skönhet|vård|kem|barn", "Hushåll & Hygien"),
    (r"skafferi|kolonial|matförråd|oljor|kryddor|såser|müsli|sylt|marmelad", "Skafferi"),
]

# Store categories for things that aren't food (Lidl's clothes and tools, flowers).
# Only the Hushåll & Hygien keywords are tried for these, so that e.g. "Silvercrest
# Ostbräda" and "Olje- och vinägerset" end up in Övrigt.
NON_FOOD_STORE_CATEGORY = re.compile(
    r"^(?:nonfood|p\+f)/|^(?:blommor|hem & fritid)\b|blommor & trädgård"
    r"|/(?:hemmet|fritid|köket|el apparater|konfektion|tidningar)",
    re.IGNORECASE,
)

_ACCENTS = str.maketrans("éèêëáàâãíìîóòôõúùûüñçł", "eeeeaaaaiiioooouuuuncl")


def _normalize(text: str) -> str:
    """Lowercase without accents (except å, ä, ö), without "(...)" and hyphenated first parts."""
    text = str(text or "").lower().translate(_ACCENTS)
    text = re.sub(r"[®™]", "", text).replace("´", "'").replace("’", "'").replace("`", "'")
    text = re.sub(r"\(.*?\)", " ", text)  # "Havrefras (Pris med kupong i butik)"
    text = re.sub(r"^v\d{1,2}\s+", "", text)  # ICA week number: "V39 Wasa Sandwich"
    # "Ost- och skinkpaj", "Nöt-/kalkonsalami": the product is the last compound
    text = re.sub(r"\b\w+-\s*(?:,|/|&|och\b|eller\b)\s*", " ", text)
    return IGNORED_WORDS.sub(" ", text)


def _compile(keywords: str) -> list[tuple[re.Pattern, int]]:
    """Keyword string -> [(regex, rank)], one regex per kind of keyword. The regex captures
    the keyword; the rank is 1 for a whole word or word ending and 0 for a word start."""
    kinds = defaultdict(list)
    for keyword in keywords.lower().translate(_ACCENTS).split():
        if keyword.endswith("*"):
            kinds["start"].append(keyword[:-1])
        elif keyword.startswith("="):
            kinds["word"].append(keyword[1:])
        elif keyword.startswith("-") and len(keyword) > 1:
            kinds["compound"].append(keyword[1:])
        else:
            kinds["end"].append(keyword)

    patterns = []
    for kind, words in kinds.items():
        # Longest first, so the most specific keyword wins. "_" in a phrase is any
        # number of spaces ("fish_&_crisp" matches "Fish&Crisp" too).
        words = sorted({r"\s*".join(map(re.escape, w.split("_"))) for w in words}, key=len, reverse=True)
        alternatives = "|".join(words)
        if kind == "start":
            patterns.append((re.compile(rf"\b({alternatives})\w+"), 0))
        elif kind == "word":
            patterns.append((re.compile(rf"\b({alternatives})\b"), 1))
        elif kind == "compound":
            patterns.append((re.compile(rf"\b\w+?({alternatives})\b"), 1))
        else:
            patterns.append((re.compile(rf"\b\w*?({alternatives})\b"), 1))
    return patterns


# (category, strength, patterns): strength 2 is ordinary, 1 weak and 3 strong
_RULES = [
    (category, strength, _compile(keywords))
    for strength, rules in ((2, KEYWORDS), (1, WEAK_KEYWORDS), (3, STRONG_KEYWORDS))
    for category, keywords in rules.items()
]
_STORE_CATEGORIES = [(re.compile(pattern, re.IGNORECASE), category) for pattern, category in STORE_CATEGORIES]


def _best_keyword_match(text: str, strengths=(1, 2, 3), categories=CATEGORIES) -> str | None:
    """The category of the best keyword match in the text: the strongest, then the first
    word, then a word ending over a word start, then the longest keyword."""
    best, best_score = None, None
    for category, strength, patterns in _RULES:
        if strength not in strengths or category not in categories:
            continue
        for pattern, rank in patterns:
            match = pattern.search(text)
            if not match:
                continue
            score = (strength, -match.start(), rank, len(match.group(1)))
            if best_score is None or score > best_score:
                best, best_score = category, score
    return best


def _store_category(raw: str) -> str | None:
    for pattern, category in _STORE_CATEGORIES:
        if pattern.search(raw):
            return category
    return None


def categorize_offer(offer: dict) -> str:
    """Categorize an offer dict into one of CATEGORIES."""
    name = _normalize(f"{offer.get('product') or ''} | {offer.get('brand') or ''}")
    raw_category = str(offer.get("category") or "").strip()

    if raw_category and NON_FOOD_STORE_CATEGORY.search(raw_category):
        return _best_keyword_match(name, categories=["Hushåll & Hygien"]) or "Övrigt"

    # The store's category goes before weak keywords ("Rökt kalkon" is pålägg at Lidl)
    category = (
        _best_keyword_match(name, strengths=(2, 3))
        or (raw_category and _store_category(raw_category))
        or _best_keyword_match(name, strengths=(1,))
        or _best_keyword_match(_normalize(offer.get("description")))
        or "Övrigt"
    )
    if category == "Frukt & Grönt" and (FROZEN.search(name) or re.search(r"fryst", raw_category, re.IGNORECASE)):
        return "Frys & Färdigmat"
    return category
