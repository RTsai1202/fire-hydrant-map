#!/usr/bin/env python3
"""
從多個 Google My Maps 下載 KML 並合併轉換為 GeoJSON。
由 GitHub Action 每日自動執行。
"""
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

# ── 多來源設定 ──────────────────────────────────────
# 新增地圖只需加一行 {"mid": "...", "label": "..."}
KML_SOURCES = [
    {"mid": "1v5zb1ylGzrggF16hKmFupy8fKnZEO4g", "label": "車籠埔分隊"},
    {"mid": "1qzRHZBGiYcAVxGdcuzYYsLPdmQM",      "label": "東區北屯區"},
]

OUTPUT_PATH = "data/hydrants.geojson"
KML_NS = "http://www.opengis.net/kml/2.2"


def tag(name):
    return f"{{{KML_NS}}}{name}"


def download_kml(mid, label):
    """下載單一來源的 KML，失敗回傳 None（不中斷全部流程）。"""
    url = f"https://www.google.com/maps/d/kml?mid={mid}&forcekml=1"
    print(f"[{label}] 下載 KML：{url}")
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (GitHub Action hydrant-sync/1.0)"},
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
        print(f"[{label}] KML 大小：{len(data) / 1024:.1f} KB")
        return data
    except Exception as e:
        print(f"[{label}] 下載失敗：{e}", file=sys.stderr)
        return None


def parse_kml_features(kml_bytes, source_label):
    """解析 KML 回傳 GeoJSON features 清單，每筆注入 _source 屬性。"""
    root = ET.fromstring(kml_bytes)
    features = []

    for placemark in root.iter(tag("Placemark")):
        coords_el = placemark.find(f".//{tag('coordinates')}")
        if coords_el is None or not coords_el.text:
            continue
        parts = coords_el.text.strip().split(",")
        try:
            lng, lat = float(parts[0]), float(parts[1])
        except (ValueError, IndexError):
            continue

        name_el = placemark.find(tag("name"))
        name = (name_el.text or "").strip() if name_el is not None else ""

        props = {"name": name, "_source": source_label}
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

    return features


def parse_modify_time(s):
    """解析 '2024/10/10 上午 08:55:04' 格式，回傳 datetime 或 None。"""
    if not s or not s.strip():
        return None
    try:
        s = s.strip()
        s = s.replace("上午", "AM").replace("下午", "PM")
        # 嘗試 12 小時制
        return datetime.strptime(s, "%Y/%m/%d %p %I:%M:%S")
    except ValueError:
        pass
    try:
        # 嘗試 24 小時制 fallback
        return datetime.strptime(s.strip(), "%Y/%m/%d %H:%M:%S")
    except ValueError:
        return None


def deduplicate(all_features):
    """以消防栓編號去重，重複時保留修改時間較新的那筆。"""
    seen = {}       # 消防栓編號 -> feature
    no_id = []      # 無編號的全部保留
    dup_count = 0

    for feat in all_features:
        key = feat["properties"].get("消防栓編號", "").strip()
        if not key:
            no_id.append(feat)
            continue
        if key not in seen:
            seen[key] = feat
        else:
            dup_count += 1
            existing_time = parse_modify_time(seen[key]["properties"].get("修改時間", ""))
            new_time = parse_modify_time(feat["properties"].get("修改時間", ""))
            if new_time and (not existing_time or new_time > existing_time):
                seen[key] = feat

    return list(seen.values()) + no_id, dup_count


def main():
    all_features = []
    source_stats = []
    failed_sources = []

    for source in KML_SOURCES:
        kml_bytes = download_kml(source["mid"], source["label"])
        if kml_bytes is None:
            failed_sources.append(source["label"])
            continue
        features = parse_kml_features(kml_bytes, source["label"])
        print(f"[{source['label']}] 解析完成：{len(features)} 筆")
        source_stats.append({"label": source["label"], "count": len(features)})
        all_features.extend(features)

    if not all_features:
        print("錯誤：所有來源均失敗或無資料，跳過寫入", file=sys.stderr)
        sys.exit(1)

    # 去重
    deduped, dup_count = deduplicate(all_features)
    count = len(deduped)

    # 摘要
    print("\n── 合併摘要 ──")
    for s in source_stats:
        print(f"  {s['label']}: {s['count']} 筆")
    if failed_sources:
        print(f"  失敗來源: {', '.join(failed_sources)}")
    print(f"  重複（以消防栓編號）: {dup_count} 筆")
    print(f"  合併後總計: {count} 筆")

    if count == 0:
        print("警告：合併結果為 0 筆，跳過寫入", file=sys.stderr)
        sys.exit(1)

    geojson = {
        "type": "FeatureCollection",
        "features": deduped,
        "_synced": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "_count": count,
        "_sources": [s["label"] for s in source_stats],
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\n完成：{count} 支消防栓已儲存至 {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
