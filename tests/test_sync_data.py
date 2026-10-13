"""Use synthetic KML to verify privacy filtering and existing merge behavior."""
import copy
import importlib.util
from pathlib import Path
import unittest
from xml.sax.saxutils import escape


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "sync_data.py"
SPEC = importlib.util.spec_from_file_location("sync_data", MODULE_PATH)
sync_data = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync_data)


def make_kml(rows):
    placemarks = []
    for name, coordinates, properties in rows:
        data = "".join(
            f'<Data name="{escape(key)}"><value>{escape(value)}</value></Data>'
            for key, value in properties.items()
        )
        placemarks.append(
            f"<Placemark><name>{escape(name)}</name><ExtendedData>{data}</ExtendedData>"
            f"<Point><coordinates>{coordinates}</coordinates></Point></Placemark>"
        )
    return (f'<kml xmlns="{sync_data.KML_NS}"><Document>'
            + "".join(placemarks) + "</Document></kml>").encode()


class PrivacyFilterTests(unittest.TestCase):
    def test_parser_removes_accounts_and_only_their_description_lines(self):
        properties = {
            "消防栓編號": "TEST-001",
            "種類": "地下式",
            "消防栓位置": "測試路 12 號旁",
            "修改時間": "2026/10/13 下午 02:00:00",
            " 建檔帳號 ": "synthetic-editor",
            "修改帳號": "synthetic-private-account",
            "說明": "消防栓位置: 測試路 12 號旁\n建檔帳號: synthetic-editor\n"
                    "修改帳號：synthetic-private-account\n備註: 檢查建檔帳號欄位的提示牌\n",
            "備註": "正常設施資訊",
        }
        features = sync_data.parse_kml_features(
            make_kml([("測試消防栓", "120.7,24.1,0", properties)]), "合成來源"
        )
        self.assertEqual(len(features), 1)
        self.assertEqual(features[0]["geometry"], {
            "type": "Point", "coordinates": [120.7, 24.1]
        })
        expected = {key.strip(): value for key, value in properties.items()
                    if key.strip() not in sync_data.PRIVATE_METADATA_FIELDS}
        expected["說明"] = "消防栓位置: 測試路 12 號旁\n備註: 檢查建檔帳號欄位的提示牌"
        expected.update(name="測試消防栓", _source="合成來源")
        self.assertEqual(features[0]["properties"], expected)

    def test_collection_preserves_original_and_is_idempotent(self):
        original = {
            "type": "FeatureCollection", "_count": 1, "_synced": "synthetic timestamp",
            "features": [{
                "type": "Feature", "id": "synthetic-id",
                "geometry": {"type": "Point", "coordinates": [120.7, 24.1]},
                "properties": {"name": "測試消防栓", "建檔帳號": "synthetic-editor",
                               "說明": "種類: 地下式\r\n修改帳號: synthetic-editor\r\n",
                               "消防栓位置": "測試路 12 號旁"},
            }],
        }
        before = copy.deepcopy(original)
        cleaned = sync_data.sanitize_collection(original)
        self.assertEqual(original, before)
        expected = copy.deepcopy(original)
        del expected["features"][0]["properties"]["建檔帳號"]
        expected["features"][0]["properties"]["說明"] = "種類: 地下式\r\n"
        self.assertEqual(cleaned, expected)
        self.assertEqual(sync_data.sanitize_collection(cleaned), cleaned)

    def test_filtered_features_still_choose_newest_duplicate_and_keep_missing_ids(self):
        rows = [
            ("舊版", "120.7,24.1,0", {"消防栓編號": "TEST-001",
             "修改時間": "2026/10/12 上午 09:00:00", "修改帳號": "synthetic-old"}),
            ("新版", "120.8,24.2,0", {"消防栓編號": "TEST-001",
             "修改時間": "2026/10/13 下午 02:00:00", "修改帳號": "synthetic-new"}),
            ("無時間", "120.9,24.3,0", {"消防栓編號": "TEST-001", "修改時間": ""}),
            ("其他消防栓", "120.6,24.0,0", {"消防栓編號": "TEST-002"}),
            ("無編號一", "120.5,23.9,0", {"消防栓編號": ""}),
            ("無編號二", "120.4,23.8,0", {}),
        ]
        parsed = sync_data.parse_kml_features(make_kml(rows), "合成來源")
        deduped, duplicates = sync_data.deduplicate(parsed)
        self.assertEqual(duplicates, 2)
        self.assertEqual([f["properties"]["name"] for f in deduped],
                         ["新版", "其他消防栓", "無編號一", "無編號二"])
        self.assertEqual(deduped[0], parsed[1])
        self.assertTrue(all(not (set(f["properties"]) & sync_data.PRIVATE_METADATA_FIELDS)
                            for f in parsed))


if __name__ == "__main__":
    unittest.main()
