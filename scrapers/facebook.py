"""
facebook.py - ICA Nära Råbyvägens senaste inlägg på Facebook.

Butiken lägger ut bilder på sina skyltar ("Prisfest, bara idag!") på Facebook, oftast
utan text. Sajten visar bilderna som de är, så de behöver inte läsas av. Den som inte är
inloggad ser bara sidans senaste inlägg, så build_facebook.py hämtar det varannan timme.

Facebook skickar inläggen som JSON i sidans <script type="application/json">-taggar.
Strukturen är djup och ändras ibland, så inläggen och bilderna letas upp var de än ligger.
"""

import json
import re
import time
from datetime import datetime, timezone

import requests

PAGE_URL = "https://www.facebook.com/icarabyvagen"

# Alla bilder i ett inlägg: sidan och inlägget visar bara de fem första
MEDIA_SET_URL = "https://www.facebook.com/media/set/?set={token}&type=1"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "sv-SE,sv;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
}

ATTEMPTS = 3
RETRY_DELAY = 5  # sekunder

_JSON_SCRIPT = re.compile(r'<script type="application/json"[^>]*>(.*?)</script>', re.S)

# Bildlänkarna är signerade och slutar gälla vid oe (unixtid i hex), några dagar fram
_EXPIRES = re.compile(r"[?&]oe=([0-9A-Fa-f]+)")


def _fetch(url: str) -> str:
    for attempt in range(1, ATTEMPTS + 1):
        try:
            response = requests.get(url, headers=HEADERS, timeout=20)
            response.raise_for_status()
            return response.text
        except requests.RequestException as e:
            if attempt == ATTEMPTS:
                raise
            print(f"Facebook ({url}): {e} – försöker igen om {RETRY_DELAY} s")
            time.sleep(RETRY_DELAY)


def _walk(value):
    """Alla objekt (dict) i Facebooks data, på alla nivåer."""
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def _objects(html: str):
    for script in _JSON_SCRIPT.findall(html):
        try:
            yield from _walk(json.loads(script))
        except ValueError:
            continue


def _stories(html: str) -> list[dict]:
    """Inläggen på sidan"""
    stories = {}
    for obj in _objects(html):
        if obj.get("post_id") and isinstance(obj.get("creation_time"), int) and "attachments" in obj:
            stories.setdefault(str(obj["post_id"]), obj)
    return list(stories.values())


def _photos(value) -> list[dict]:
    """Bilderna i ett inlägg eller album, i ordning och i största storleken."""
    photos = {}
    for obj in _walk(value):
        if obj.get("__typename") != "Photo" or not obj.get("id"):
            continue
        sizes = [obj[key] for key in ("viewer_image", "photo_image", "image")
                 if isinstance(obj.get(key), dict) and obj[key].get("uri")]
        for size in sizes:
            photo = {"id": str(obj["id"]), "url": size["uri"],
                     "width": size.get("width") or 0, "height": size.get("height") or 0}
            current = photos.get(photo["id"])
            if not current or photo["width"] * photo["height"] > current["width"] * current["height"]:
                photos[photo["id"]] = photo
    return list(photos.values())


def _first(value, key: str):
    """Första värdet för key på någon nivå"""
    for obj in _walk(value):
        if obj.get(key):
            return obj[key]
    return None


def _text(story: dict) -> str:
    """Inläggets text (skyltbilderna har oftast ingen)"""
    for obj in [story, *_walk((story.get("comet_sections") or {}).get("content"))]:
        message = obj.get("message")
        if isinstance(message, dict) and isinstance(message.get("text"), str):
            return message["text"].strip()
    return ""


def _post_url(story: dict) -> str:
    for obj in _walk(story):
        url = obj.get("url")
        if isinstance(url, str) and url.startswith("https://www.facebook.com/") and "/posts/" in url:
            return url
    return f"https://www.facebook.com/{story['post_id']}"


def _media_set_photos(token: str) -> list[dict]:
    html = _fetch(MEDIA_SET_URL.format(token=token))
    for obj in _objects(html):
        album = obj.get("album")
        if isinstance(album, dict) and album.get("media"):
            return _photos(album["media"])
    return []


def _post(story: dict) -> dict:
    attachments = story.get("attachments")
    photos = _photos(attachments)
    # Fler än fem bilder: resten finns i inläggets album
    subattachments = _first(attachments, "all_subattachments") or {}
    token = _first(attachments, "mediaset_token")
    if token and (subattachments.get("count") or 0) > len(photos):
        try:
            photos = _media_set_photos(token) or photos
        except requests.RequestException as e:
            print(f"Facebook: kunde inte hämta alla bilder i inlägget ({e}), visar {len(photos)}")

    created = datetime.fromtimestamp(story["creation_time"], timezone.utc)
    return {
        "id": str(story["post_id"]),
        "url": _post_url(story),
        "created_at": created.isoformat(),
        "text": _text(story),
        "images": photos,
    }


def get_latest_post() -> dict:
    """Sidans senaste inlägg, med alla bilder."""
    stories = _stories(_fetch(PAGE_URL))
    if not stories:
        # T.ex. en inloggningsruta i stället för sidan
        raise ValueError("hittade inget inlägg på Facebook-sidan")
    return _post(max(stories, key=lambda story: story["creation_time"]))


def get_post(post: dict) -> dict:
    """Ett sparat inlägg på nytt, med nya bildlänkar när de gamla snart slutar gälla."""
    for story in _stories(_fetch(post["url"])):
        if str(story["post_id"]) == post["id"]:
            return _post(story)
    raise ValueError(f"hittade inte inlägget {post['url']}")


def expires_at(post: dict) -> float | None:
    """När inläggets första bildlänk slutar gälla (unixtid), None om det inte går att se."""
    times = [int(match.group(1), 16) for image in post.get("images", [])
             if (match := _EXPIRES.search(image.get("url", "")))]
    return min(times) if times else None
