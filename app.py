import streamlit as st
from scrapers import ica, coop, willys, lidl, hemkop
import urllib.parse

# Set page config
st.set_page_config(
    page_title="Veckans Deals | Jämför matpriser",
    page_icon="🛒",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS for premium styling
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');
    
    /* Font family overrides */
    html, body, [class*="css"] {
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    
    /* Main container styling */
    .main .block-container {
        padding-top: 2rem;
        padding-bottom: 2rem;
    }
    
    /* Title styling */
    .title-container {
        background: linear-gradient(135deg, #FF416C 0%, #FF4B2B 100%);
        padding: 2.5rem;
        border-radius: 20px;
        color: white;
        margin-bottom: 2rem;
        box-shadow: 0 10px 25px rgba(255, 75, 43, 0.2);
        position: relative;
        overflow: hidden;
    }
    .title-container::after {
        content: "";
        position: absolute;
        top: 0; right: 0; bottom: 0; left: 0;
        background: radial-gradient(circle at 80% 20%, rgba(255,255,255,0.15) 0%, transparent 50%);
        pointer-events: none;
    }
    .title-container h1 {
        margin: 0;
        font-size: 2.8rem;
        font-weight: 800;
        letter-spacing: -1px;
    }
    .title-container p {
        margin: 0.5rem 0 0 0;
        font-size: 1.1rem;
        opacity: 0.9;
        font-weight: 400;
    }
    
    /* Card Container */
    .deal-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 1.5rem;
        padding: 1rem 0;
    }
    
    /* Premium Deal Card */
    .deal-card {
        background: white;
        border-radius: 18px;
        overflow: hidden;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05);
        border: 1px solid rgba(0, 0, 0, 0.06);
        transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
        display: flex;
        flex-direction: column;
        height: 420px;
        position: relative;
    }
    
    /* Dark theme adaptation */
    @media (prefers-color-scheme: dark) {
        .deal-card {
            background: #1E1E24;
            border-color: rgba(255, 255, 255, 0.08);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
        }
        .product-title {
            color: #FFFFFF !important;
        }
        .product-brand {
            color: #A0A0AB !important;
        }
        .product-desc {
            color: #71717A !important;
        }
    }
    
    .deal-card:hover {
        transform: translateY(-8px);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.12);
        border-color: rgba(255, 75, 43, 0.2);
    }
    
    /* Store Badge overlay */
    .store-badge {
        position: absolute;
        top: 12px;
        left: 12px;
        padding: 6px 14px;
        border-radius: 30px;
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        z-index: 10;
        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        color: white;
    }
    
    .store-ica-nära-råbyvägen { background: #E21936; }
    .store-ica-supermarket-torgkassen { background: #E21936; }
    .store-willys { background: #009345; }
    .store-hemköp { background: #D31115; }
    .store-coop { background: #007A33; }
    .store-lidl { background: #00509E; }
    
    /* Card Image styling */
    .card-img-container {
        height: 180px;
        background: #F9F9FB;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        position: relative;
        overflow: hidden;
        border-bottom: 1px solid rgba(0,0,0,0.04);
    }
    @media (prefers-color-scheme: dark) {
        .card-img-container {
            background: #141417;
        }
    }
    .card-img {
        max-height: 100%;
        max-width: 100%;
        object-fit: contain;
        transition: transform 0.3s ease;
    }
    .deal-card:hover .card-img {
        transform: scale(1.05);
    }
    
    /* Card Body */
    .card-body {
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        flex-grow: 1;
        justify-content: space-between;
    }
    
    .product-info {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }
    .product-brand {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        color: #71717A;
        letter-spacing: 0.5px;
    }
    .product-title {
        font-size: 1.05rem;
        font-weight: 700;
        color: #18181B;
        line-height: 1.3;
        margin: 0;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        height: 2.6rem;
    }
    .product-desc {
        font-size: 0.8rem;
        color: #71717A;
        margin-top: 0.25rem;
    }
    
    /* Price tag styling */
    .price-section {
        display: flex;
        flex-direction: column;
        margin-top: 0.75rem;
    }
    .deal-price {
        font-size: 1.5rem;
        font-weight: 800;
        color: #FF4B2B;
        display: flex;
        align-items: baseline;
    }
    .deal-discount-badge {
        font-size: 0.75rem;
        font-weight: 600;
        background: #FEE2E2;
        color: #EF4444;
        padding: 2px 8px;
        border-radius: 4px;
        width: fit-content;
        margin-top: 2px;
    }
    @media (prefers-color-scheme: dark) {
        .deal-discount-badge {
            background: rgba(239, 68, 68, 0.2);
            color: #F87171;
        }
    }
</style>
""", unsafe_allow_html=True)

# Custom header
st.markdown("""
<div class="title-container">
    <h1>🛒 Veckans Deals</h1>
    <p>Hitta och jämför de bästa mataffärserbjudandena i din stad helt utan krångel.</p>
</div>
""", unsafe_allow_html=True)

# Sidebar for store filtering
st.sidebar.header("Välj Butiker")

show_ica_raby = st.sidebar.checkbox("ICA Nära Råbyvägen", value=True)
show_ica_torg = st.sidebar.checkbox("ICA Supermarket Torgkassen", value=True)
show_willys = st.sidebar.checkbox("Willys (Hagaplan)", value=True)
show_hemkop = st.sidebar.checkbox("Hemköp (Svava)", value=True)
show_coop = st.sidebar.checkbox("Coop (Centralhuset)", value=True)
show_lidl = st.sidebar.checkbox("Lidl (Mock-data)", value=False)

# Search bar
search_query = st.text_input("🔍 Sök efter varor (t.ex. kaffe, blandfärs, lax)...", "").strip().lower()

# Fetch data based on selection
all_offers = []

with st.spinner("Hämtar de senaste erbjudandena..."):
    # ICA
    if show_ica_raby or show_ica_torg:
        ica_offers = ica.get_offers()
        if not show_ica_raby:
            ica_offers = [o for o in ica_offers if o['store'] != "ICA Nära Råbyvägen"]
        if not show_ica_torg:
            ica_offers = [o for o in ica_offers if o['store'] != "ICA Supermarket Torgkassen"]
        all_offers.extend(ica_offers)

    # Willys
    if show_willys:
        all_offers.extend(willys.get_offers())

    # Hemköp
    if show_hemkop:
        all_offers.extend(hemkop.get_offers())

    # Coop
    if show_coop:
        all_offers.extend(coop.get_offers())

    # Lidl
    if show_lidl:
        all_offers.extend(lidl.get_offers())

# Filter by search query if present
if search_query:
    all_offers = [
        o for o in all_offers
        if search_query in o.get('product', '').lower() or search_query in o.get('brand', '').lower()
    ]

# Render offers
if not all_offers:
    st.info("Inga erbjudanden hittades för det valda filtret eller sökningen.")
else:
    # Status metrics
    col1, col2 = st.columns(2)
    with col1:
        st.write(f"Visar **{len(all_offers)}** aktuella erbjudanden.")

    # Render card grid in Streamlit columns
    cols_per_row = 4
    for i in range(0, len(all_offers), cols_per_row):
        cols = st.columns(cols_per_row)
        chunk = all_offers[i:i + cols_per_row]
        for idx, offer in enumerate(chunk):
            with cols[idx]:
                # Standardize store names for styling class
                store_name = offer.get('store', 'Okänd butik')
                store_class = store_name.lower().replace(" ", "-")
# Image placeholder
                img_url = offer.get('image_url', '')
                if not img_url:
                    img_url = "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=300&q=80"
                
                # Använd .get() med fallback för att undvika KeyError
                brand_tag = offer.get('brand', '') if offer.get('brand', '') else "&nbsp;"
                desc_tag = offer.get('description', '') if offer.get('description', '') else "&nbsp;"
                discount_tag = offer.get('discount', '') if offer.get('discount', '') else ""
                
                # Säkra upp övriga variabler i kortet också
                product_name = offer.get('product', 'Okänd produkt')
                price_str = offer.get('price', 'Se pris i butik')
                
                # HTML Card
                card_html = f"""
                <div class="deal-card">
                    <span class="store-badge store-{store_class}">{store_name}</span>
                    <div class="card-img-container">
                        <img class="card-img" src="{img_url}" onerror="this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=300&q=80';">
                    </div>
                    <div class="card-body">
                        <div class="product-info">
                            <span class="product-brand">{brand_tag}</span>
                            <h3 class="product-title">{product_name}</h3>
                            <span class="product-desc">{desc_tag}</span>
                        </div>
                        <div class="price-section">
                            <div class="deal-price">{price_str}</div>
                            {f'<div class="deal-discount-badge">{discount_tag}</div>' if discount_tag else ''}
                        </div>
                    </div>
                </div>
                """
                st.markdown(card_html, unsafe_allow_html=True)
                st.write("") # Extra spacer for columns
