#!/usr/bin/env python3
"""Local dev server: static files + brand assets zip upload."""

from __future__ import annotations

import cgi
import json
import shutil
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT / "assets"
XELTO_DIR = ASSETS_DIR / "xelto"
UPLOAD_ZIP = ASSETS_DIR / "MZ-Xelto-Docs.zip"


class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if self.path.endswith((".js", ".css", ".html")):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        if self.path.rstrip("/") == "/api/upload-assets":
            self.handle_upload()
            return
        self.send_error(404, "Not found")

    def handle_upload(self):
        ASSETS_DIR.mkdir(parents=True, exist_ok=True)
        content_type = self.headers.get("Content-Type", "")

        if "multipart/form-data" not in content_type:
            self.send_json(400, {"error": "Expected multipart/form-data"})
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
            },
        )

        if "file" not in form:
            self.send_json(400, {"error": "Missing file field"})
            return

        item = form["file"]
        if not item.filename:
            self.send_json(400, {"error": "Empty filename"})
            return

        data = item.file.read()
        UPLOAD_ZIP.write_bytes(data)

        if XELTO_DIR.exists():
            shutil.rmtree(XELTO_DIR)
        XELTO_DIR.mkdir(parents=True, exist_ok=True)

        extracted = []
        try:
            with zipfile.ZipFile(UPLOAD_ZIP) as zf:
                zf.extractall(XELTO_DIR)
                extracted = zf.namelist()
        except zipfile.BadZipFile:
            self.send_json(400, {"error": "Invalid zip file"})
            return

        inventory = build_inventory(XELTO_DIR)
        inventory_path = ASSETS_DIR / "inventory.json"
        inventory_path.write_text(json.dumps(inventory, indent=2), encoding="utf-8")

        self.send_json(
            200,
            {
                "ok": True,
                "saved": str(UPLOAD_ZIP.relative_to(ROOT)),
                "extractedTo": str(XELTO_DIR.relative_to(ROOT)),
                "fileCount": len(extracted),
                "inventory": inventory,
            },
        )

    def send_json(self, code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"[dev-server] {self.address_string()} - {fmt % args}")


def build_inventory(base: Path) -> dict:
    files = []
    for path in sorted(base.rglob("*")):
        if path.is_file():
            rel = path.relative_to(base).as_posix()
            ext = path.suffix.lower()
            entry = {
                "path": rel,
                "size": path.stat().st_size,
                "type": classify(ext),
            }
            if ext in {".css", ".scss", ".svg", ".html", ".md", ".txt", ".json"}:
                try:
                    text = path.read_text(encoding="utf-8", errors="ignore")
                    if ext == ".css":
                        entry["colors"] = extract_hex_colors(text)
                    if ext == ".svg":
                        entry["colors"] = extract_hex_colors(text)
                except OSError:
                    pass
            files.append(entry)

    by_type: dict[str, list] = {}
    for f in files:
        by_type.setdefault(f["type"], []).append(f["path"])

    return {"root": str(base.relative_to(ROOT)), "totalFiles": len(files), "byType": by_type, "files": files}


def classify(ext: str) -> str:
    mapping = {
        ".png": "image",
        ".jpg": "image",
        ".jpeg": "image",
        ".gif": "image",
        ".webp": "image",
        ".svg": "vector",
        ".woff": "font",
        ".woff2": "font",
        ".ttf": "font",
        ".otf": "font",
        ".css": "styles",
        ".scss": "styles",
        ".pdf": "document",
        ".md": "document",
        ".txt": "document",
        ".json": "data",
        ".html": "document",
    }
    return mapping.get(ext, "other")


def extract_hex_colors(text: str) -> list[str]:
    import re

    found = set(re.findall(r"#[0-9a-fA-F]{3,8}\b", text))
    return sorted(found, key=str.lower)


def main():
    port = 8080
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", port), DevHandler)
    print(f"Serving {ROOT} on http://0.0.0.0:{port}")
    print(f"Upload page: http://localhost:{port}/upload-assets.html")
    print(f"Prompter:    http://localhost:{port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
