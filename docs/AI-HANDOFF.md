# AI 專案交接

- 狀態：安全修正已推送並驗證線上功能；GitHub 舊 SHA 快取清除待 Support 工單批准
- 工具：codex
- 目標：修復消防栓地圖，使用免費 CARTO 金鑰恢復 Voyager 原本配色。

## 線上版本

- 網址：https://rtsai1202.github.io/fire-hydrant-map/
- 功能提交：07007bca3b0746e0c41d23a76426aa91ecb529d5
- 成功部署：https://github.com/RTsai1202/fire-hydrant-map/actions/runs/38376583192
- GitHub Pages 已改用 GitHub Actions workflow 發布。

## 實作

- 原因：CARTO 無金鑰的底圖請求回傳 API KEY REQUIRED 告示圖片，消防栓資料仍正常。
- 已申請免費非商業 CARTO Basemaps 金鑰，限制來源網站為 rtsai1202.github.io。
- CARTO 與 Google 搜尋金鑰分別放在 GitHub Actions secrets `CARTO_BASEMAP_API_KEY`、`GOOGLE_PLACES_API_KEY`，由 `scripts/build_site.py` 注入部署產物，不寫進 Git 原始碼。
- `js/basemap-config.js` 的原始碼設定保持空值；有金鑰使用 Voyager，無金鑰使用 OpenStreetMap。
- 部署僅打包 index.html、css、js、img、data，避免把交接紀錄等檔案發布至網站。
- 每月消防栓資料同步成功後，部署 workflow 會重新發布資料。

## 驗證

- 公開部署設定與申請金鑰一致；Git 原始碼不含實際 CARTO 金鑰。
- 線上瀏覽器 660 × 853：20/20 底圖圖磚載入，CARTO 與 OpenStreetMap 署名正常，無相關 console 錯誤。
- 6,328 支消防栓資料載入；點選消防栓資訊與 Google Maps、Apple Maps 導航連結正常。
- 打包檢查：金鑰不污染原始碼、不打包私人紀錄；缺金鑰時拒絕部署。
- 未測實體手機與 GPS 定位。

## 使用限制與資料邊界

- 使用者已確認接受 CARTO 條款；禁止移動車輛上的地圖顯示與即時逐向導航。
- 瀏覽器金鑰會出現在公開圖磚請求中，網站限制需持續保留。
- 目前定位程式在瀏覽器更新藍點，沒有直接向 CARTO 傳送 GPS 座標或車速；CARTO 仍可收到圖磚區域與請求中繼資料。

## 下一步

- 本次功能修復已完成；安全掃描或後續維護事項應另外記錄，不改寫既有部署驗證。

## 安全修正與推送狀態（最新）

- 使用者已明確批准 main 歷史清理與 force-with-lease；已完整備份，在隔離副本清理、驗證並推送，沒有其他分支、tag、PR 或 fork 受到影響。
- 新 Google 金鑰只允許 rtsai1202.github.io 網站及 Places API (New)，由部署 secret 注入；舊金鑰已停用，實際請求回 API_KEY_INVALID。
- 建檔／修改帳號各 4,051 個欄位，以及 19 筆說明的帳號行已移除；6,328 筆消防栓、全部 geometry、順序與其他業務資訊不變。
- 同步與部署打包重用清理函式，避免下次帶回帳號資料；未修改外部 My Maps 來源。
- main 可達的 100 個 blob、41 個 GeoJSON 版本均無舊 Google key 或個資樣式，主代理與獨立審查者核對通過；遠端重新 clone 再次通過。
- 6 個安全回歸測試、全 Git index 掃描與獨立審查通過；部署 run 38376583192 success。
- 公開資料回讀無帳號／手機樣式；實際 UI 搜尋車籠埔分隊、附近 5 支、詳細資訊與導航正常；CARTO zoom 18 的 12/12 圖磚載入。
- 已刪除兩份含舊帳號資料的部署 artifact，保留最新清理後產物。
- 私人完整備份保留於非同步、權限受限的位置，不提交、不部署。

## 尚待 GitHub 平台處理

- 實測舊 SHA 的 raw view 仍可讀到原始帳號資料；force push 不會立即清除 GitHub 的不可達物件與快取。
- GitHub Support 清除工單已填好，僅含儲存庫、路徑、SHA，不附實際電話或金鑰；等待使用者批准對外送出。
- 這是平台快取清除的剩餘範圍，不能宣稱 GitHub 上所有舊副本已永久消失。
