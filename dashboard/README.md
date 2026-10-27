# Portfölj – dashboard.uppsaladeals.se

En privat översikt över alla aktier, fonder och ETF:er du äger, på alla plattformar. Du lägger in
köp, sälj och utdelningar, och sidan hämtar kurser från Avanza och räknar ut värde, dagens
förändring, vinst sedan köp och värdeutveckling över tid.

- `public/` – sidan (HTML, CSS, JS)
- `functions/api/` – Cloudflare Pages Functions: portföljen (KV), kurser, sökning, historik
- `lib/` – kod som funktionerna delar: inloggningskontroll, Avanza-anrop

Repot är publikt, men koden innehåller inga personliga uppgifter. Dina innehav sparas bara i
Cloudflare KV och lämnas bara ut efter en giltig inloggning via Cloudflare Access.

## Sätta upp i Cloudflare (en gång, ca 10 min)

### 1. Skapa Pages-projektet

1. **Workers & Pages → Create → Pages → Connect to Git** och välj repot `veckans_deals`.
2. Projektnamn: t.ex. `uppsaladeals-dashboard`. Production branch: `main`.
3. Framework preset: **None**. Build command: *(tomt)*. Build output directory: `public`.
4. Under **Root directory (advanced)**: `dashboard`.
5. **Save and Deploy**.

Tips: under projektets **Settings → Build → Build watch paths**, sätt *Include paths* till
`dashboard/*`. Då byggs dashboarden inte om varje natt när erbjudandena uppdateras. I
huvudprojektet (uppsaladeals.se) kan du på samma sätt lägga `dashboard/*` under *Exclude paths*.

### 2. Lagring (KV)

1. **Storage & Databases → KV → Create** och kalla namnrymden `portfolio`.
2. I Pages-projektet: **Settings → Bindings → Add → KV namespace**.
   Variable name: `PORTFOLIO`. KV namespace: `portfolio`.

### 3. Subdomänen

I Pages-projektet: **Custom domains → Set up a custom domain** → `dashboard.uppsaladeals.se`.
DNS-posten skapas automatiskt eftersom domänen redan ligger i Cloudflare.

### 4. Inloggning med Cloudflare Access

1. Öppna **Zero Trust** (one.dash.cloudflare.com). Första gången väljer du ett teamnamn, t.ex.
   `uppsaladeals`, vilket ger `uppsaladeals.cloudflareaccess.com`. Välj gratisplanen (upp till 50
   användare).
2. **Access → Applications → Add an application → Self-hosted**.
   - Application name: `Portfölj`
   - Session duration: t.ex. `1 month`, så att du slipper logga in hela tiden
   - Application domain: `dashboard.uppsaladeals.se`
   - Lägg till en domän till: `uppsaladeals-dashboard.pages.dev` (projektets egen adress)
3. Policy: namn `Bara jag`, Action **Allow**, Include → **Emails** → din mejladress.
4. Inloggningsmetod: **One-time PIN** är påslaget från början. Du får en kod till mejlen.
5. Spara. Öppna applikationen igen och kopiera **Application Audience (AUD) Tag**.

### 5. Miljövariabler

I Pages-projektet: **Settings → Variables and Secrets → Add** (Production):

| Namn | Värde |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `uppsaladeals.cloudflareaccess.com` (ditt teamnamn) |
| `ACCESS_AUD` | AUD-taggen från steg 4 |
| `ALLOWED_EMAILS` | din mejladress (kommaseparera om fler) |

Gör sedan om senaste deployen (**Deployments → … → Retry deployment**), så att
variablerna och KV-kopplingen följer med.

API:et kontrollerar själv Access-inloggningen (`lib/access.js`), så portföljen lämnas inte ut ens
om någon hittar `.pages.dev`-adressen. Saknas variablerna svarar API:et med ett fel i stället för
att släppa igenom.

### 6. Testa

Gå till https://dashboard.uppsaladeals.se. Du ska först få Cloudflares inloggningssida, sedan en
kod till mejlen, och sedan en tom portfölj. Lägg in ditt första innehav med **+ Ny affär**.

## Använda den

- **Startläge:** för sådant du redan äger anger du antal och ditt GAV (snittpris) från
  plattformen. Rutan *Startläge* är förvald för nya innehav. Den gör att din gamla vinst inte
  räknas som dagens förändring.
- **Köp/sälj:** antal, kurs och courtage. För utländska värdepapper fylls växelkursen för datumet
  i automatiskt. Vinsten räknas med genomsnittsmetoden, samma GAV som plattformarna visar.
- **Utdelning:** beloppet du fick, i kronor.
- **Eget innehav:** finns något inte på Avanza (t.ex. en pensionsfond) väljer du *Lägg till … som
  eget innehav* i sökningen och uppdaterar kursen själv under raden.
- **Graf:** *Portföljen* visar vad portföljen var värd varje dag utifrån dina affärer. *Dagens
  innehav* visar hur det du äger nu har gått bakåt i tiden, vilket är användbart så länge allt
  är inlagt som startläge.
- **Analys:** fliken högst upp visar fördelning per tillgångsslag, fondtyp, land och sektor, dina
  största bolag genom alla fonder, överlapp mellan fonderna, vad fondavgifterna kostar per år,
  valutaexponering, fondernas viktade risknivå och utdelningar per år, månad och innehav.
  Land, sektor, största innehav, kategori och avgift hämtas från Avanzas fonddata
  (`functions/api/details.js`). Ett eget innehav som följer en fond analyseras som den fonden.
  Typ och avgift kan ändras i tabellen längst ner, t.ex. för ETF:er där Avanza inte visar avgiften.
- **Säkerhetskopior:** KV sparar en kopia per dag (`backup:ÅÅÅÅ-MM-DD`, 60 dagar). Du kan också
  exportera/importera allt som JSON längst ner på sidan.

## Kurser

Kurser, fondkurser (NAV), växelkurser och historik hämtas från Avanzas öppna webb-API via
`functions/api/`. Det kräver ingen nyckel, men det är inofficiellt och kan ändras utan förvarning.
Aktie- och ETF-kurser är fördröjda ca 15 minuter. Fonder får en ny kurs en gång per dag. Sidan
hämtar nya kurser varje minut medan den är öppen.

Aktiesplittar justeras inte automatiskt. Ändra antal och kurs i dina affärer om det sker en split.

## Köra lokalt

```bash
cd dashboard
npx wrangler pages dev public --kv PORTFOLIO --binding DEV_NO_AUTH=1
```

`DEV_NO_AUTH=1` hoppar över inloggningen, men bara på localhost. Lokal data hamnar i
`dashboard/.wrangler/`, som inte checkas in.
