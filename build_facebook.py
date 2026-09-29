#!/usr/bin/env python3
"""
build_facebook.py - Sparar ICA Nära Råbyvägens senaste inlägg på Facebook i
public/facebook.json. Sajten visar bilderna som de är, så de behöver inte läsas av.

Körs varannan timme av .github/workflows/facebook.yml. Facebook visar bara det senaste
inlägget, så tidigare inlägg sparas här tills de är några dagar gamla. Bildlänkarna slutar
gälla efter några dagar och förnyas innan dess. Filen skrivs bara när något har ändrats,
så att det inte blir en commit (och en ny version av sajten) varannan timme.
"""

import datetime
import json
import os
import time
import traceback

from scrapers import facebook

OUTPUT_PATH = os.path.join("public", "facebook.json")

# Äldre inlägg tas bort, utom det senaste
KEEP_DAYS = 3
# Bildlänkar som slutar gälla inom så lång tid förnyas
REFRESH_BEFORE = 24 * 3600


def created(post: dict) -> float:
    return datetime.datetime.fromisoformat(post["created_at"]).timestamp()


def expires_soon(post: dict, now: float) -> bool:
    expires = facebook.expires_at(post)
    return expires is not None and expires - now < REFRESH_BEFORE


def same_content(a: dict, b: dict) -> bool:
    """Samma text och bilder (bildlänkarna ändras vid varje hämtning)"""
    return a["text"] == b["text"] and [i["id"] for i in a["images"]] == [i["id"] for i in b["images"]]


def main():
    previous = {}
    try:
        with open(OUTPUT_PATH, encoding="utf-8") as f:
            previous = json.load(f)
    except (OSError, ValueError):
        pass
    posts = {post["id"]: post for post in previous.get("posts", [])}
    now = time.time()

    print("Hämtar senaste Facebook-inlägget...")
    try:
        latest = facebook.get_latest_post()
        known = posts.get(latest["id"])
        if not known or not same_content(known, latest) or expires_soon(known, now):
            posts[latest["id"]] = latest
            print(f"   [OK] {'Nytt' if not known else 'Uppdaterat'} inlägg från {latest['created_at']} "
                  f"med {len(latest['images'])} bilder: {latest['url']}")
        else:
            print(f"   [OK] Inget nytt inlägg (senaste är från {latest['created_at']})")
    except Exception as e:
        print(f"::warning::Facebook: kunde inte hämta senaste inlägget: {e}")
        traceback.print_exc()

    newest = max(posts.values(), key=created, default=None)
    for post in list(posts.values()):
        if post is not newest and now - created(post) > KEEP_DAYS * 24 * 3600:
            del posts[post["id"]]
            print(f"   Tar bort inlägget från {post['created_at']}")
        elif expires_soon(post, now):
            try:
                posts[post["id"]] = facebook.get_post(post)
                print(f"   Nya bildlänkar för inlägget från {post['created_at']}")
            except Exception as e:
                print(f"::warning::Facebook: kunde inte förnya bildlänkarna för {post['url']}: {e}")

    payload = {
        "store": "ICA Nära Råbyvägen",
        "page_url": facebook.PAGE_URL,
        "posts": sorted(posts.values(), key=created, reverse=True),
    }
    if payload == previous:
        print("Inga ändringar i facebook.json")
        return

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"Sparade {len(payload['posts'])} inlägg i {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
