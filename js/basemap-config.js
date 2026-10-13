// 原始碼中的金鑰保持空值；由 GitHub Actions secrets 注入部署產物。
// 瀏覽器仍可讀取部署後的金鑰，兩個供應商都必須設定網站／API 限制。
window.CARTO_BASEMAP_API_KEY = '';
window.GOOGLE_PLACES_API_KEY = '';
