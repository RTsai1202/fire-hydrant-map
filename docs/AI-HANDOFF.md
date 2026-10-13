# AI 專案交接

- 狀態：已完成並驗證線上結果
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
- 金鑰放在 GitHub Actions secret `CARTO_BASEMAP_API_KEY`，由 `scripts/build_site.py` 注入部署產物，不寫進 Git 原始碼。
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

## 本次文件提交的推送狀態

- 文件提交僅保留本機，尚未推送；已部署的功能版本不受影響。
- pre-commit 掃描通過；pre-push 全檔掃描退出碼 2，依智慧提交技能停止推送。
- 既有 index.html 含 Google Places API key，已核對它先前已在遠端；本次沒有新增該金鑰。CARTO key 仍不在 Git 原始碼。
- data/hydrants.geojson 的修改帳號與建檔帳號含手機號碼格式值；掃描命中分別為 185 與 1 次，未將實際值寫入紀錄。
- 後續需另行處理或核實既有金鑰與資料欄位；本次未撤銷金鑰、改寫共享歷史或改動消防栓資料。
