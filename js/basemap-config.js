// 保持原始碼中的金鑰為空；由 GitHub Actions 的 CARTO_BASEMAP_API_KEY secret 注入部署產物。
// 瀏覽器仍可讀取部署後的金鑰，請在 CARTO 後台設定網站限制。
window.CARTO_BASEMAP_API_KEY = '';
