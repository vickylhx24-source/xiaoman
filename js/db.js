/* IndexedDB 数据层：物品 / 待购清单 / 设置 / 事件(浪费统计) */
window.DB = (function () {
  const DB_NAME = 'item-keeper';
  const DB_VERSION = 3;
  const S = { items: 'items', shopping: 'shopping', settings: 'settings', events: 'events', recipes: 'recipes', nutrition: 'nutrition' };

  let _db = null;
  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(S.items)) {
          const s = db.createObjectStore(S.items, { keyPath: 'id' });
          s.createIndex('category', 'category');
          s.createIndex('location', 'location');
          s.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains(S.shopping)) db.createObjectStore(S.shopping, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(S.settings)) db.createObjectStore(S.settings, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(S.events)) {
          const s = db.createObjectStore(S.events, { keyPath: 'id' });
          s.createIndex('type', 'type');
          s.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains(S.recipes)) {
          const s = db.createObjectStore(S.recipes, { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains(S.nutrition)) {
          const s = db.createObjectStore(S.nutrition, { keyPath: 'id' });
          s.createIndex('date', 'date');
        }
      };
      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }
  function store(name, mode) { return open().then(db => db.transaction(name, mode).objectStore(name)); }
  function done(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }

  // ---- items ----
  function putItem(it) { return store(S.items, 'readwrite').then(s => done(s.put(it))); }
  function getAllItems() {
    return store(S.items, 'readonly').then(s => done(s.getAll())).then(arr =>
      (arr || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
  }
  function deleteItem(id) { return store(S.items, 'readwrite').then(s => done(s.delete(id))); }
  function clearItems() { return store(S.items, 'readwrite').then(s => done(s.clear())); }

  // ---- shopping ----
  function putShopping(it) { return store(S.shopping, 'readwrite').then(s => done(s.put(it))); }
  function getAllShopping() { return store(S.shopping, 'readonly').then(s => done(s.getAll())); }
  function deleteShopping(id) { return store(S.shopping, 'readwrite').then(s => done(s.delete(id))); }
  function clearShopping() { return store(S.shopping, 'readwrite').then(s => done(s.clear())); }

  // ---- settings ----
  function putSetting(key, value) { return store(S.settings, 'readwrite').then(s => done(s.put({ key, value }))); }
  function getSetting(key) {
    return store(S.settings, 'readonly').then(s => done(s.get(key)))
      .then(r => (r ? r.value : undefined));
  }

  // ---- events (浪费/消耗记录，用于统计) ----
  function putEvent(ev) { return store(S.events, 'readwrite').then(s => done(s.put(ev))); }
  function getAllEvents() { return store(S.events, 'readonly').then(s => done(s.getAll())); }
  function clearEvents() { return store(S.events, 'readwrite').then(s => done(s.clear())); }

  // ---- recipes（菜谱收藏：图片以 base64 存于 IndexedDB，本机离线可用）----
  function putRecipe(r) { return store(S.recipes, 'readwrite').then(s => done(s.put(r))); }
  function getAllRecipes() {
    return store(S.recipes, 'readonly').then(s => done(s.getAll()))
      .then(arr => (arr || []).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)));
  }
  function getRecipe(id) { return store(S.recipes, 'readonly').then(s => done(s.get(id))); }
  function deleteRecipe(id) { return store(S.recipes, 'readwrite').then(s => done(s.delete(id))); }
  function clearRecipes() { return store(S.recipes, 'readwrite').then(s => done(s.clear())); }

  // ---- nutrition（饮食记录）----
  function putNutrition(r) { return store(S.nutrition, 'readwrite').then(s => done(s.put(r))); }
  function getAllNutrition() {
    return store(S.nutrition, 'readonly').then(s => done(s.getAll()))
      .then(arr => (arr || []).sort((a, b) => (b.ts || 0) - (a.ts || 0)));
  }
  function deleteNutrition(id) { return store(S.nutrition, 'readwrite').then(s => done(s.delete(id))); }
  function clearNutrition() { return store(S.nutrition, 'readwrite').then(s => done(s.clear())); }

  return { open, putItem, getAllItems, deleteItem, clearItems,
    putShopping, getAllShopping, deleteShopping, clearShopping,
    putSetting, getSetting, putEvent, getAllEvents, clearEvents,
    putRecipe, getAllRecipes, getRecipe, deleteRecipe, clearRecipes,
    putNutrition, getAllNutrition, deleteNutrition, clearNutrition, S };
})();
