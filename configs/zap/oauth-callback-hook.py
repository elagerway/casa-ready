"""
CASA Ready ZAP hook: seed a single OAuth callback endpoint for active scanning.

Why this exists: zap-api-scan.py (the old oauth-callback path) normalizes the
active-scan target to the host root, which breaks single-endpoint callback
fuzzing. Instead we run zap-full-scan.py against the exact callback URL and use
this hook to seed the parameterized request(s) into ZAP's Sites tree so the
declared callbackParams become injection points. zap-full-scan.py then active-
scans them (including ZAP's External Redirect rule on redirect_uri).

Reads /zap/oauth-callback.json (written and mounted by the CASA Ready
orchestrator):

    { "url": "...", "methods": ["GET", "POST"], "params": { "state": "...", ... } }

GET  -> access_url(url + "?" + urlencode(params))
POST -> send_request(raw application/x-www-form-urlencoded request)

If the file is missing or empty, this is a no-op (zap-full-scan.py still scans
the bare callback URL). A failure seeding one method logs and continues — one
method erroring must not abort the whole scan.
"""
import json
import logging
import os
from urllib.parse import urlparse, urlencode

DESCRIPTOR_FILE = "/zap/oauth-callback.json"


def zap_started(zap, target):
    """Called by zap-full-scan.py after the ZAP daemon comes up."""
    if not os.path.exists(DESCRIPTOR_FILE):
        return
    try:
        with open(DESCRIPTOR_FILE, "r", encoding="utf-8") as f:
            desc = json.load(f)
    except Exception as e:  # noqa: BLE001 - log and skip, never abort the scan
        logging.warning("CASA Ready: could not read %s: %s", DESCRIPTOR_FILE, e)
        return

    url = desc.get("url")
    params = desc.get("params") or {}
    methods = desc.get("methods") or ["GET"]
    if not url:
        return

    for method in methods:
        try:
            if method == "GET":
                seeded = _build_query_url(url, params)
                zap.core.access_url(seeded)
                logging.info("CASA Ready: seeded GET %s", seeded)
            elif method == "POST":
                raw = _build_raw_post(url, params)
                zap.core.send_request(raw)
                logging.info("CASA Ready: seeded POST %s", url)
            else:
                logging.warning("CASA Ready: ignoring unknown method %s", method)
        except Exception as e:  # noqa: BLE001 - one method failing must not abort
            logging.warning("CASA Ready: seed %s %s failed: %s", method, url, e)


def _build_query_url(url, params):
    if not params:
        return url
    sep = "&" if urlparse(url).query else "?"
    return url + sep + urlencode(params)


def _build_raw_post(url, params):
    u = urlparse(url)
    path = u.path or "/"
    if u.query:
        path += "?" + u.query
    body = urlencode(params)
    return (
        "POST {path} HTTP/1.1\r\n"
        "Host: {host}\r\n"
        "Content-Type: application/x-www-form-urlencoded\r\n"
        "Content-Length: {length}\r\n"
        "\r\n"
        "{body}"
    ).format(path=path, host=u.netloc, length=len(body), body=body)
