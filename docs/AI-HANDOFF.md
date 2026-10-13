# AI 專案交接

- 狀態：地圖配色修復已部署；安全修正已在本機驗證，待共享歷史清理批准
- 工具：codex
- 目標：修復消防栓地圖，使用免費 CARTO 金鑰恢復 Voyager 原本配色。

## 線上版本

- 網址：https://rtsai1202.github.io/fire-hydrant-map/
- 功能提交：ca942db01de61d71578f5c73a772f5d0a69ae7fd
- 成功部署：https://github.com/RTsai1202/fire-hydrant-map/actions/runs/38368514158
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

- 前一輪掃描發現的原始碼金鑰與個資，目前版本已修復；共享 Git 歷史尚未改寫。
- Google 新金鑰已存入部署 secret，只允許 rtsai1202.github.io 網站與 Places API (New)；原始碼保持空配置。
- 新金鑰在網站來源的搜尋與詳情皆 HTTP 200，缺乏允許網站來源的請求 HTTP 403；舊金鑰待新部署驗證後停用。
- 清除建檔／修改帳號各 4,051 個欄位，以及 19 筆說明中的帳號行；6,328 筆消防栓、全部 geometry、順序與業務資訊保持一致。
- 同步與部署打包重用清理函式，避免下次同步或部署帶回帳號資料；原始 My Maps 來源未改動。
- 6 個安全回歸測試、git diff --check、全 Git index 安全掃描及另一代理獨立審查通過。
- 完整專案與 .git 已私下備份。main 既有 65 個提交、無其他遠端分支／tag／PR；歷史有 17 個含 Google key 的 HTML 版本、40 個非空含帳號的資料版本。
- 待使用者明確批准：在隔離副本清理共享 main 歷史，驗證後僅用 force-with-lease 推送 main；不改其他分支或外部來源資料。
