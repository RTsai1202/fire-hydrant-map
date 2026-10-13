## 2026-10-13 16:09 +08 | unknown | project-handoff 結案：map-display-repair-20261013
<!-- handoff-closure:2380f539aa657cb0:a688a497620f -->
- 目標：修復消防栓地圖顯示並驗證線上結果
- 完成：改用 OpenStreetMap 底圖並已提交推送 main，修復 CARTO API KEY REQUIRED 告示取代街道地圖問題
- 驗證：本機瀏覽器底圖顯示、6328 支消防栓載入、點選資訊與導航連結通過；GitHub Pages build built 對應 1a7d4432424c79592dd2affcbaf2cb05c0318d0e；公開 HTML 回讀新底圖；使用者原分頁 660x853 的 12 張底圖均載入，6328 支消防栓、點選資訊和導航正常；本機 1280x720 底圖與縮放通過
- 正式環境：verified
- 下一步：完成；實體手機與 GPS 定位未測，本次僅底圖更換

## 2026-10-13 16:21 +08 | unknown | project-handoff 結案：carto-basemap-restore-20261013
<!-- handoff-closure:2380f539aa657cb0:6f44674d8a27 -->
- 目標：使用使用者申請的免費 CARTO key 恢復 Voyager 底圖，金鑰不進 Git 原始碼
- 完成：本機準備 Voyager 有金鑰啟用、無金鑰 OSM 備援、GitHub Actions secret 注入部署產物；CARTO 免費申請表已填好但未勾條款、未驗證 CAPTCHA、未送出；使用者核准條款、CAPTCHA 與免費申請後已成功送出；收到 CARTO 金鑰信並存入 GitHub Actions secret，限制網站已在申請設定；已代申請免費 CARTO key、限制 rtsai1202.github.io、存入 GitHub Actions secret，切 GitHub Pages 至 workflow 並恢復原 Voyager 底圖
- 驗證：以合成值檢查底圖 URL 編碼、署名、zoom；部署打包不污染 Git 原始碼、不包含私有紀錄且缺金鑰拒絕部署；git diff --check 通過；申請頁確認金鑰寄出並已啟用；暫存檔案逐檔確認未含實際 CARTO key；部署 run 38368514158 success 對應 ca942db01de61d71578f5c73a772f5d0a69ae7fd；公開設定回讀與金鑰一致但 Git 原始碼無 key；線上瀏覽器 20/20 圖磚載入、署名正常、無 console 錯誤、消防栓資訊與導航通過
- 正式環境：verified
- 下一步：完成；依使用者接受條款，不將 CARTO 地圖用於移動車輛顯示或即時逐向導航

## 2026-10-13 16:39 +08 | codex (GPT-6) | 整理消防栓地圖修復與部署交接
- 已完成：CARTO Voyager 原本配色已恢復並驗證線上結果，功能提交 ca942db。
- 更正：先前自動結案紀錄包含申請前的中間狀態；最終已完成使用者核准、免費金鑰申請、部署與線上驗證。工具名稱為 codex。
- 交接：更新 docs/AI-HANDOFF.md，以最終實作與部署結果為準；未測實體手機或 GPS 定位。
- 資料邊界：CARTO 金鑰未寫入 Git 原始碼；網站限制與條款限制仍須保留。

## 2026-10-13 16:41 +08 | codex (GPT-6) | 智慧提交掃描與本機存檔
- 本次文件差異安全掃描通過；全檔推送掃描發現既有 Google Places key 與資料帳號欄位的手機格式值，退出碼 2。
- 依技能停止推送；文件只存本機，已完成的 CARTO 線上部署維持不變。詳見 docs/AI-HANDOFF.md。

## 2026-10-13 16:56 +08 | codex (GPT-6) | 金鑰與個資修正完成本機驗證
- 修正：Google 搜尋改用部署注入的新金鑰，網站及 API 限制已驗證；移除管理帳號與說明帳號行，保留全部 6,328 筆設施資料。
- 防復發：同步與打包共用清理函式；部署執行安全測試；原始碼不含兩家供應商的實際金鑰。
- 驗證：6 個測試與全 Git index 掃描通過，獨立代理審查通過。
- 待決：完整專案已備份，共享歷史清理及 force-with-lease 尚待具體批准；新部署後才停用舊金鑰。

## 2026-10-13 17:40 +08 | codex (GPT-6) | 安全歷史推送與線上驗證
- 完成：經使用者批准，隔離清理 main 歷史後以 force-with-lease 推送；遠端新 clone 100 個 blob 無舊金鑰與個資樣式。
- 驗證：07007bc 部署成功；6,328 支消防栓、CARTO 底圖、Google 搜尋、附近清單、詳細資訊與導航正常。
- 金鑰：新 Google key 的來源與 API 限制已驗證；舊 key 已停用且回 API_KEY_INVALID；舊部署產物已清除。
- 剩餘：GitHub 舊 SHA raw 快取仍可讀原始帳號資料；Support 工單已準備，未送出，等待對外聯絡授權。
