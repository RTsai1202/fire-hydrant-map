/**
 * Taiwan Address Autocomplete
 * Uses NLSC TGLocator as primary API, Nominatim as fallback.
 */

/**
 * 初始化地址自動完成
 * @param {HTMLInputElement} inputEl - 搜尋輸入框元素
 * @param {Object} options
 * @param {Function} options.onSelect - 使用者選中候選項的回呼，傳入 { address, lat, lng }
 * @param {number} [options.minChars=3] - 最少幾個字才觸發
 * @param {number} [options.debounceMs=350] - 防抖延遲毫秒
 * @param {number} [options.maxResults=8] - 最多顯示幾筆
 */
function initAutocomplete(inputEl, options) {
  const opts = Object.assign(
    { minChars: 3, debounceMs: 350, maxResults: 8 },
    options
  );

  let debounceTimer = null;
  let currentAbortController = null;
  let activeIndex = -1;
  let currentItems = [];
  let listEl = null;

  // ── DOM 建立 ──────────────────────────────────────────────

  function ensureList() {
    if (listEl) return listEl;

    // 嘗試找既有的清單元素
    listEl = document.getElementById('autocomplete-list');
    if (listEl) return listEl;

    listEl = document.createElement('ul');
    listEl.id = 'autocomplete-list';
    listEl.setAttribute('role', 'listbox');

    // 附加到 #search-wrap，沒有的話就附加到 input 的父元素
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

  // ── API 呼叫 ──────────────────────────────────────────────

  /**
   * 建立帶逾時的 AbortController（3 秒）
   */
  function fetchWithTimeout(url, timeoutMs, signal) {
    return fetch(url, { signal });
  }

  /**
   * 主要 API：NLSC 國土測繪中心地址定位
   */
  async function fetchNLSC(query, signal) {
    const encoded = encodeURIComponent(query);
    const url = `https://api.nlsc.gov.tw/other/TGLocator/TGLocator_Addr_JSON/${encoded}`;
    const res = await fetchWithTimeout(url, 3000, signal);
    if (!res.ok) throw new Error(`NLSC HTTP ${res.status}`);
    const data = await res.json();

    const arr = data.AddressArray || [];
    return arr.slice(0, opts.maxResults).map((item) => ({
      address: item.FULL_ADDR || '',
      lat: parseFloat(item.Y),
      lng: parseFloat(item.X),
    }));
  }

  /**
   * 備案 API：Nominatim
   */
  async function fetchNominatim(query, signal) {
    const encoded = encodeURIComponent(query);
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?format=json&q=${encoded}&countrycodes=tw&limit=${opts.maxResults}&accept-language=zh-TW`;
    const res = await fetchWithTimeout(url, 3000, signal);
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const data = await res.json();

    return data.slice(0, opts.maxResults).map((item) => ({
      address: item.display_name || '',
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
    }));
  }

  /**
   * 同時呼叫兩個 API，優先使用 NLSC 結果，失敗或空結果時改用 Nominatim
   */
  async function fetchResults(query) {
    // 取消前一個請求
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const { signal } = currentAbortController;

    // 3 秒逾時
    const timeoutId = setTimeout(() => currentAbortController.abort(), 3000);

    try {
      // 先試 NLSC
      let results = [];
      try {
        results = await fetchNLSC(query, signal);
      } catch (e) {
        if (e.name === 'AbortError') throw e; // 逾時或被取消，直接拋出
        // NLSC 失敗（非 abort），繼續嘗試 Nominatim
        results = [];
      }

      // 若 NLSC 無結果，改用 Nominatim
      if (results.length === 0) {
        try {
          results = await fetchNominatim(query, signal);
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

  // ── 文字高亮 ──────────────────────────────────────────────

  function highlightText(text, keyword) {
    if (!keyword) return escapeHtml(text);
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped})`, 'gi');
    return escapeHtml(text).replace(re, '<mark>$1</mark>');
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 從完整地址解析縣市 + 鄉鎮區（次文字）
   * 例："臺中市太平區中興路118-7號" → "臺中市 太平區"
   */
  function parseSubText(address) {
    // 匹配「XX市/縣 XX區/鎮/鄉/市」
    const m = address.match(/^(.{2,4}[市縣])(.{2,4}[區鎮鄉市])/);
    if (m) return `${m[1]} ${m[2]}`;
    // 若無法解析，取前 6 個字
    return address.slice(0, 6);
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
        // 用 mousedown 防止 blur 觸發比 click 早
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

    // 邊界處理
    if (idx < 0) idx = items.length - 1;
    if (idx >= items.length) idx = 0;
    activeIndex = idx;

    items.forEach((el, i) => {
      el.classList.toggle('selected', i === activeIndex);
    });
  }

  // ── 主要搜尋流程 ──────────────────────────────────────────

  async function doSearch(query) {
    renderLoading();
    try {
      const results = await fetchResults(query);
      // 再次確認 input 的值沒有被清空
      if (inputEl.value.trim() === '') {
        destroyList();
        return;
      }
      renderItems(results, query);
    } catch (e) {
      if (e.name === 'AbortError') return; // 被取消，忽略
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

    debounceTimer = setTimeout(() => {
      doSearch(val);
    }, opts.debounceMs);
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

  // 點擊清單外關閉
  document.addEventListener('click', (e) => {
    if (!inputEl.contains(e.target) && listEl && !listEl.contains(e.target)) {
      destroyList();
    }
  });

  // input 清空時關閉清單
  inputEl.addEventListener('change', () => {
    if (inputEl.value.trim() === '') {
      destroyList();
    }
  });
}

// 支援 CommonJS（Node.js 測試環境）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initAutocomplete };
}
