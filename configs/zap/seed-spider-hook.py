"""
CASA Ready ZAP hook: feed extra spider seeds.

Why this exists: zap-baseline.py and zap-full-scan.py both hardcode a single
zap.spider.scan(target_url) call. There's no CLI flag to add more seeds.
ZAP's daemon doesn't read seed URLs from -config either. The supported
escape hatch is --hook=<file>, which lets us register a Python callback
that runs inside the wrapper.

This hook reads /zap/configs/seed-urls.txt (one URL per line, mounted by
the CASA Ready orchestrator) and calls zap.spider.scan(url) for each entry.
The result is exactly what would happen if zap-baseline.py supported a
--seed-url flag.

If the file doesn't exist or is empty, this is a no-op — existing scans
without seed URLs are unaffected.
"""
import logging
import os


SEED_FILE = "/zap/seed-urls.txt"


def zap_started(zap, target):
    """Called by zap-baseline.py / zap-full-scan.py after ZAP daemon comes up."""
    if not os.path.exists(SEED_FILE):
        return
    with open(SEED_FILE, "r", encoding="utf-8") as f:
        seeds = [line.strip() for line in f if line.strip() and not line.startswith("#")]
    if not seeds:
        return
    logging.info("CASA Ready: seeding spider with %d additional URLs", len(seeds))
    for seed in seeds:
        # Skip the primary target URL — the wrapper already spiders it.
        if seed == target:
            continue
        try:
            scan_id = zap.spider.scan(seed)
            logging.info("CASA Ready: spider.scan(%s) -> id=%s", seed, scan_id)
        except Exception as e:
            # Don't fail the whole scan if one seed errors (typically because
            # ZAP rejects it as out-of-context). Log and continue.
            logging.warning("CASA Ready: spider.scan(%s) failed: %s", seed, e)
