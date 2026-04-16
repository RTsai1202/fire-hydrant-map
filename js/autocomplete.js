/**
 * Taiwan Address & Place Autocomplete v3
 *
 * 搜尋策略（四層降級）：
 *   [主力] Photon API (photon.komoot.io)
 *          → 專為 autocomplete 設計，支援地址 + 場所名稱，無需 API key
 *
 *   [地址備援 1] Nominatim free-text query
 *          → 加台灣 viewbox，處理 Photon 找不到的結構化地址
 *
 *   [地址備援 2] Nominatim structured query（去門牌號）
 *          → 「臺中市太平區中興路118號」找不到時，改查「中興路, 太平區」
 *
 *   [場所備援] Overpass API name 模糊搜尋
 *          → 場所名稱（學校、加油站、廟宇）在 Photon/Nominatim 都找不到時
 *
 * 精度標記（precision）：
 *   'exact'    → 找到精確門牌或場所，zoom 17
 *   'street'   → 只找到街道（去掉門牌號），zoom 16
 *   'district' → 只找到鄉鎮區，zoom 13
 *   'place'    → Overpass 場所，zoom 16
 *
 * 輸入正規化：
 *   - 全形數字/英文 → 半形
 *   - 台 → 臺（OSM 以臺為主）
 *   - 去掉多餘空白
 */

// ── Search History ──────────────────────────
const HISTORY_KEY = 'fire_hydrant_search_history';
const HISTORY_MAX = 3;

function getSearchHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { return []; }
}

