#!/usr/bin/env python3
"""
build_data.py - Scrapes offers from all stores and exports to public/deals.json
Designed for static hosting on Cloudflare Pages.
"""

import os
import json
import datetime
import traceback
from scrapers import ica, coop, willys, lidl, hemkop, willys_search, product_info, origin, recipes
from scrapers.categorizer import categorize_offer


def get_discount_pct(offer: dict) -> float:
    """Helper to safely extract discount percentage as float for sorting."""
    pct = offer.get("discount_percentage")
    if pct is None:
        return 0.0
    try:
        return float(pct)
    except (ValueError, TypeError):
        return 0.0


def add_origins(offers: list[dict], products: dict) -> None:
    """Sets the country of origin (e.g. "Sverige") on the offers whose scraper couldn't find it:
    Willys and Hemköp only have it in the product info, and names like "Svensk nötfärs" say it."""
    for o in offers:
        product = products.get(o.get("product_code") or "") or {}
        o["origin"] = o.get("origin") or product.get("country") or origin.from_name(o.get("product"))


def main():
    print("=" * 60)
    print("Starting Veckans Deals Data Build")
    print(f"Timestamp: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    all_offers = []
    store_stats = {}

    # Define scrapers to run with friendly names
    scrapers = [
        ("ICA", ica.get_offers),
        ("Willys", willys.get_offers),
        ("Hemköp", hemkop.get_offers),
        ("Coop", coop.get_offers),
        ("Lidl", lidl.get_offers),
    ]

    for name, scraper_fn in scrapers:
        print(f"Scraping {name}...")
        try:
            offers = scraper_fn()
            if not isinstance(offers, list):
                offers = []
            
            # Record statistics per specific store name
            for o in offers:
                store_key = o.get("store", name)
                store_stats[store_key] = store_stats.get(store_key, 0) + 1

            all_offers.extend(offers)
            print(f"   [OK] {name}: Fetched {len(offers)} offers")
        except Exception as e:
            print(f"   [FAIL] {name}: Failed with error: {e}")
            traceback.print_exc()

    print("Fetching Willys regular assortment for reference pricing...")
    willys_assortment = []
    try:
        willys_assortment = willys_search.get_willys_assortment()
        print(f"   [OK] Willys Assortment: Fetched {len(willys_assortment)} regular reference items")
    except Exception as e:
        print(f"   [FAIL] Willys Assortment: Failed with error: {e}")

    # Categorize all offers
    print("Categorizing offers into standard categories...")
    cat_counts = {}
    for o in all_offers:
        cat = categorize_offer(o)
        o["category"] = cat
        cat_counts[cat] = cat_counts.get(cat, 0) + 1
    
    for cat_name, count in sorted(cat_counts.items(), key=lambda x: x[1], reverse=True):
        print(f"   - {cat_name}: {count}")

    # Sort all offers by discount percentage descending (highest discount first)
    all_offers.sort(key=get_discount_pct, reverse=True)

    # Ensure output directory exists
    os.makedirs("public", exist_ok=True)
    output_path = os.path.join("public", "deals.json")

    # Ingredients, nutrition & origin from Willys/Hemköp -> public/product_info.json
    # (Axfood's API blocks direct browser requests, so it is fetched here instead).
    # Fetched before deals.json is written, since Willys/Hemköp's origin is only found there.
    print("Fetching product info (ingredients)...")
    info_path = os.path.join("public", "product_info.json")
    previous_info = {}
    try:
        with open(info_path, encoding="utf-8") as f:
            previous_info = json.load(f)
    except (OSError, ValueError):
        pass

    info = {"products": previous_info.get("products", {}), "eans": previous_info.get("eans", {})}
    try:
        info = product_info.build_product_info(all_offers, previous_info)
    except Exception as e:
        print(f"   [FAIL] Product info: Failed with error: {e}")
        traceback.print_exc()

    add_origins(all_offers, info["products"])

    # Dinner recipes from ica.se whose protein is on offer -> public/recipes.json. Their
    # ingredients point at the offers in deals.json by index, so this runs after the offers
    # are sorted. The recipe pages don't change, so the previous ingredients are reused.
    print("Fetching recipes from ica.se...")
    recipes_path = os.path.join("public", "recipes.json")
    previous_recipes = []
    try:
        with open(recipes_path, encoding="utf-8") as f:
            previous_recipes = json.load(f).get("recipes", [])
    except (OSError, ValueError, AttributeError):
        pass

    recipe_list = []
    try:
        recipe_list = recipes.build_recipes(all_offers, previous_recipes)
    except Exception as e:
        print(f"   [FAIL] Recipes: Failed with error: {e}")
        traceback.print_exc()

    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "updated_at": now.isoformat(),
        "updated_at_readable": now.strftime("%Y-%m-%d %H:%M UTC"),
        "total_offers": len(all_offers),
        "store_counts": store_stats,
        "category_counts": cat_counts,
        "offers": all_offers,
        "willys_assortment": willys_assortment,
    }

    # Write formatted JSON to public/deals.json
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    # Always write the file so the workflow's `git add` finds it
    with open(info_path, "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False, indent=2)

    # Without indentation: the offer indexes would take a line each
    with open(recipes_path, "w", encoding="utf-8") as f:
        json.dump({"offers_updated_at": payload["updated_at"], "recipes": recipe_list},
                  f, ensure_ascii=False, separators=(",", ":"))

    print("-" * 60)
    print(f"Build complete! Total offers collected: {len(all_offers)}")
    for store_name, count in sorted(store_stats.items()):
        print(f"   - {store_name}: {count} offers")
    print(f"Saved to: {output_path} ({os.path.getsize(output_path) / 1024:.1f} KB)")
    print("=" * 60)


if __name__ == "__main__":
    main()
