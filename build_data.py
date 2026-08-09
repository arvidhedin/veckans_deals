#!/usr/bin/env python3
"""
build_data.py - Scrapes offers from all stores and exports to public/deals.json
Designed for static hosting on Cloudflare Pages.
"""

import os
import json
import datetime
import traceback
from scrapers import ica, coop, willys, lidl, hemkop


def get_discount_pct(offer: dict) -> float:
    """Helper to safely extract discount percentage as float for sorting."""
    pct = offer.get("discount_percentage")
    if pct is None:
        return 0.0
    try:
        return float(pct)
    except (ValueError, TypeError):
        return 0.0


def main():
    print("=" * 60)
    print("🚀 Starting Veckans Deals Data Build")
    print(f"⏰ Timestamp: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
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
        print(f"📦 Scraping {name}...")
        try:
            offers = scraper_fn()
            if not isinstance(offers, list):
                offers = []
            
            # Record statistics per specific store name
            for o in offers:
                store_key = o.get("store", name)
                store_stats[store_key] = store_stats.get(store_key, 0) + 1

            all_offers.extend(offers)
            print(f"   ✅ {name}: Fetched {len(offers)} offers")
        except Exception as e:
            print(f"   ❌ {name}: Failed with error: {e}")
            traceback.print_exc()

    # Sort all offers by discount percentage descending (highest discount first)
    all_offers.sort(key=get_discount_pct, reverse=True)

    # Ensure output directory exists
    os.makedirs("public", exist_ok=True)
    output_path = os.path.join("public", "deals.json")

    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "updated_at": now.isoformat(),
        "updated_at_readable": now.strftime("%Y-%m-%d %H:%M UTC"),
        "total_offers": len(all_offers),
        "store_counts": store_stats,
        "offers": all_offers,
    }

    # Write formatted JSON to public/deals.json
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print("-" * 60)
    print(f"🎉 Build complete! Total offers collected: {len(all_offers)}")
    for store_name, count in sorted(store_stats.items()):
        print(f"   - {store_name}: {count} offers")
    print(f"💾 Saved to: {output_path} ({os.path.getsize(output_path) / 1024:.1f} KB)")
    print("=" * 60)


if __name__ == "__main__":
    main()