function saveSearchHistory(item) {
  let history = getSearchHistory();
  history = history.filter(h => h.text !== item.text);
  history.unshift(item);
  history = history.slice(0, HISTORY_MAX);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function initAutocomplete(inputEl, options) {
  const opts = Object.assign(
    { minChars: 2, debounceMs: 350, maxResults: 8 },
    options
  );

  let debounceTimer = null;
  let currentAbortController = null;
  let activeIndex = -1;
  let currentItems = [];
  let listEl = null;

  // ── 台灣地理常數 ───────────────────────────────────────────
  // Photon bbox（台灣全島）
  const TW_BBOX = '119.9,21.9,122.1,25.4'; // min_lon,min_lat,max_lon,max_lat
  // Nominatim viewbox（台灣全島）：左下→右上
  const TW_VIEWBOX = '119.9,21.9,122.1,25.4'; // west,south,east,north
  // 地圖中心偏置預設值（臺中市中心，讓結果優先附近）
  const DEFAULT_BIAS_LAT = 24.148;
  const DEFAULT_BIAS_LON = 120.668;

  // ── 輸入正規化 ────────────────────────────────────────────

  function normalizeQuery(q) {
    return q
      .trim()
      // 全形 → 半形
      .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      // 去多餘空白
      .replace(/\s+/g, ' ')
      // 「台」→「臺」（OSM 台灣資料多用「臺」）
      .replace(/台北/g, '臺北')
      .replace(/台中/g, '臺中')
      .replace(/台南/g, '臺南')
      .replace(/台東/g, '臺東')
      .replace(/台灣/g, '臺灣')
      // 移除常見的不必要後綴（讓搜尋更容易命中）
      .replace(/\s*[，,]\s*臺灣\s*$/, '')
      .trim();
  }

  // ── 台灣地址解析（用於 Nominatim 降級） ──────────────────

  const CITY_RE = /(臺北市|台北市|新北市|桃園市|臺中市|台中市|臺南市|台南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|台東縣|澎湖縣|金門縣|連江縣)/;

  function parseAddress(q) {
    let s = q;
    const r = { city: null, district: null, road: null, housenumber: null };

    const cityM = s.match(CITY_RE);
    if (cityM) { r.city = cityM[1]; s = s.slice(r.city.length); }

    const distM = s.match(/^(.{1,4}[區鎮鄉])/);
    if (distM) { r.district = distM[1]; s = s.slice(r.district.length); }

    const roadM = s.match(/^(.{1,12}?(?:路|街|大道|boulevard)(?:\d+段)?)/);
    if (roadM) { r.road = roadM[1]; s = s.slice(r.road.length); }

    const numM = s.match(/^(\d+(?:[之\-]\d+)?)\s*號?/);
    if (numM) r.housenumber = numM[1] + '號';

    return r;
  }

  // 判斷輸入是否像「場所名稱」而非地址（沒有路/街/道/號）
  function looksLikePlaceName(q, parsed) {
    return !parsed.road && !parsed.housenumber &&
      !/\d/.test(q) &&
      q.length >= 2;
  }

  // ── Google Places API (New)（主力，需 API Key） ───────────
  // 使用 REST API，無需載入 Google Maps JS SDK
  // Session Token 機制：多次按鍵打包成 1 次計費
  // API Key 設定在 index.html 的 GOOGLE_PLACES_API_KEY 常數

  let _googleSessionToken = null;

  function getGoogleSessionToken() {
    if (!_googleSessionToken) {
      _googleSessionToken = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
    return _googleSessionToken;
  }

  function resetGoogleSessionToken() {
    _googleSessionToken = null;
  }

  // 取得 Google API Key（從全域常數）
  function getGoogleApiKey() {
    return (typeof GOOGLE_PLACES_API_KEY !== 'undefined' && GOOGLE_PLACES_API_KEY)
      ? GOOGLE_PLACES_API_KEY
      : null;
  }

  async function fetchGooglePlaces(query, signal) {
    const apiKey = getGoogleApiKey();
    if (!apiKey) return [];

    const loc = (opts.getLocation && opts.getLocation()) || { lat: DEFAULT_BIAS_LAT, lng: DEFAULT_BIAS_LON };

    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
      body: JSON.stringify({
        input: query,
        sessionToken: getGoogleSessionToken(),
        includedRegionCodes: ['TW'],
        languageCode: 'zh-TW',
        locationBias: {
          circle: {
            center: { latitude: loc.lat, longitude: loc.lng },
            radius: 50000,
          },
        },
      }),
    });

    if (!res.ok) {
      // 429 = quota 超過，靜默降級
      if (res.status === 429 || res.status === 403) return [];
      throw new Error(`Google Places ${res.status}`);
    }

    const data = await res.json();
    const suggestions = data.suggestions || [];

    return suggestions
      .filter(s => s.placePrediction)
      .slice(0, opts.maxResults)
      .map(s => {
        const pp = s.placePrediction;
        return {
          address: pp.text?.text || pp.structuredFormat?.mainText?.text || query,
          lat: null,   // 座標需要 Place Details 呼叫
          lng: null,
          precision: 'exact',
          source: 'google',
          type: 'place',
          _placeId: pp.placeId,
          _mainText: pp.structuredFormat?.mainText?.text || '',
          _secondaryText: pp.structuredFormat?.secondaryText?.text || '',
        };
      });
  }

  async function fetchGooglePlaceDetails(placeId) {
    const apiKey = getGoogleApiKey();
    if (!apiKey) return null;

    const res = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'location,displayName,formattedAddress',
        },
      }
    );

    if (!res.ok) return null;
    const place = await res.json();

    // 選取完成後重置 session token（下次搜尋為新 session）
    resetGoogleSessionToken();

    return {
      lat: place.location?.latitude ?? null,
      lng: place.location?.longitude ?? null,
      address: place.formattedAddress || place.displayName?.text || '',
    };
  }

  // ── Photon API（主力，無 Google Key 時） ──────────────────
  // https://photon.komoot.io/api/
  // 回傳 GeoJSON，適合 autocomplete（部分輸入即可）

  async function fetchPhoton(query, signal) {
    const loc = (opts.getLocation && opts.getLocation()) || { lat: DEFAULT_BIAS_LAT, lng: DEFAULT_BIAS_LON };
    const params = new URLSearchParams({
      q: query,
      limit: String(opts.maxResults),
      lang: 'zh',
      lat: String(loc.lat),
      lon: String(loc.lng),
    });

    const url = `https://photon.komoot.io/api/?${params}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
    const geojson = await res.json();

    return (geojson.features || [])
      .filter(f => {
        // 過濾掉不在臺灣的結果
        const cc = (f.properties.countrycode || '').toLowerCase();
        return cc === 'tw' || cc === '' || !f.properties.countrycode;
      })
      .slice(0, opts.maxResults)
      .map(f => {
        const [lon, lat] = f.geometry.coordinates;
        const p = f.properties;

        // 組合顯示地址（台灣慣用格式）
        const address = buildPhotonAddress(p);
        // 精度：有 housenumber 表示找到門牌
        const precision = p.housenumber ? 'exact' : (p.type === 'house' ? 'exact' : 'street');

        return {
          address,
          lat: parseFloat(lat),
          lng: parseFloat(lon),
          precision,
          source: 'photon',
          type: p.type || 'place',
          _raw: p,
        };
      });
  }

  function buildPhotonAddress(p) {
    // Photon properties: name, city, district, postcode, housenumber, street, country
    const parts = [];
    // 縣市
    if (p.state) parts.push(p.state);
    else if (p.county) parts.push(p.county);
    // 鄉鎮區
    if (p.district && p.district !== p.state) parts.push(p.district);
    else if (p.city && p.city !== p.state) parts.push(p.city);
    // 路名
    if (p.street) parts.push(p.street);
    // 門牌號
    if (p.housenumber) parts.push(p.housenumber);
    // 若無法組合，就用場所名稱
    if (parts.length === 0 && p.name) return p.name;
    // 場所名稱加在最後（如「臺中市太平區中興路 便利商店」）
    const addrStr = parts.join('');
    if (p.name && addrStr && !addrStr.includes(p.name)) {
      return `${p.name}（${addrStr}）`;
    }
    return addrStr || p.name || '未知地點';
  }

  // ── Nominatim Free-text（地址備援 1） ─────────────────────

  async function fetchNominatimFree(query, signal) {
    const params = new URLSearchParams({
      format: 'json',
      q: query,
      countrycodes: 'tw',
      viewbox: TW_VIEWBOX,
      limit: String(opts.maxResults),
      addressdetails: '1',
      'accept-language': 'zh-TW',
      dedupe: '1',
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      signal,
      headers: { 'User-Agent': 'FireHydrantMap/3.0 (github.com/rtsai1202/fire-hydrant-map)' },
    });
    if (!res.ok) throw new Error(`Nominatim free HTTP ${res.status}`);
    return normNominatim(await res.json());
  }

  // ── Nominatim Structured（地址備援 2：去門牌號） ──────────

  async function fetchNominatimStructured(parsed, signal) {
    const params = new URLSearchParams({
      format: 'json',
      addressdetails: '1',
      countrycodes: 'tw',
      limit: String(opts.maxResults),
      'accept-language': 'zh-TW',
      dedupe: '1',
    });

    const streetParts = [];
    // 去掉門牌號，只送路名（降級目的）
    if (parsed.road) streetParts.push(parsed.road);
    if (streetParts.length) params.set('street', streetParts.join(' '));
    if (parsed.district) params.set('county', parsed.district);
    if (parsed.city) params.set('city', parsed.city);

    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      signal,
      headers: { 'User-Agent': 'FireHydrantMap/3.0 (github.com/rtsai1202/fire-hydrant-map)' },
    });
    if (!res.ok) throw new Error(`Nominatim structured HTTP ${res.status}`);
    const data = await res.json();
    return normNominatim(data).map(r => ({ ...r, precision: 'street' }));
  }

  // ── Overpass API（場所備援） ───────────────────────────────
  // 用模糊名稱搜尋 OSM 節點/道路，適合「車籠埔國小」等場所名稱

  async function fetchOverpass(query, signal) {
    // 取前 4 個字做模糊匹配（避免太精確反而找不到）
    const shortName = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 6);

    const overpassQL = `
[out:json][timeout:10];
(
  node["name"~"${shortName}"](21.9,119.9,25.4,122.1);
  way["name"~"${shortName}"](21.9,119.9,25.4,122.1);
);
out center 6;
    `.trim();

    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(overpassQL),
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const json = await res.json();

    return (json.elements || [])
      .filter(el => el.tags && el.tags.name)
      .slice(0, opts.maxResults)
      .map(el => {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        const tags = el.tags || {};
        const name = tags['name:zh'] || tags.name || query;

        // 嘗試組出地址
        let address = name;
        if (tags['addr:city']) address = tags['addr:city'] + (tags['addr:district'] || '') + name;

        return {
          address,
          lat: parseFloat(lat),
          lng: parseFloat(lon),
          precision: 'place',
          source: 'overpass',
          type: tags.amenity || tags.leisure || tags.shop || 'place',
        };
      });
  }

  // ── Nominatim 結果正規化 ───────────────────────────────────

  function normNominatim(data) {
    return data.slice(0, opts.maxResults).map(item => {
      const addr = item.address || {};
      const display = buildTwAddress(addr) || item.display_name || '';
      const hasHousenum = !!addr.house_number;
      return {
        address: display,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        precision: hasHousenum ? 'exact' : 'street',
        source: 'nominatim',
        type: item.type || 'place',
        _raw: item.display_name,
      };
    });
  }

  function buildTwAddress(addr) {
    const city = addr.city || addr.county || addr.state_district || addr.state || '';
    const district = addr.suburb || addr.town || addr.municipality || addr.village || '';
    const road = addr.road || '';
    const houseNum = addr.house_number || '';
    if (!road && !city) return null;
    let r = '';
    if (city) r += city;
    if (district && district !== city) r += district;
    if (road) r += road;
    if (houseNum) r += houseNum;
    return r || null;
  }

  // ── 主搜尋邏輯（五層降級） ────────────────────────────────
  // 有 GOOGLE_PLACES_API_KEY → Google 優先
  // 沒有 Key → 直接跳到 Photon

  async function fetchResults(rawQuery) {
    if (currentAbortController) currentAbortController.abort();
    currentAbortController = new AbortController();
    const { signal } = currentAbortController;
    const timeoutId = setTimeout(() => currentAbortController.abort(), 8000);

    try {
      const query = normalizeQuery(rawQuery);
      const parsed = parseAddress(query);
      const isPlace = looksLikePlaceName(query, parsed);
      let results = [];

      // ── 第一層：Google Places（有 Key 才啟用） ──────────────
      if (getGoogleApiKey()) {
        try {
          results = await fetchGooglePlaces(query, signal);
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          // 其他 Google 錯誤→靜默降級
        }
        if (results.length > 0) return results;
      }

      // ── 第二層：Photon（地址 + 場所都試） ──────────────────
      try {
        results = await fetchPhoton(query, signal);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
      }

      if (results.length > 0) return results;

      // ── 第三層：Nominatim free-text ────────────────────────
      try {
        results = await fetchNominatimFree(query, signal);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
      }

      if (results.length > 0) return results;

      // ── 第四層：Nominatim structured（去門牌號，僅地址型） ─
      if (!isPlace && parsed.road && (parsed.city || parsed.district)) {
        try {
          results = await fetchNominatimStructured(parsed, signal);
        } catch (e) {
          if (e.name === 'AbortError') throw e;
        }
        if (results.length > 0) return results;
      }

      // ── 第五層：Overpass 場所名稱搜尋 ──────────────────────
      if (isPlace || results.length === 0) {
        try {
          results = await fetchOverpass(query, signal);
        } catch (e) {
          if (e.name === 'AbortError') throw e;
        }
      }

      return results;

    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ── DOM 建立 ──────────────────────────────────────────────

  function ensureList() {
    if (listEl) return listEl;
    listEl = document.getElementById('autocomplete-list');
    if (listEl) return listEl;

    listEl = document.createElement('ul');
    listEl.id = 'autocomplete-list';
    listEl.setAttribute('role', 'listbox');

    const wrap = document.getElementById('search-wrap') || inputEl.parentElement;
    wrap.appendChild(listEl);
    return listEl;
  }

  function destroyList() {
    if (listEl) {
      listEl.innerHTML = '';
      listEl.style.display = 'none';
    }
    activeIndex = -1;
    currentItems = [];
  }

  // ── 文字高亮 ──────────────────────────────────────────────

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function highlightText(text, keyword) {
    if (!keyword) return escapeHtml(text);
    // 嘗試匹配原始輸入和正規化後的關鍵字
    const kw = keyword.replace(/台/g, '[台臺]').replace(/[.*+?^${}()|[\]\\]/g, m => m === '[' || m === ']' ? m : '\\' + m);
    try {
      const re = new RegExp(`(${kw})`, 'gi');
      return escapeHtml(text).replace(re, '<mark>$1</mark>');
    } catch {
      return escapeHtml(text);
    }
  }

  // 精度 badge 標籤
  const PRECISION_BADGE = {
    exact:    '',
    street:   '<span class="ac-badge ac-badge-street">街道</span>',
    district: '<span class="ac-badge ac-badge-district">區域</span>',
    place:    '<span class="ac-badge ac-badge-place">場所</span>',
  };

  // 來源 icon
  const SOURCE_ICON = {
    google:    '🔵',
    photon:    '📍',
    nominatim: '🗺',
    overpass:  '🔍',
  };

  function parseSubText(item) {
    // Google 結果有專用副文字（城市、行政區）
    if (item.source === 'google' && item._secondaryText) {
      return item._secondaryText;
    }
    const addr = item.address || '';
    // 台灣慣用格式開頭
    const m = addr.match(/^(.{2,4}[市縣])(.{2,4}[區鎮鄉市])?/);
    if (m) {
      return m[2] ? `${m[1]} · ${m[2]}` : m[1];
    }
    if (item.source === 'overpass') return '地圖資料（OSM）';
    return addr.slice(0, 10);
  }

  // ── 渲染 ──────────────────────────────────────────────────

  function renderLoading() {
    const list = ensureList();
    list.innerHTML = '';
    list.style.display = 'block';
    const li = document.createElement('li');
    li.className = 'ac-loading';
    li.textContent = '搜尋中…';
    list.appendChild(li);
  }

  function renderEmpty() {
    const list = ensureList();
    list.innerHTML = '';
    list.style.display = 'block';
    const li = document.createElement('li');
    li.className = 'ac-empty';
    li.textContent = '找不到符合的地址或場所，請嘗試更完整的地址';
    list.appendChild(li);
  }

  function renderItems(items, query) {
    const list = ensureList();
    list.innerHTML = '';
    activeIndex = -1;
    currentItems = items;

    if (items.length === 0) {
      renderEmpty();
      return;
    }

    list.style.display = 'block';

    items.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = 'ac-item';
      li.setAttribute('role', 'option');
      li.dataset.index = idx;

      const badge = PRECISION_BADGE[item.precision] || '';
      const icon = SOURCE_ICON[item.source] || '📍';

      const main = document.createElement('div');
      main.className = 'ac-item-main';
      // Google 結果優先顯示主文字（更簡潔），其他顯示完整地址
      const displayText = (item.source === 'google' && item._mainText)
        ? item._mainText
        : item.address;
      main.innerHTML = highlightText(displayText, query) + badge;

      const sub = document.createElement('div');
      sub.className = 'ac-item-sub';
      sub.textContent = parseSubText(item);

      li.appendChild(main);
      li.appendChild(sub);

      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectItem(idx);
      });

      list.appendChild(li);
    });
  }

  // ── 選中邏輯 ──────────────────────────────────────────────

  async function selectItem(idx) {
    const item = currentItems[idx];
    if (!item) return;
    inputEl.value = item.address;
    destroyList();

    // Google 結果需要 Place Details 二次呼叫取得座標
    if (item.source === 'google' && item._placeId) {
      // 顯示「取得位置中…」過渡狀態
      inputEl.disabled = true;
      try {
        const details = await fetchGooglePlaceDetails(item._placeId);
        if (details && details.lat != null && typeof opts.onSelect === 'function') {
          opts.onSelect({
            address: item._mainText || item.address,
            subtext: details.address || item._secondaryText || '',
            lat: details.lat,
            lng: details.lng,
            precision: 'exact',
            source: 'google',
          });
          return;
        }
      } catch {
        // Place Details 失敗→當作找不到
      } finally {
        inputEl.disabled = false;
      }
    }

    // 一般結果（Photon / Nominatim / Overpass）直接回呼
    if (typeof opts.onSelect === 'function') {
      opts.onSelect({
        address: item.address,
        subtext: item._secondaryText || '',
        lat: item.lat,
        lng: item.lng,
        precision: item.precision || 'exact',
        source: item.source || 'unknown',
      });
    }
  }

  function setActive(idx) {
    const list = ensureList();
    const items = list.querySelectorAll('.ac-item');
    if (!items.length) return;
    if (idx < 0) idx = items.length - 1;
    if (idx >= items.length) idx = 0;
    activeIndex = idx;
    items.forEach((el, i) => el.classList.toggle('selected', i === activeIndex));
  }

  // ── 主要搜尋流程 ──────────────────────────────────────────

  async function doSearch(query) {
    renderLoading();
    try {
      const results = await fetchResults(query);
      if (inputEl.value.trim() === '') {
        destroyList();
        return;
      }
      renderItems(results, query);
    } catch (e) {
      if (e.name === 'AbortError') return;
      renderEmpty();
    }
  }

  // ── 搜尋歷史渲染 ──────────────────────────────────────────

  function renderHistoryItems(history) {
    const list = ensureList();
    list.innerHTML = '';
    history.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'ac-item ac-history-item';
      li.setAttribute('role', 'option');
      li.innerHTML = `<span class="ac-history-icon">🕐</span><span class="ac-history-text">${escapeHtml(item.text)}</span>`;

      const selectHistory = () => {
        inputEl.value = item.text;
        destroyList();
        if (typeof opts.onSelect === 'function') {
          opts.onSelect({ address: item.text, lat: item.lat, lng: item.lng, precision: 'exact' });
        }
      };

      li.addEventListener('mousedown', e => {
        e.preventDefault();
        selectHistory();
      });
      // 行動裝置觸控支援
      li.addEventListener('touchend', e => {
        e.preventDefault();
        selectHistory();
      });

      list.appendChild(li);
    });
    list.style.display = 'block';
  }

  // ── 事件綁定 ──────────────────────────────────────────────

  inputEl.addEventListener('focus', () => {
    if (inputEl.value.trim() === '') {
      const history = getSearchHistory();
      if (history.length > 0) {
        renderHistoryItems(history);
      }
    }
  });

  inputEl.addEventListener('input', () => {
    const val = inputEl.value.trim();
    clearTimeout(debounceTimer);
    if (val.length < opts.minChars) {
      destroyList();
      return;
    }
    debounceTimer = setTimeout(() => doSearch(val), opts.debounceMs);
  });

  inputEl.addEventListener('keydown', (e) => {
    const list = ensureList();
    const visible = list.style.display === 'block';
    if (!visible) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive(activeIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive(activeIndex - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0) {
          selectItem(activeIndex);
        } else if (currentItems.length > 0) {
          selectItem(0);
        }
        break;
      case 'Escape':
        destroyList();
        break;
    }
  });

  document.addEventListener('click', (e) => {
    if (!inputEl.contains(e.target) && listEl && !listEl.contains(e.target)) {
      destroyList();
    }
  });

  inputEl.addEventListener('change', () => {
    if (inputEl.value.trim() === '') destroyList();
  });

  // 回傳 API 供外部呼叫（儲存搜尋歷史）
  return { saveHistory: saveSearchHistory };
}

// 支援 CommonJS（Node.js 測試環境）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initAutocomplete };
}
