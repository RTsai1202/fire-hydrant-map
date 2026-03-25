#!/usr/bin/env python3
"""
從 Google My Maps 下載 KML 並轉換為 GeoJSON。
由 GitHub Action 每日自動執行。
"""
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

KML_URL = "https://www.google.com/maps/d/kml?mid=1v5zb1ylGzrggF16hKmFupy8fKnZEO4g&forcekml=1"
OUTPUT_PATH = "data/hydrants.geojson"
KML_NS = "http://www.opengis.net/kml/2.2"

def tag(name):
    return f"{{{KML_NS}}}{name}"

def kml_to_geojson(kml_bytes):
    root = ET.fromstring(kml_bytes)
    features = []

    for placemark in root.iter(tag("Placemark")):
        # 座標
        coords_el = placemark.find(f".//{tag('coordinates')}")
        if coords_el is None or not coords_el.text:
            continue
        parts = coords_el.text.strip().split(",")
        try:
            lng, lat = float(parts[0]), float(parts[1])
        except (ValueError, IndexError):
            continue

        # 名稱
        name_el = placemark.find(tag("name"))
        name = (name_el.text or "").strip() if name_el is not None else ""

        # 屬性欄位（ExtendedData）
        props = {"name": name}
        ext = placemark.find(tag("ExtendedData"))
        if ext is not None:
            for data_el in ext.findall(tag("Data")):
                key = data_el.get("name", "").strip()
                val_el = data_el.find(tag("value"))
                if key and val_el is not None:
                    props[key] = (val_el.text or "").strip()

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lng, lat]},
            "properties": props,
        })

    return {
        "type": "FeatureCollection",
        "features": features,
        "_synced": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "_count": len(features),
    }

def main():
    print(f"下載 KML：{KML_URL}")
    try:
        req = urllib.request.Request(
            KML_URL,
            headers={"User-Agent": "Mozilla/5.0 (GitHub Action hydrant-sync/1.0)"}
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            kml_bytes = resp.read()
    except Exception as e:
        print(f"下載失敗：{e}", file=sys.stderr)
        sys.exit(1)

    print(f"KML 大小：{len(kml_bytes) / 1024:.1f} KB，開始解析...")
    geojson = kml_to_geojson(kml_bytes)
    count = geojson["_count"]

    if count == 0:
        print("警告：解析結果為 0 筆，跳過寫入", file=sys.stderr)
        sys.exit(1)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, separators=(",", ":"))

    print(f"完成：{count} 支消防栓已儲存至 {OUTPUT_PATH}")

if __name__ == "__main__":
    main()
