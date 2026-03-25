/**
 * Taiwan Address Autocomplete v2
 *
 * 架構：
 *   主要 API → Nominatim structured query（分段解析，解決中文完整地址找不到的問題）
 *   備案 API → Nominatim free-text query（針對路名/地名的模糊預測）
 *   已停用  → NLSC TGLocator（實測 404，API 已失效）
 *
 * 地址解析策略（parseQuery）：
 *   輸入「臺中市太平區中興路118號」→ structured query (street + city)
 *   輸入「中興路118」（無鄉鎮市區）→ free-text query，讓 Nominatim 自行推斷
 *   輸入「太平區中興路」           → structured query (street=中興路, county=太平區)
 *   輸入「中興路」（純路名）       → free-text query 列出全台同名路
 */

/**
 * 初始化地址自動完成
 * @param {HTMLInputElement} inputEl - 搜尋輸入框元素
 * @param {Object} options
 * @param {Function} options.onSelect - 使用者選中候選項的回呼，傳入 { address, lat, lng }
 * @param {number} [options.minChars=2] - 最少幾個字才觸發
 * @param {number} [options.debounceMs=300] - 防抖延遲毫秒
 * @param {number} [options.maxResults=8] - 最多顯示幾筆
 */
function initAutocomplete(inputEl, options) {
  const opts = Object.assign(
    { minChars: 2, debounceMs: 300, maxResults: 8 },
    options
  );

  let debounceTimer = null;
  let currentAbortController = null;
  let activeIndex = -1;
  let currentItems = [];
  let listEl = null;

  // ── 台灣地址解析 ──────────────────────────────────────────

  /**
   * 台灣縣市對照表（含「臺」「台」兩種寫法）
   */
  const CITY_PATTERN =
    /^(臺北市|台北市|新北市|桃園市|台中市|臺中市|台南市|臺南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|台東縣|臺東縣|澎湖縣|金門縣|連江縣)/;

  /**
   * 鄉鎮市區（區/鎮/鄉/市 結尾，2–4 字）
   */
  const DISTRICT_PATTERN = /(.{1,4}[區鎮鄉])/;

  /**
   * 路名（路/街/大道/巷/弄，可含段）
   * 例：中興路、中山北路二段、忠孝東路四段
   */
  const ROAD_PATTERN = /(.{1,10}(?:路|街|大道|boulevard))(\d+段)?/;

  /**
   * 門牌號（數字＋可選「之N」＋「號」）
   * 例：118號、118之3號、118-3號
   */
  const HOUSENUMBER_PATTERN = /(\d+(?:[之\-]\d+)?)\s*號?/;

  /**
   * 解析輸入字串，拆成 structured query 所需的各段。
   * 回傳 { city, district, street, housenumber, rest }
   *   - 任何欄位都可能是 null（表示輸入沒有這段）
   */
  function parseQuery(q) {
    let s = q.trim();
    const result = { city: null, district: null, street: null, housenumber: null };

    // 1. 先抓縣市
    const cityMatch = s.match(CITY_PATTERN);
    if (cityMatch) {
      result.city = cityMatch[1];
      s = s.slice(result.city.length);
    }

    // 2. 抓鄉鎮市區
    const districtMatch = s.match(/^(.{1,4}[區鎮鄉])/);
    if (districtMatch) {
      result.district = districtMatch[1];
      s = s.slice(result.district.length);
    }

    // 3. 抓路名（含段）
    const roadMatch = s.match(/^(.{1,10}?(?:路|街|大道)(?:\d+段)?)/);
    if (roadMatch) {
      result.street = roadMatch[1];
      s = s.slice(result.street.length);
    }

    // 4. 抓門牌號（數字 + 可選「之/- N」+ 可選「號」）
    const numMatch = s.match(/^(\d+(?:[之\-]\d+)?)\s*號?/);
    if (numMatch) {
      result.housenumber = numMatch[1] + '號';
    }

    return result;
  }

  /**
   * 判斷輸入是否「夠結構化」，可使用 structured query。
   * 條件：至少有路名，且有縣市或鄉鎮其一。
   */
  function isStructured(parsed) {
    return !!parsed.street && (!!parsed.city || !!parsed.district);
  }

  // ── Nominatim Structured Query ────────────────────────────

  /**
   * 用分段參數查詢 Nominatim。
   * 優點：能正確解析中文完整地址，不受「號」字結尾影響。
   *
   * 測試確認有效：
   *   street=118號 中興路 & city=臺中市  → 正確回傳太平區中興路 118 號
   */
  async function fetchNominatimStructured(parsed, signal) {
    const params = new URLSearchParams({
      format: 'json',
      addressdetails: '1',
      countrycodes: 'tw',
      limit: String(opts.maxResults),
      'accept-language': 'zh-TW',
      dedupe: '1',
    });

    // street 欄位：門牌號 + 路名（Nominatim 的 street 同時包含 housenumber 和 road）
    const streetParts = [];
    if (parsed.housenumber) streetParts.push(parsed.housenumber);
    if (parsed.street) streetParts.push(parsed.street);
    if (streetParts.length) params.set('street', streetParts.join(' '));

    // Nominatim 的 county = 鄉鎮市區（行政層級對應）
    if (parsed.district) params.set('county', parsed.district);
    // city = 縣市
    if (parsed.city) params.set('city', parsed.city);

    const url = `https://nominatim.openstreetmap.org/search?${params}`;
    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'FireHydrantMap/2.0' },
    });
    if (!res.ok) throw new Error(`Nominatim structured HTTP ${res.status}`);
    const data = await res.json();
    return normNominatim(data);
  }

  /**
   * 用 free-text 查詢 Nominatim（適合部分輸入、純路名、縣市+路名等）。
   * 加上 Taiwan bias 讓結果偏向台灣地區。
   */
  async function fetchNominatimFreetext(query, signal) {
    const params = new URLSearchParams({
      format: 'json',
      q: query,
      countrycodes: 'tw',
      limit: String(opts.maxResults),
      'accept-language': 'zh-TW',
      dedupe: '1',
    });

    const url = `https://nominatim.openstreetmap.org/search?${params}`;
    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'FireHydrantMap/2.0' },
    });
    if (!res.ok) throw new Error(`Nominatim free-text HTTP ${res.status}`);
    const data = await res.json();
    return normNominatim(data);
  }

  /**
   * 將 Nominatim 回傳格式標準化成 { address, lat, lng }。
   * display_name 格式：「118號, 中興路, 中興里, 太平區, 長億里, 臺中市, 411, 臺灣」
   * 轉成：「臺中市太平區中興路118號」（符合台灣習慣）
   */
  function normNominatim(data) {
    return data.slice(0, opts.maxResults).map((item) => {
      const addr = item.address || {};
      const display = buildTwAddress(addr) || item.display_name || '';
      return {
        address: display,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        _raw: item.display_name, // 保留原始，用於 fallback 顯示
      };
    });
  }

  /**
   * 從 Nominatim addressdetails 物件組出台灣習慣的地址格式。
   * 例："臺中市太平區中興路118號"
   */
  function buildTwAddress(addr) {
    const city =
      addr.city || addr.county || addr.state_district || addr.state || '';
    // Nominatim 的台灣鄉鎮市區在 suburb 或 town 或 village
    const district =
      addr.suburb || addr.town || addr.municipality || addr.village || '';
    const road = addr.road || '';
    const houseNum = addr.house_number || '';

    if (!road && !city) return null;

    let result = '';
    if (city) result += city;
    if (district && district !== city) result += district;
    if (road) result += road;
    if (houseNum) result += houseNum;
    return result || null;
  }

  // ── 主搜尋邏輯 ────────────────────────────────────────────

  /**
   * 搜尋策略：
   * 1. 解析輸入 → 判斷是否為結構化地址
   * 2. 結構化（有路名+縣市/鄉鎮）→ 優先 structured query
   *    - 若結果空，降級到 free-text
   * 3. 非結構化（純路名、部分輸入）→ 直接 free-text query
   * 4. 兩者都空 → 顯示「找不到」
   */
  async function fetchResults(query) {
    if (currentAbortController) currentAbortController.abort();
    currentAbortController = new AbortController();
    const { signal } = currentAbortController;
    const timeoutId = setTimeout(() => currentAbortController.abort(), 5000);

    try {
      const parsed = parseQuery(query);
      let results = [];

      if (isStructured(parsed)) {
        // 有縣市/鄉鎮 + 路名 → structured query
        try {
          results = await fetchNominatimStructured(parsed, signal);
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          results = [];
        }

        // structured 無結果 → 降級 free-text
        if (results.length === 0) {
          try {
            results = await fetchNominatimFreetext(query, signal);
          } catch (e) {
            if (e.name === 'AbortError') throw e;
            results = [];
          }
        }
      } else {
        // 部分輸入或純路名 → free-text query（提供預測建議）
        try {
          results = await fetchNominatimFreetext(query, signal);
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          results = [];
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
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped})`, 'gi');
    return escapeHtml(text).replace(re, '<mark>$1</mark>');
  }

  /**
   * 從地址字串解析「縣市 鄉鎮區」作為副標題。
   * 優先從開頭匹配，若地址是台灣慣用格式（縣市開頭）直接抓。
   * 若是 Nominatim display_name 逗號格式，取後段。
   */
  function parseSubText(address) {
    // 台灣慣用格式：臺中市太平區... → "臺中市 太平區"
    const m = address.match(/^(.{2,4}[市縣])(.{2,4}[區鎮鄉市])/);
    if (m) return `${m[1]} · ${m[2]}`;

    // Nominatim display_name 逗號格式：取最後「臺灣」前的縣市欄位
    const parts = address.split(',').map((s) => s.trim());
    // 通常縣市在倒數第 3 個（最後是「臺灣」，倒數第 2 是郵遞區號）
    if (parts.length >= 3) {
      const city = parts[parts.length - 3];
      if (city && city !== '臺灣') return city;
    }
    return address.slice(0, 8);
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
    li.textContent = '找不到符合的地址';
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

      const main = document.createElement('div');
      main.className = 'ac-item-main';
      main.innerHTML = highlightText(item.address, query);

      const sub = document.createElement('div');
      sub.className = 'ac-item-sub';
      sub.textContent = parseSubText(item.address);

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

  function selectItem(idx) {
    const item = currentItems[idx];
    if (!item) return;
    inputEl.value = item.address;
    destroyList();
    if (typeof opts.onSelect === 'function') {
      opts.onSelect({ address: item.address, lat: item.lat, lng: item.lng });
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

  // ── 事件綁定 ──────────────────────────────────────────────

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
}

// 支援 CommonJS（Node.js 測試環境）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initAutocomplete };
}
