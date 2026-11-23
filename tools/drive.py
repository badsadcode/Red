"""Tiny helper for public Google Drive folders (Quaternius hosts its packs there)."""
import re, urllib.request, os, time

UA = {"User-Agent": "Mozilla/5.0 (badideas-asset-fetch)"}

def _get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))

def list_folder(folder_id):
    """[(id, name, is_folder)] for a public folder."""
    h = _get(f"https://drive.google.com/embeddedfolderview?id={folder_id}").decode("utf-8", "replace")
    out = []
    for m in re.finditer(r'<div class="flip-entry" id="entry-([A-Za-z0-9_-]+)".*?flip-entry-title">([^<]+)<', h, re.S):
        eid, name = m.group(1), m.group(2)
        block = m.group(0)
        out.append((eid, name.strip(), "/folders/" in block or "drive/folders" in block))
    if not out:  # fallback: pair hrefs with titles in order
        for m in re.finditer(r'href="https://drive.google.com/(?:file/d|drive/folders)/([A-Za-z0-9_-]+)[^"]*".*?flip-entry-title">([^<]+)<', h, re.S):
            out.append((m.group(1), m.group(2).strip(), "drive/folders" in m.group(0)))
    return out

def download(file_id, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    data = _get(f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t")
    with open(path, "wb") as f:
        f.write(data)
    return path

def pack_folder(pack):
    h = _get(f"https://quaternius.com/packs/{pack}.html").decode("utf-8", "replace")
    m = re.search(r"drive.google.com/drive/folders/([A-Za-z0-9_-]+)", h)
    return m.group(1) if m else None

def find_sub(folder_id, name):
    for eid, n, isf in list_folder(folder_id):
        if n.lower() == name.lower():
            return eid
    return None
