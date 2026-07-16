/* 物品管家 · 家用库存助手 —— 主逻辑 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KB = window.KB, DB = window.DB;

  // ---------- 全局状态 ----------
  const state = {
    items: [],
    shopping: [],
    events: [],
    recipes: [],
    nutrition: [],
    nutritionProfile: { gender: '女', age: 30, height: 165, weight: 55, goal: '维持' },
    settings: { advanceDays: 3, theme: 'light', notify: true, members: ['我'], member: '我', autoCal: false, recipeProxy: '' },
    filter: { cat: '全部', member: '全部', q: '', status: '' },
    recFilter: '',
    editingId: null
  };
  let calDirty = false;

  // ---------- 日期工具 ----------
  const todayStr = () => new Date().toISOString().slice(0, 10);
  function addDays(str, n) {
    const d = new Date(str + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function daysLeft(str) {
    if (!str) return null;
    const a = new Date(todayStr() + 'T00:00:00');
    const b = new Date(str + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }
  function fmtDate(str) { return str || '—'; }

  // ---------- 预警引擎 ----------
  function statusOf(it) {
    const s = state.settings;
    const lowThreshold = (it.lowThreshold === '' || it.lowThreshold == null) ? null : Number(it.lowThreshold);
    const stockLow = lowThreshold != null && Number(it.quantity) <= lowThreshold;
    const eff = (it.openDate && it.shelfAfterOpen) ? addDays(it.openDate, Number(it.shelfAfterOpen)) : it.expiryDate;
    const d = daysLeft(eff);
    const expired = d != null && d < 0;
    const expiring = d != null && d >= 0 && d <= Number(s.advanceDays);
    const opened = !!it.openDate;
    let primary = 'ok';
    if (expired) primary = 'expired';
    else if (expiring) primary = 'expiring';
    else if (stockLow) primary = 'low';
    return { stockLow, expired, expiring, opened, eff, expiryDays: d, primary };
  }

  // ---------- 初始化 ----------
  async function init() {
    await DB.open();
    // 读取设置
    const adv = await DB.getSetting('advanceDays');
    const theme = await DB.getSetting('theme');
    const notify = await DB.getSetting('notify');
    const members = await DB.getSetting('members');
    const member = await DB.getSetting('member');
    if (adv != null) state.settings.advanceDays = adv;
    if (theme) state.settings.theme = theme;
    if (notify != null) state.settings.notify = notify;
    if (Array.isArray(members)) state.settings.members = members;
    if (member) state.settings.member = member;
    const autoCal = await DB.getSetting('autoCal');
    if (autoCal != null) state.settings.autoCal = autoCal;
    const proxy = await DB.getSetting('recipeProxy');
    if (proxy != null) state.settings.recipeProxy = proxy;

    state.items = await DB.getAllItems(); markCalDirty();
    if (!state.items.length && !(await DB.getSetting('seeded'))) {
      await seedSample();
      await DB.putSetting('seeded', true);
      state.items = await DB.getAllItems(); markCalDirty();
    }
    state.shopping = await DB.getAllShopping();
    state.events = await DB.getAllEvents();
    state.recipes = await DB.getAllRecipes();
    if (!(await DB.getSetting('seededLib'))) {
      await seedRecipes();
      await DB.putSetting('seededLib', true);
      state.recipes = await DB.getAllRecipes();
    }

    // 营养目标与记录
    const prof = await DB.getSetting('nutritionProfile');
    if (prof) Object.assign(state.nutritionProfile, prof);
    state.nutrition = await DB.getAllNutrition();
    if (!(await DB.getSetting('seededNutrition'))) {
      await seedNutrition();
      await DB.putSetting('seededNutrition', true);
      state.nutrition = await DB.getAllNutrition();
    }

    applyTheme();
    buildCategoryFilter();
    buildCatSelect();
    buildLocationSelect();
    buildUnitSelect();
    buildMemberSelect();
    buildMemberFilter();
    buildStatusChips();

    // 底部导航
    document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => { if (b.dataset.view) showView(b.dataset.view); }));
    $('fab-add').addEventListener('click', () => openItemSheet(null));
    $('btn-scan').addEventListener('click', scanBarcode);
    $('btn-voice').addEventListener('click', voiceInput);
    $('btn-batch').addEventListener('click', () => showSheet('sheet-batch', true));
    $('btn-photo').addEventListener('click', () => $('file-photo').click());
    $('file-photo').addEventListener('change', onPhotoPicked);
    $('item-form').addEventListener('submit', onItemSubmit);
    $('item-cancel').addEventListener('click', () => showSheet('sheet-item', false));
    $('item-del').addEventListener('click', deleteEditing);
    $('batch-form').addEventListener('submit', onBatchSubmit);
    $('batch-cancel').addEventListener('click', () => showSheet('sheet-batch', false));

    // 物品筛选
    $('filter-cat').addEventListener('change', e => { state.filter.cat = e.target.value; renderItems(); });
    $('filter-member').addEventListener('change', e => { state.filter.member = e.target.value; renderItems(); });
    $('search-q').addEventListener('input', e => { state.filter.q = e.target.value.trim(); renderItems(); });

    // 首页 KPI 与预警条点击跳转
    document.querySelectorAll('.kpi[data-jump]').forEach(el => el.addEventListener('click', () => jumpToStatus(el.dataset.jump)));
    $('home-alerts').addEventListener('click', (e) => { const p = e.target.closest('.pill[data-jump]'); if (p) jumpToStatus(p.dataset.jump); });
    $('home-shop-go').addEventListener('click', () => showView('stats'));

    // 菜谱与日历
    $('recipe-close').addEventListener('click', () => showSheet('sheet-recipe', false));
    $('btn-cal').addEventListener('click', exportCalendar);
    $('home-cal-btn').addEventListener('click', () => { exportCalendar(); calDirty = false; renderHome(); });
    $('set-autocal').addEventListener('change', e => { state.settings.autoCal = e.target.checked; saveSetting('autoCal', e.target.checked); renderHome(); });
    $('btn-sample').addEventListener('click', loadSample);

    // 菜谱模块（推荐与收藏均在底部「菜谱」Tab）
    document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('active', x === b));
      const mine = b.dataset.seg === 'mine';
      $('rec-seg-recommend').style.display = mine ? 'none' : 'block';
      $('rec-seg-mine').style.display = mine ? 'block' : 'none';
    }));
    ['rec-urgent-list', 'rec-now-list'].forEach(id =>
      $(id).addEventListener('click', (e) => { const c = e.target.closest('.recipe'); if (c) openRecipe(c.dataset.recipe); }));
    $('rec-mine-grid').addEventListener('click', (e) => { const c = e.target.closest('.rec-card'); if (c) openRecipe(c.dataset.recipe); });
    $('rec-search').addEventListener('input', (e) => { state.recFilter = e.target.value; renderRecipes(); });
    $('btn-add-recipe').addEventListener('click', () => openRecipeLink());
    $('recipe-edit-cancel').addEventListener('click', () => showSheet('sheet-recipe-edit', false));
    $('recipe-edit-form').addEventListener('submit', onRecipeEditSubmit);
    $('r-imgs').addEventListener('change', onRecipeImages);
    $('recipe-link-cancel').addEventListener('click', () => showSheet('sheet-recipe-link', false));
    $('recipe-link-form').addEventListener('submit', onRecipeLinkSubmit);
    $('r-extract').addEventListener('click', smartExtract);
    $('set-proxy').addEventListener('change', e => { state.settings.recipeProxy = e.target.value.trim(); saveSetting('recipeProxy', state.settings.recipeProxy); });
    $('btn-stats').addEventListener('click', () => showView('stats'));

    // 营养模块
    $('btn-add-meal').addEventListener('click', () => openNutriSheet(null));
    $('nutri-cancel').addEventListener('click', () => showSheet('sheet-nutri', false));
    $('nutri-form').addEventListener('submit', onNutriSubmit);
    $('nutri-parse').addEventListener('click', previewNutriFoods);
    $('nutri-voice').addEventListener('click', nutriVoice);
    $('nutri-photo').addEventListener('click', () => $('nutri-file').click());
    $('nutri-file').addEventListener('change', onNutriPhoto);
    $('nutri-scan').addEventListener('click', scanNutri);
    $('nutri-del').addEventListener('click', deleteNutri);
    // 管理饮食记录（今日记录模块已移出主页，此处提供删除/编辑入口）
    $('btn-manage-meal').addEventListener('click', () => { renderNutriManage(); showSheet('sheet-nutri-manage', true); });
    $('nutri-manage-cancel').addEventListener('click', () => showSheet('sheet-nutri-manage', false));
    // 今日营养进度：维度分段切换（维生素/矿物质/宏量）
    document.querySelectorAll('#nutri-prog-seg .seg-btn').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#nutri-prog-seg .seg-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      nutriProgCat = b.dataset.cat;
      renderNutriProgress(dayProgress(todayStr()).cover);
    }));
    // 还该补充什么：维度分段切换（维生素/矿物质/宏量）
    document.querySelectorAll('#nutri-warn-seg .seg-btn').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#nutri-warn-seg .seg-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      nutriWarnCat = b.dataset.cat;
      renderNutriWarn(dayProgress(todayStr()).cover);
    }));
    ['nutri-gender', 'nutri-age', 'nutri-height', 'nutri-weight', 'nutri-goal'].forEach(id =>
      $(id).addEventListener('change', saveNutriProfile));

    // 设置页
    $('set-advance').addEventListener('change', e => saveSetting('advanceDays', Number(e.target.value)));
    $('set-theme').addEventListener('change', e => { state.settings.theme = e.target.value; saveSetting('theme', e.target.value); applyTheme(); });
    $('set-notify').addEventListener('change', e => { state.settings.notify = e.target.checked; saveSetting('notify', e.target.checked); if (e.target.checked) askNotify(); });
    $('set-member').addEventListener('change', e => { state.settings.member = e.target.value; saveSetting('member', e.target.value); });
    $('btn-add-member').addEventListener('click', addMember);
    $('btn-export').addEventListener('click', exportData);
    $('file-import').addEventListener('change', importData);
    $('btn-test-notify').addEventListener('click', testNotify);
    $('btn-clear-all').addEventListener('click', clearAll);

    // 注册 Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    showView('home');
    await maybeNotify();
  }

  function saveSetting(k, v) { return DB.putSetting(k, v); }

  // ---------- 视图切换 ----------
  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    if (name === 'home') renderHome();
    if (name === 'items') renderItems();
    if (name === 'reminders') renderReminders();
    if (name === 'stats') renderStats();
    if (name === 'me') renderMe();
    if (name === 'recipes') renderRecipes();
    if (name === 'nutrition') { renderNutrition(); }
  }

  function showSheet(id, show) { $(id).classList.toggle('show', show); }

  // ---------- 下拉框构建 ----------
  function buildCategoryFilter() {
    const cats = ['全部', ...KB.categories.map(c => c.id)];
    $('filter-cat').innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
  }
  function buildCatSelect() {
    $('item-cat').innerHTML = KB.categories.map(c => `<option value="${c.id}">${c.icon} ${c.id}</option>`).join('');
  }
  function buildLocationSelect() {
    const dl = $('loc-list');
    if (dl) dl.innerHTML = KB.locations.map(l => `<option value="${l}"></option>`).join('');
  }
  function buildUnitSelect() {
    $('item-unit').innerHTML = KB.units.map(u => `<option value="${u}">${u}</option>`).join('');
  }
  function buildMemberSelect() {
    const opts = state.settings.members.map(m => `<option value="${m}">${m}</option>`).join('');
    $('item-member').innerHTML = opts;
    $('item-member').value = state.settings.member;
  }
  function buildMemberFilter() {
    const opts = ['全部', ...state.settings.members].map(m => `<option value="${m}">${m}</option>`).join('');
    $('filter-member').innerHTML = opts;
  }
  function buildStatusChips() {
    const opts = [['全部', ''], ['已过期', 'expired'], ['临近过期', 'expiring'], ['库存不足', 'low']];
    const box = $('status-chips');
    box.innerHTML = opts.map(([label, val]) =>
      `<button class="status-chip ${state.filter.status === val ? 'active' : ''}" data-status="${val}">${label}</button>`).join('');
    box.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => {
      state.filter.status = b.dataset.status;
      box.querySelectorAll('.status-chip').forEach(x => x.classList.toggle('active', x.dataset.status === b.dataset.status));
      renderItems();
    }));
  }
  function jumpToStatus(status) {
    state.filter.status = (status === 'total' || status === '') ? '' : status;
    showView('items');
    buildStatusChips();
  }

  // ---------- 智能录入：扫码 ----------
  async function scanBarcode() {
    if (!('BarcodeDetector' in window)) {
      toast('当前浏览器不支持扫码，已为你打开手动输入（可填条码号）');
      openItemSheet(null);
      setTimeout(() => $('item-barcode').focus(), 300);
      return;
    }
    const sheet = $('sheet-scan');
    showSheet('sheet-scan', true);
    const video = $('scan-video');
    let stream = null, raf = null, stopped = false;
    let bd;
    try { bd = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'data_matrix'] }); }
    catch (e) { bd = new BarcodeDetector(); }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      await video.play();
      const loop = async () => {
        if (stopped) return;
        try {
          const codes = await bd.detect(video);
          if (codes.length) {
            const v = codes[0].rawValue;
            stopScan();
            openItemSheet(null);
            $('item-barcode').value = v;
            toast('已识别条码：' + v + '（请补全名称/分类）');
            return;
          }
        } catch (e) {}
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      toast('无法打开相机，请手动输入');
      stopScan();
      openItemSheet(null);
    }
    function stopScan() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach(t => t.stop());
      showSheet('sheet-scan', false);
    }
    $('scan-close').addEventListener('click', stopScan, { once: true });
  }

  // ---------- 智能录入：语音 ----------
  function voiceInput() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('当前浏览器不支持语音，请手动输入'); return; }
    const r = new SR();
    r.lang = 'zh-CN';
    r.interimResults = false;
    toast('请说出物品名称…（如「两盒牛奶 冰箱」）');
    r.onresult = (e) => {
      const text = e.results[0][0].transcript;
      parseVoice(text);
    };
    r.onerror = () => toast('语音识别失败，请手动输入');
    r.start();
  }
  function parseVoice(text) {
    openItemSheet(null);
    const m = text.match(/(\d+(\.\d+)?)\s*([个瓶袋盒包罐支片斤克])/);
    let name = text, qty = 1, unit = '个';
    if (m) { qty = Number(m[1]); unit = m[3]; name = text.replace(m[0], ''); }
    // 尝试从位置预设中匹配
    let loc = '', cat = KB.classifyByName(name);
    for (const l of KB.locations) if (name.includes(l.split('-')[0])) { loc = l; break; }
    $('item-name').value = name.trim();
    $('item-qty').value = qty;
    $('item-unit').value = unit;
    $('item-cat').value = cat;
    if (loc) $('item-loc').value = loc; else $('item-loc').value = KB.categoryById(cat).loc;
    toast('已识别：' + name.trim());
  }

  // ---------- 智能录入：拍照 ----------
  function onPhotoPicked(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 800;
        let { width, height } = img;
        if (width > max || height > max) {
          if (width >= height) { height = Math.round(height * max / width); width = max; }
          else { width = Math.round(width * max / height); height = max; }
        }
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        c.getContext('2d').drawImage(img, 0, 0, width, height);
        const data = c.toDataURL('image/jpeg', 0.7);
        // 如果在物品表单里，则存到表单暂存；否则作为新物品照片
        if ($('sheet-item').classList.contains('show')) {
          $('item-photo-preview').src = data;
          $('item-photo-preview').style.display = 'block';
          $('item-form').dataset.photo = data;
        } else {
          openItemSheet(null);
          $('item-photo-preview').src = data;
          $('item-photo-preview').style.display = 'block';
          $('item-form').dataset.photo = data;
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  // ---------- 智能录入：小票批量 ----------
  function onBatchSubmit(e) {
    e.preventDefault();
    const text = $('batch-text').value.trim();
    if (!text) return;
    const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    let n = 0;
    const items = [];
    for (const line of lines) {
      const parts = line.split(/[,，\s]+/).filter(Boolean);
      if (!parts.length) continue;
      const name = parts[0];
      let qty = 1, cat = KB.classifyByName(name), loc = KB.categoryById(cat).loc, unit = '个';
      if (parts[1] && /^\d+(\.\d+)?$/.test(parts[1])) { qty = Number(parts[1]); }
      if (parts[2] && KB.categories.some(c => c.id === parts[2])) cat = parts[2];
      if (parts[3] && KB.locations.includes(parts[3])) loc = parts[3];
      const shelf = KB.categoryById(cat).shelf;
      items.push(makeItem({ name, quantity: qty, unit, category: cat, location: loc,
        expiryDate: shelf ? addDays(todayStr(), shelf) : '', member: state.settings.member }));
      n++;
    }
    (async () => {
      for (const it of items) await DB.putItem(it);
      state.items = await DB.getAllItems(); markCalDirty();
      showSheet('sheet-batch', false);
      $('batch-text').value = '';
      toast('已批量添加 ' + n + ' 项');
      renderItems();
    })();
  }
  function makeItem(o) {
    return Object.assign({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      name: '', category: '其他', location: '', quantity: 1, unit: '个',
      lowThreshold: '', openDate: '', expiryDate: '', shelfAfterOpen: '',
      barcode: '', price: '', photo: '', note: '', member: state.settings.member,
      createdAt: Date.now(), updatedAt: Date.now()
    }, o);
  }

  // ---------- 物品表单 ----------
  function openItemSheet(id) {
    state.editingId = id;
    const f = $('item-form');
    f.reset();
    f.dataset.photo = '';
    $('item-photo-preview').style.display = 'none';
    $('item-member').value = state.settings.member;
    if (id) {
      const it = state.items.find(x => x.id === id);
      if (!it) return;
      $('item-title').textContent = '编辑物品';
      $('item-name').value = it.name;
      $('item-cat').value = it.category;
      $('item-loc').value = it.location;
      $('item-qty').value = it.quantity;
      $('item-unit').value = it.unit;
      $('item-low').value = it.lowThreshold;
      $('item-open').value = it.openDate;
      $('item-expiry').value = it.expiryDate;
      $('item-shelf').value = it.shelfAfterOpen;
      $('item-barcode').value = it.barcode;
      $('item-price').value = it.price;
      $('item-note').value = it.note;
      $('item-member').value = it.member;
      if (it.photo) { $('item-photo-preview').src = it.photo; $('item-photo-preview').style.display = 'block'; f.dataset.photo = it.photo; }
      $('item-del').style.display = 'block';
    } else {
      $('item-title').textContent = '添加物品';
      $('item-del').style.display = 'none';
      // 根据分类自动填默认位置
      $('item-cat').onchange = () => {
        if (!$('item-loc').value) $('item-loc').value = KB.categoryById($('item-cat').value).loc;
      };
    }
    showSheet('sheet-item', true);
  }

  async function onItemSubmit(e) {
    e.preventDefault();
    const f = $('item-form');
    const data = {
      name: $('item-name').value.trim(),
      category: $('item-cat').value,
      location: $('item-loc').value.trim(),
      quantity: Number($('item-qty').value) || 1,
      unit: $('item-unit').value,
      lowThreshold: $('item-low').value === '' ? '' : Number($('item-low').value),
      openDate: $('item-open').value,
      expiryDate: $('item-expiry').value,
      shelfAfterOpen: $('item-shelf').value === '' ? '' : Number($('item-shelf').value),
      barcode: $('item-barcode').value.trim(),
      price: $('item-price').value === '' ? '' : Number($('item-price').value),
      note: $('item-note').value.trim(),
      member: $('item-member').value,
      photo: f.dataset.photo || ''
    };
    if (!data.name) { toast('请填写物品名称'); return; }
    // 智能建议：填了开封日期但没填开封后保质期
    if (data.openDate && !data.shelfAfterOpen) {
      const sug = KB.suggestAfterOpen(data.name);
      if (sug && sug < 9999) data.shelfAfterOpen = sug;
    }
    // 智能建议：填了分类但没填到期日且有默认保质期
    if (!data.expiryDate && !data.openDate) {
      const shelf = KB.categoryById(data.category).shelf;
      if (shelf) data.expiryDate = addDays(todayStr(), shelf);
    }
    if (state.editingId) {
      const old = state.items.find(x => x.id === state.editingId);
      Object.assign(old, data, { updatedAt: Date.now() });
      await DB.putItem(old);
      toast('已更新');
    } else {
      const it = makeItem(data);
      await DB.putItem(it);
      toast('已添加');
    }
    state.items = await DB.getAllItems(); markCalDirty();
    showSheet('sheet-item', false);
    renderItems();
  }

  async function deleteEditing() {
    if (!state.editingId) return;
    if (!confirm('确定删除该物品？')) return;
    await DB.deleteItem(state.editingId);
    state.items = await DB.getAllItems(); markCalDirty();
    showSheet('sheet-item', false);
    renderItems();
  }

  async function discardItem(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return;
    if (!confirm('标记为「已丢弃/过期」？将记录浪费金额并从清单移除。')) return;
    const val = (Number(it.price) || 0) * (Number(it.quantity) || 1);
    await DB.putEvent({ id: 'ev-' + Date.now(), type: 'waste', date: todayStr(),
      itemName: it.name, category: it.category, value: val });
    await DB.deleteItem(id);
    state.items = await DB.getAllItems(); markCalDirty();
    state.events = await DB.getAllEvents();
    toast('已记录浪费 ¥' + val.toFixed(2));
    renderItems();
  }

  // ---------- 渲染：物品列表 ----------
  function renderItems() {
    const f = state.filter;
    let list = state.items.slice();
    if (f.cat !== '全部') list = list.filter(i => i.category === f.cat);
    if (f.member !== '全部') list = list.filter(i => (i.member || '我') === f.member);
    if (f.q) list = list.filter(i => i.name.toLowerCase().includes(f.q.toLowerCase()));
    if (f.status === 'expired') list = list.filter(i => statusOf(i).expired);
    else if (f.status === 'expiring') list = list.filter(i => statusOf(i).expiring);
    else if (f.status === 'low') list = list.filter(i => statusOf(i).stockLow);
    list.sort((a, b) => rank(b) - rank(a));
    const box = $('items-list');
    if (!list.length) { box.innerHTML = '<p class="empty">还没有物品，点击右下角 + 添加吧</p>'; return; }
    box.innerHTML = list.map(it => cardHtml(it)).join('');
    box.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id, act = btn.dataset.act;
      if (act === 'edit') openItemSheet(id);
      if (act === 'del') discardItem(id);
      if (act === 'buy') addToShopping(id);
    }));
  }
  function rank(it) { const s = statusOf(it); return { expired: 3, expiring: 2, low: 1, ok: 0 }[s.primary]; }
  function cardHtml(it) {
    const s = statusOf(it);
    const cat = KB.categoryById(it.category);
    let badges = '';
    if (s.expired) badges += '<span class="badge red">已过期</span>';
    else if (s.expiring) badges += `<span class="badge orange">${s.expiryDays}天后到期</span>`;
    if (s.stockLow) badges += '<span class="badge yellow">库存不足</span>';
    if (s.opened) badges += '<span class="badge gray">已开封</span>';
    const expLine = s.eff ? `到期/开封后：${fmtDate(s.eff)}${s.expiryDays != null ? `（${s.expiryDays >= 0 ? '剩' + s.expiryDays + '天' : '已过' + Math.abs(s.expiryDays) + '天'}）` : ''}` : '未设到期';
    const photo = it.photo ? `<img class="thumb" src="${it.photo}" alt="">` : `<div class="thumb icon">${cat.icon}</div>`;
    const price = it.price ? `<span class="price">¥${Number(it.price).toFixed(2)}</span>` : '';
    const member = it.member && it.member !== '我' ? `<span class="m">· ${it.member}</span>` : '';
    return `<div class="card pri-${s.primary}">
      ${photo}
      <div class="card-body">
        <div class="card-top"><span class="name">${escapeHtml(it.name)}</span>${price}</div>
        <div class="meta">${cat.icon}${it.category} · 📍${escapeHtml(it.location || '未定位')}${member}</div>
        <div class="meta">数量：${it.quantity}${it.unit} · ${expLine}</div>
        <div class="badges">${badges}</div>
      </div>
      <div class="card-acts">
        <button data-act="buy" data-id="${it.id}" title="加入待购">🛒</button>
        <button data-act="edit" data-id="${it.id}" title="编辑">✏️</button>
        <button data-act="del" data-id="${it.id}" title="丢弃/过期">🗑️</button>
      </div>
    </div>`;
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------- 渲染：首页仪表盘 ----------
  function renderHome() {
    const counts = { total: state.items.length, expired: 0, expiring: 0, low: 0, opened: 0 };
    let value = 0, waste = 0;
    state.items.forEach(it => {
      const s = statusOf(it);
      if (s.expired) counts.expired++;
      if (s.expiring) counts.expiring++;
      if (s.stockLow) counts.low++;
      if (s.opened) counts.opened++;
      if (it.price) value += Number(it.price) * (Number(it.quantity) || 1);
    });
    state.events.forEach(ev => { if (ev.type === 'waste') waste += Number(ev.value) || 0; });

    // 封面日期与今日概览
    const d = new Date();
    const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    $('hero-date').textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${wd}`;
    let summary;
    if (!counts.expired && !counts.expiring && !counts.low) summary = '今天一切正常，囤货无忧 ✓';
    else {
      const parts = [];
      if (counts.expired) parts.push(`${counts.expired} 件已过期`);
      if (counts.expiring) parts.push(`${counts.expiring} 件临期`);
      if (counts.low) parts.push(`${counts.low} 件库存不足`);
      summary = '你有 ' + parts.join('、') + '，顺手处理一下吧～';
    }
    $('hero-summary').textContent = summary;

    $('stat-total').textContent = counts.total;
    $('stat-expired').textContent = counts.expired;
    $('stat-expiring').textContent = counts.expiring;
    $('stat-low').textContent = counts.low;
    $('stat-value').textContent = '¥' + value.toFixed(0);
    $('stat-waste').textContent = '¥' + waste.toFixed(0);

    // 分类环形图
    const byCat = {};
    state.items.forEach(it => { byCat[it.category] = (byCat[it.category] || 0) + 1; });
    const segs = KB.categories.filter(c => byCat[c.id]).map(c => ({ label: c.id, value: byCat[c.id], color: catColor(c.id) }));
    drawDoughnut($('chart-cat'), segs);

    // 菜谱推荐已迁移到底部「菜谱」Tab（推荐分段），首页不再展示。

    // 日历同步卡片
    const calItems = state.items.filter(i => { const s = statusOf(i); return s.eff; });
    const hc = $('home-cal');
    if (calItems.length) {
      hc.style.display = 'block';
      if (state.settings.autoCal && calDirty) $('home-cal-info').textContent = '⚠️ 物品有变动，到期日历待更新，点下方按钮重新导出。';
      else if (state.settings.autoCal) $('home-cal-info').textContent = '✅ 自动同步已开启。物品变动后会在此提示重新导出；真正的系统日历实时订阅需后端（可选升级）。';
      else $('home-cal-info').textContent = '共 ' + calItems.length + ' 个物品带到期日。导出为日历文件，导入手机日历后到期前会自动提醒。开启「自动同步」可获变动提醒。';
    } else hc.style.display = 'none';

    // 首页待购提醒卡片（在提醒/物品页点 🛒 后，回到首页会出现）
    const pend = state.shopping.filter(s => !s.done);
    const hs = $('home-shopping');
    if (pend.length) {
      hs.style.display = 'block';
      $('home-shop-count').textContent = '（' + pend.length + ' 件待买）';
      $('home-shop-list').innerHTML = pend.slice(0, 5).map(s =>
        `<div class="shop-item"><label><span>${escapeHtml(s.name)} ×${s.qty}</span></label></div>`).join('')
        + (pend.length > 5 ? `<p class="tip">还有 ${pend.length - 5} 件…</p>` : '');
    } else {
      hs.style.display = 'none';
    }

    // 顶部预警条
    const alertBox = $('home-alerts');
    const alerts = [];
    if (counts.expired) alerts.push(`<span class="pill red" data-jump="expired">${counts.expired} 件已过期 ›</span>`);
    if (counts.expiring) alerts.push(`<span class="pill orange" data-jump="expiring">${counts.expiring} 件临期 ›</span>`);
    if (counts.low) alerts.push(`<span class="pill yellow" data-jump="low">${counts.low} 件库存不足 ›</span>`);
    alertBox.innerHTML = alerts.length ? alerts.join('') : '<span class="pill ok">一切正常 ✓</span>';
  }

  // ---------- 临期菜谱推荐（按紧急度排序）----------
  function matchRecipes(items) {
    const map = {};
    items.forEach(it => {
      const nm = (it.name || '').toLowerCase();
      const s = statusOf(it);
      const urg = s.expired ? 3 : s.expiring ? 2 : 0;
      (state.recipes || []).forEach(r => {
        const names = recipeIngredientNames(r).map(x => x.toLowerCase());
        if (names.some(k => nm.includes(k))) {
          if (!map[r.id]) map[r.id] = Object.assign({}, r, { matchNames: [], urgency: 0 });
          if (map[r.id].matchNames.indexOf(it.name) === -1) map[r.id].matchNames.push(it.name);
          map[r.id].urgency = Math.max(map[r.id].urgency, urg);
        }
      });
    });
    return Object.keys(map).map(k => map[k]).sort((a, b) => b.urgency - a.urgency || b.matchNames.length - a.matchNames.length);
  }

  // ---------- 冰箱 → 菜谱匹配辅助 ----------
  function fridgeNames() { return state.items.map(i => (i.name || '').toLowerCase()); }
  function fridgeHas(name) {
    const n = (name || '').toLowerCase().trim();
    if (!n) return false;
    return fridgeNames().some(x => x.includes(n));
  }
  // 菜谱需要的食材名列表（内置=needs；收藏=从食材行提取名称）
  function recipeIngredientNames(r) {
    if (r.needs) return r.needs.slice();
    if (Array.isArray(r.ingredients)) return r.ingredients.map(extractIngredientName).filter(Boolean);
    return [];
  }
  function extractIngredientName(line) {
    return line.replace(/[\d\.\/×xX]+/g, '')
      .replace(/(ml|g|克|个|片|根|勺|匙|杯|瓶|袋|盒|斤|两|把|颗|粒|张|块|只|尾|瓣|毫升|大匙|小勺)+/gi, '')
      .trim().split(/\s+/)[0] || line.trim();
  }
  function recipeCookable(r) {
    const names = recipeIngredientNames(r);
    if (!names.length) return false;
    return names.every(n => fridgeHas(n));
  }
  function missingForRecipe(r) {
    return recipeIngredientNames(r).filter(n => !fridgeHas(n));
  }
  async function addRecipeToShopping(r) {
    const ing = recipeIngredientNames(r);
    const miss = ing.filter(n => !fridgeHas(n));
    const toAdd = miss.length ? miss : ing;
    if (!toAdd.length) { toast('没有可加入的食材'); return; }
    for (const name of toAdd) {
      const exists = state.shopping.find(s => s.name === name);
      if (exists) { exists.qty = (Number(exists.qty) || 1) + 1; await DB.putShopping(exists); }
      else await DB.putShopping({ id: 'sh-' + Date.now() + Math.random().toString(36).slice(2, 5), name, qty: 1, done: false });
    }
    state.shopping = await DB.getAllShopping();
    toast(miss.length ? ('已加入 ' + miss.length + ' 种缺少食材到待购') : '已加入全部食材到待购');
  }

  // 推荐页的一行菜谱卡片
  function recipeRow(r, kind) {
    let badge = '';
    if (kind === 'urgent') badge = r.urgency >= 3 ? '<span class="badge red">已过期食材</span>' : '<span class="badge orange">临期</span>';
    const meta = (r.matchNames && r.matchNames.length) ? '用掉临期：' + escapeHtml(r.matchNames.join('、')) : '需要：' + escapeHtml((r.needs || recipeIngredientNames(r)).join('、'));
    const badges = badge ? '<div class="badges">' + badge + '</div>' : '';
    return `<div class="recipe" data-recipe="${r.id}">
      <div class="recipe-ico">${r.ico || '🍲'}</div>
      <div class="recipe-body"><div class="recipe-name">${escapeHtml(r.name)}</div><div class="recipe-meta">${meta}</div></div>
      ${badges}<span class="recipe-go">做法 ›</span></div>`;
  }

  function renderRecipes() {
    // 推荐段：仅临期优先 + 现在就能做
    const expiringItems = state.items.filter(i => { const s = statusOf(i); return s.expiring || s.expired; });
    const urgent = matchRecipes(expiringItems);
    $('rec-urgent-list').innerHTML = urgent.length ? urgent.map(r => recipeRow(r, 'urgent')).join('')
      : '<p class="empty">没有临期食材，赞！</p>';
    const nowList = state.recipes.filter(recipeCookable);
    $('rec-now-list').innerHTML = nowList.length ? nowList.map(r => recipeRow(r, 'now')).join('')
      : '<p class="empty">冰箱里还凑不齐一道菜，去买点料吧～</p>';

    // 我的收藏段 = 全部菜谱（可搜索 / 增删改）
    const q = (state.recFilter || '').trim().toLowerCase();
    const list = state.recipes.filter(r => {
      if (!q) return true;
      if (r.name.toLowerCase().includes(q)) return true;
      return recipeIngredientNames(r).some(n => n.toLowerCase().includes(q));
    });
    const grid = $('rec-mine-grid');
    if (list.length) {
      grid.innerHTML = list.map(r => {
        const cover = (r.images && r.images.length) ? `<img src="${r.images[0]}" alt="">` : `<div class="rec-cover icon">${r.ico || '🍲'}</div>`;
        return `<div class="rec-card" data-recipe="${r.id}">${cover}<div class="rec-card-name">${escapeHtml(r.name)}</div></div>`;
      }).join('');
    } else grid.innerHTML = '<p class="empty">没有匹配的菜谱</p>';
  }

  // ---------- 菜谱详情（统一从收藏读取，均可编辑/删除）----------
  let currentRecipe = null;
  function openRecipe(id) {
    const r = state.recipes.find(x => x.id === id);
    if (!r) return;
    currentRecipe = r;
    $('recipe-title').textContent = (r.ico ? r.ico + ' ' : '🍲 ') + r.name;
    let html = '';
    if (r.images && r.images.length) {
      html += '<div class="rec-imgs">' + r.images.map(src => `<img src="${src}" alt="">`).join('') + '</div>';
    }
    const ingNames = recipeIngredientNames(r);
    const have = ingNames.filter(n => fridgeHas(n));
    const miss = ingNames.filter(n => !fridgeHas(n));
    const needText = ingNames.join('、') || '—';
    html += `<p class="recipe-needs">🥗 需要：${escapeHtml(needText)}</p>`;
    if (r.source) html += `<p class="tip">🔗 <a href="${escapeHtml(r.source)}" target="_blank" rel="noopener">查看来源</a></p>`;
    if (ingNames.length) {
      html += '<div class="rec-have">';
      if (have.length) html += `<span class="badge gray">✅ 已有 ${escapeHtml(have.join('、'))}</span>`;
      if (miss.length) html += `<span class="badge yellow">❌ 缺 ${escapeHtml(miss.join('、'))}</span>`;
      html += '</div>';
    }
    const steps = r.steps || [];
    html += '<ol class="recipe-steps">' + (steps.map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li>—</li>') + '</ol>';
    html += `<button id="rd-buy" class="block-btn primary">${miss.length ? '🛒 补全缺少食材（' + miss.length + '）' : '🛒 加入待购'}</button>`;
    html += '<button id="rd-eat" class="block-btn outline">🍽️ 记录吃了这道菜</button>';
    html += '<button id="rd-edit" class="block-btn outline">✏️ 编辑菜谱</button>';
    html += '<button id="rd-del" class="block-btn danger">🗑️ 删除菜谱</button>';
    $('recipe-body').innerHTML = html;
    $('rd-buy').onclick = () => addRecipeToShopping(r);
    $('rd-eat').onclick = () => { showSheet('sheet-recipe', false); openNutriSheet(null, r.name); };
    $('rd-edit').onclick = () => { showSheet('sheet-recipe', false); openRecipeEdit(r.id); };
    $('rd-del').onclick = () => deleteRecipe(r.id);
    showSheet('sheet-recipe', true);
  }

  // ---------- 保存 / 编辑菜谱（图片存 IndexedDB）----------
  let editImages = [];
  function openRecipeEdit(id) {
    const f = $('recipe-edit-form');
    f.reset();
    editImages = [];
    $('r-img-preview').innerHTML = '';
    if (id) {
      const r = state.recipes.find(x => x.id === id);
      if (!r) return;
      $('recipe-edit-title').textContent = '编辑菜谱';
      $('r-name').value = r.name;
      $('r-source').value = r.source || '';
      $('r-ing').value = (r.ingredients || []).join('\n');
      $('r-steps').value = (r.steps || []).join('\n');
      $('r-tags').value = (r.tags || []).join(',');
      editImages = (r.images || []).slice();
      renderEditImages();
      $('recipe-edit-del').style.display = 'block';
      $('recipe-edit-del').onclick = () => deleteRecipe(r.id);
    } else {
      $('recipe-edit-title').textContent = '保存菜谱';
      $('recipe-edit-del').style.display = 'none';
    }
    f.dataset.id = id || '';
    showSheet('sheet-recipe-edit', true);
  }
  async function onRecipeImages(e) {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      try { const d = await compressImageFile(file); editImages.push(d); } catch (_) {}
    }
    renderEditImages();
    e.target.value = '';
  }
  function renderEditImages() {
    $('r-img-preview').innerHTML = editImages.map((src, i) =>
      `<div class="img-thumb"><img src="${src}" alt=""><button type="button" class="x" data-idx="${i}">✕</button></div>`).join('');
    $('r-img-preview').querySelectorAll('.x').forEach(b => b.addEventListener('click', () => {
      editImages.splice(Number(b.dataset.idx), 1); renderEditImages();
    }));
  }
  async function onRecipeEditSubmit(e) {
    e.preventDefault();
    const name = $('r-name').value.trim();
    if (!name) { toast('请填写菜名'); return; }
    const ingredients = $('r-ing').value.split('\n').map(s => s.trim()).filter(Boolean);
    const steps = $('r-steps').value.split('\n').map(s => s.trim()).filter(Boolean);
    const tags = $('r-tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const source = $('r-source').value.trim();
    const id = $('recipe-edit-form').dataset.id;
    const rec = {
      id: id || ('rc-' + Date.now() + Math.random().toString(36).slice(2, 6)),
      name, source, ingredients, steps, tags, images: editImages.slice(),
      createdAt: Date.now(), updatedAt: Date.now()
    };
    await DB.putRecipe(rec);
    state.recipes = await DB.getAllRecipes();
    showSheet('sheet-recipe-edit', false);
    toast('已保存菜谱');
    renderRecipes();
  }
  async function deleteRecipe(id) {
    if (!confirm('确定删除该菜谱？')) return;
    await DB.deleteRecipe(id);
    state.recipes = await DB.getAllRecipes();
    showSheet('sheet-recipe', false);
    toast('已删除');
    renderRecipes();
  }

  // ---------- 从链接保存（小红书等）----------
  function openRecipeLink() { showSheet('sheet-recipe-link', true); $('r-link').value = ''; $('r-paste').value = ''; $('r-link-result').innerHTML = ''; }
  async function onRecipeLinkSubmit(e) {
    e.preventDefault();
    const url = $('r-link').value.trim();
    if (!url) { toast('请粘贴链接'); return; }
    const proxy = state.settings.recipeProxy;
    if (proxy) {
      toast('正在抓取…');
      try {
        const r = await fetchFromProxy(proxy, url);
        $('r-name').value = r.title || '';
        $('r-source').value = url;
        $('r-ing').value = (r.ingredients || []).join('\n');
        $('r-steps').value = (r.steps || []).join('\n');
        editImages = [];
        if (r.images && r.images.length) await loadProxyImages(r.images);
        renderEditImages();
        $('recipe-edit-form').dataset.id = '';
        showSheet('sheet-recipe-link', false);
        showSheet('sheet-recipe-edit', true);
        return;
      } catch (err) {
        $('r-link-result').innerHTML = '<p class="tip">自动抓取失败：' + escapeHtml((err && err.message) || err) + '。可手动填写，或用下方「智能提取」。</p>';
      }
    } else {
      $('r-link-result').innerHTML = '<p class="tip">未配置抓取代理，已为你打开手动表单；也可把笔记正文粘贴到下方「智能提取」自动拆分。</p>';
    }
    $('r-name').value = '';
    $('r-source').value = url;
    $('r-ing').value = '';
    $('r-steps').value = '';
    editImages = [];
    renderEditImages();
    $('recipe-edit-form').dataset.id = '';
    showSheet('sheet-recipe-link', false);
    showSheet('sheet-recipe-edit', true);
  }
  async function fetchFromProxy(proxy, url) {
    const sep = proxy.indexOf('?') >= 0 ? '&' : '?';
    const resp = await fetch(proxy + sep + 'url=' + encodeURIComponent(url), { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const images = Array.isArray(data.images) ? data.images : (data.image ? [data.image] : []);
    const ingredients = Array.isArray(data.ingredients) ? data.ingredients
      : (data.ingredientsText ? [data.ingredientsText] : []);
    const steps = Array.isArray(data.steps) ? data.steps : (data.text ? splitSteps(data.text) : []);
    return { title: data.title || data.name || '', images, ingredients, steps, text: data.text || '' };
  }
  async function loadProxyImages(urls) {
    for (const u of urls.slice(0, 6)) {
      try {
        const r = await fetch(u, { mode: 'cors' });
        const blob = await r.blob();
        const d = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
        editImages.push(d);
      } catch (_) { editImages.push(u); }
    }
  }
  function smartExtract() {
    const text = $('r-paste').value;
    if (!text) { toast('请粘贴笔记正文'); return; }
    const { ing, steps } = parseRecipeText(text);
    $('r-ing').value = ing.join('\n');
    $('r-steps').value = steps.join('\n');
    toast('已智能拆分 ' + ing.length + ' 种食材、' + steps.length + ' 步');
  }
  function parseRecipeText(text) {
    const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const ing = [], steps = [];
    let mode = null;
    const ingKw = /(食材|用料|原料|材料|准备)/;
    const stepKw = /(步骤|做法|制作|流程|方法|教程)/;
    const unitRe = /[个只片块斤克gml斤两把根勺匙杯瓶袋盒颗粒张块只尾瓣]|ml|g/i;
    for (const l of lines) {
      if (ingKw.test(l)) { mode = 'ing'; continue; }
      if (stepKw.test(l)) { mode = 'step'; continue; }
      if (/^(\d+[\.、]|[一二三四五六七八九十]+[、.])/.test(l)) {
        steps.push(l.replace(/^(\d+[\.、]|[一二三四五六七八九十]+[、.])\s*/, '')); mode = 'step'; continue;
      }
      if (mode === 'step') { steps.push(l); continue; }
      if (mode === 'ing') { ing.push(l); continue; }
      if (/[\d一二三四五六七八九十]/.test(l) && unitRe.test(l)) ing.push(l);
      else if (l.length < 20 && !/[，,。；;、]/.test(l)) ing.push(l);
      else steps.push(l);
    }
    return { ing, steps };
  }
  function splitSteps(text) {
    return text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  }
  function compressImageFile(file, max = 1000, q = 0.6) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > max || h > max) { if (w >= h) { h = Math.round(h * max / w); w = max; } else { w = Math.round(w * max / h); h = max; } }
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', q));
        };
        img.onerror = reject; img.src = reader.result;
      };
      reader.onerror = reject; reader.readAsDataURL(file);
    });
  }

  // 示例菜谱（首次打开即有内容，演示图片/文字收藏）
  async function seedRecipes() {
    // 把内置菜谱库写入可编辑收藏（带 id 前缀，幂等）
    for (const r of (window.RECIPES || [])) {
      const id = 'rc-bi-' + r.id;
      if (state.recipes.some(x => x.id === id)) continue;
      await DB.putRecipe({
        id, name: r.name, ico: r.ico,
        needs: (r.needs || []).slice(),
        ingredients: (r.needs || []).slice(),
        steps: (r.steps || []).slice(),
        tags: [], images: [], builtin: true,
        createdAt: Date.now(), updatedAt: Date.now()
      });
    }
  }
  // ---------- 营养：记录 / 识别 / 分析 ----------
  let editingNutriId = null;
  let lastParseId = null; // 智能解析后已自动保存的记录 id，再次点「保存记录」时更新同一条，避免重复
  function kcalEstimate(foods) {
    let lo = 0, hi = 0;
    (foods || []).forEach(f => { const e = Nutri.DB[f]; if (e) { lo += e.k[0]; hi += e.k[1]; } });
    return [lo, hi];
  }
  // DRIs 维度分类顺序（营养参考标准作为底层逻辑，不直接呈现整表）
  const DRI_CATS = ['维生素', '矿物质', '宏量'];
  let nutriProgCat = '维生素'; // 今日营养进度当前展示的维度
  let nutriWarnCat = '维生素'; // 还该补充什么当前展示的维度
  function dayProgress(date) {
    const recs = state.nutrition.filter(r => r.date === date);
    const foods = [];
    recs.forEach(r => (r.foods || []).forEach(f => { if (foods.indexOf(f) < 0) foods.push(f); }));
    // 每个营养素 → 提供它的食物来源列表（去重，按显示名）
    const cover = {};
    foods.forEach(f => { const e = Nutri.DB[f]; if (e) e.n.forEach(nu => { (cover[nu] = cover[nu] || []).push(f); }); });
    Object.keys(cover).forEach(k => { cover[k] = Array.from(new Set(cover[k].map(foodLabel))); });
    return { foods, cover, recs };
  }
  // 从 DRIs 食物来源字符串里抽取简短食物建议（去括号、按中英文顿号/逗号切分、去重）
  function foodSuggestions(items) {
    const set = new Set();
    items.forEach(d => String(d.src || '').split(/[、；，,]/).forEach(s => {
      s = s.replace(/[（(][^）)]*[)）]/g, '').trim();
      if (s.length >= 2) set.add(s);
    }));
    return Array.from(set).slice(0, 14).join('、');
  }
  // 食材显示名（拆解来源时更自然，如「鸡翅」→「鸡肉」）
  function foodLabel(f) { return (Nutri.NAME && Nutri.NAME[f]) || f; }
  function renderNutrition() {
    const date = todayStr();
    const prog = dayProgress(date);
    const covered = prog.cover; // 营养素 key -> [来源显示名]
    // 维度总数 / 已覆盖数（基于 DRIs 全量，作为底层逻辑）
    const total = DRI_CATS.reduce((s, c) => s + (Nutri.DRIS[c] ? Nutri.DRIS[c].length : 0), 0);
    const coveredCount = DRI_CATS.reduce((s, c) => s + (Nutri.DRIS[c] || []).filter(d => covered[d.name]).length, 0);
    const pct = total ? Math.round(coveredCount / total * 100) : 0;
    $('nutri-score').textContent = prog.foods.length ? pct + ' 分' : '—';
    const label = !prog.foods.length ? '记录后评分' : pct >= 80 ? '营养均衡 👍' : pct >= 50 ? '基本够 😐' : '还需努力 💪';
    $('nutri-score-label').textContent = label;
    const kc = kcalEstimate(prog.foods);
    $('nutri-kcal').textContent = prog.foods.length ? '≈ ' + (kc[0] + kc[1]) / 2 + ' kcal' : '—';
    // 今日营养进度：按所选维度（维生素/矿物质/宏量）展示 DRIs 全部维度（已摄入高亮+来源，未摄入标「未摄入」）
    renderNutriProgress(covered);
    // 还该补充什么 = DRIs 全量 − 已摄入，按当前选中维度展示缺项 + 食物来源建议
    renderNutriWarn(covered);
  }
  // 仅渲染「还该补充什么」中当前选中维度（nutriWarnCat）的一项，配合分段切换
  function renderNutriWarn(covered) {
    const cat = nutriWarnCat;
    const items = (Nutri.DRIS[cat] || []).filter(d => !covered[d.name]);
    const wb = $('nutri-warn');
    if (!items.length) {
      wb.innerHTML = '<p class="empty">该维度今日已全覆盖，太棒了！🎉</p>';
      return;
    }
    const chips = items.map(d => {
      const ico = (Nutri.NUTRIENTS[d.name] && Nutri.NUTRIENTS[d.name].ico) || '💧';
      return `<span class="nutri-miss">${ico} ${escapeHtml(d.name)}</span>`;
    }).join('');
    const tip = foodSuggestions(items);
    wb.innerHTML = `<div class="dri-group"><div class="dri-group-h warn">${cat} · 还缺 ${items.length}</div><div class="chips">${chips}</div>${tip ? `<div class="dri-src-tip">建议多吃：${escapeHtml(tip)}</div>` : ''}</div>`;
  }
  // 仅渲染「今日营养进度」中当前选中维度（nutriProgCat）的一项，配合分段切换
  function renderNutriProgress(covered) {
    const cat = nutriProgCat;
    const items = (Nutri.DRIS[cat] || []);
    if (!items.length) { $('nutri-progress').innerHTML = '<p class="empty">该分类暂无数据</p>'; return; }
    const done = items.filter(d => covered[d.name]).length;
    const rows = items.map(d => {
      const ico = (Nutri.NUTRIENTS[d.name] && Nutri.NUTRIENTS[d.name].ico) || '•';
      const srcs = covered[d.name];
      if (srcs) {
        const src = srcs.map(s => `<span class="nutri-src-chip">${escapeHtml(s)}</span>`).join('');
        return `<div class="nutri-dim ok"><span class="nutri-ico">${ico}</span><span class="nutri-name">${escapeHtml(d.name)}</span><div class="nutri-src">来源：${src}</div></div>`;
      }
      return `<div class="nutri-dim miss"><span class="nutri-ico">${ico}</span><span class="nutri-name">${escapeHtml(d.name)}</span><div class="nutri-src">未摄入</div></div>`;
    }).join('');
    $('nutri-progress').innerHTML = `<div class="dri-group"><div class="dri-group-h">${cat} · 已摄入 ${done}/${items.length}</div>${rows}</div>`;
  }
  // 渲染「管理饮食记录」弹层（今日记录模块移出主页后，仍可在弹层删除/编辑）
  async function renderNutriManage() {
    const list = $('nutri-manage-list');
    if (!list) return;
    const recs = state.nutrition.slice().sort((a, b) => (b.date + (b.ts || 0)).localeCompare(a.date + (a.ts || 0)));
    if (!recs.length) { list.innerHTML = '<p class="empty">还没有任何饮食记录</p>'; return; }
    list.innerHTML = recs.map(r => {
      const mealIco = { 早餐: '🌅', 午餐: '☀️', 晚餐: '🌙', 加餐: '🍎' }[r.meal] || '🍽️';
      const time = r.ts ? new Date(r.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
      const nFoods = (r.foods || []).length;
      return `<div class="manage-row">
        <div class="manage-info"><b>${mealIco} ${escapeHtml(r.meal)}</b> <span class="muted">${escapeHtml(r.date)}${time ? ' ' + time : ''}</span><div class="muted small">${escapeHtml(r.raw)} · 含 ${nFoods} 类食材</div></div>
        <div class="manage-acts">
          <button data-nutri-edit="${r.id}" title="编辑">✏️</button>
          <button data-nutri-del2="${r.id}" title="删除">🗑️</button>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-nutri-edit]').forEach(b => b.addEventListener('click', () => {
      showSheet('sheet-nutri-manage', false);
      openNutriSheet(b.dataset.nutriEdit);
    }));
    list.querySelectorAll('[data-nutri-del2]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('删除这条饮食记录？')) return;
      await DB.deleteNutrition(b.dataset.nutriDel2);
      state.nutrition = await DB.getAllNutrition();
      renderNutriManage();
      renderNutrition();
    }));
  }
  function openNutriSheet(id, prefill) {
    editingNutriId = id;
    lastParseId = null;
    const f = $('nutri-form');
    f.reset(); f.dataset.photo = '';
    $('nutri-photo-preview').style.display = 'none';
    $('nutri-preview').innerHTML = '';
    $('nutri-date').value = todayStr();
    if (id) {
      const r = state.nutrition.find(x => x.id === id);
      if (!r) return;
      $('nutri-title').textContent = '编辑记录';
      $('nutri-meal').value = r.meal;
      $('nutri-date').value = r.date;
      $('nutri-text').value = r.raw;
      if (r.photo) { $('nutri-photo-preview').src = r.photo; $('nutri-photo-preview').style.display = 'block'; f.dataset.photo = r.photo; }
      $('nutri-del').style.display = 'block';
      previewNutriFoods();
    } else {
      $('nutri-title').textContent = '记录一餐';
      $('nutri-del').style.display = 'none';
      if (prefill) { $('nutri-text').value = prefill; previewNutriFoods(); }
    }
    showSheet('sheet-nutri', true);
  }
  // 智能解析：展示营养拆解，并立即把识别到的食材计入今日营养（无需再点「保存记录」）
  async function previewNutriFoods() {
    const text = $('nutri-text').value;
    const foods = Nutri.parseFoods(text);
    const box = $('nutri-preview');
    if (!foods.length) {
      box.innerHTML = text.trim() ? '<p class="tip">未识别到已知食材，没关系，也能保存；或把菜名写具体些（如：西兰花炒虾仁、猪肝菠菜汤）。</p>' : '';
      lastParseId = null;
      return;
    }
    // 按营养素分组，展示「谁提供了什么」（覆盖 DB 中的全部营养素，对应 DRIs 2023 食物来源）
    const byNutri = {};
    foods.forEach(f => { const e = Nutri.DB[f]; if (e) e.n.forEach(nu => { (byNutri[nu] = byNutri[nu] || []).push(f); }); });
    Object.keys(byNutri).forEach(k => { byNutri[k] = Array.from(new Set(byNutri[k].map(foodLabel))); });
    // 排序：按分类（宏量→维生素→矿物质），同分类按营养素名
    const keys = Object.keys(byNutri).sort((a, b) => {
      const ca = (Nutri.NUTRIENTS[a] && Nutri.NUTRIENTS[a].cat) || '';
      const cb = (Nutri.NUTRIENTS[b] && Nutri.NUTRIENTS[b].cat) || '';
      if (ca !== cb) return ca.localeCompare(cb);
      return a.localeCompare(b);
    });
    const lines = keys.map(k => {
      const ico = (Nutri.NUTRIENTS[k] && Nutri.NUTRIENTS[k].ico) || '•';
      return `<div class="nutri-src"><b>${ico} ${k}</b> ← ${byNutri[k].map(s => `<span class="nutri-src-chip">${escapeHtml(s)}</span>`).join('')}</div>`;
    });
    box.innerHTML = '<p class="tip">已识别 ' + foods.length + ' 种食材，营养拆解（依据《DRIs 2023》食物来源）：</p>' + lines.join('');
    // 解析即记录：立即计入今日营养
    const meal = $('nutri-meal').value;
    const date = $('nutri-date').value || todayStr();
    const id = editingNutriId || lastParseId || ('nt-' + Date.now() + Math.random().toString(36).slice(2, 6));
    const rec = {
      id, date, ts: Date.now(), meal, raw: text.trim() || ('智能识别 · ' + foods.length + ' 种食材'),
      foods, kcal: kcalEstimate(foods), photo: $('nutri-form').dataset.photo || ''
    };
    await DB.putNutrition(rec);
    state.nutrition = await DB.getAllNutrition();
    lastParseId = id;
    renderNutrition();
    toast('已计入今日营养 ✓');
  }
  async function onNutriSubmit(e) {
    e.preventDefault();
    const raw = $('nutri-text').value.trim();
    if (!raw) { toast('请填写吃了什么'); return; }
    const meal = $('nutri-meal').value;
    const date = $('nutri-date').value || todayStr();
    const foods = Nutri.parseFoods(raw);
    const rec = {
      id: editingNutriId || lastParseId || ('nt-' + Date.now() + Math.random().toString(36).slice(2, 6)),
      date, ts: Date.now(), meal, raw, foods,
      kcal: foods.length ? kcalEstimate(foods) : [0, 0],
      photo: $('nutri-form').dataset.photo || ''
    };
    await DB.putNutrition(rec);
    state.nutrition = await DB.getAllNutrition();
    lastParseId = null;
    showSheet('sheet-nutri', false);
    toast('已记录');
    renderNutrition();
  }
  async function onNutriPhoto(e) {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = await compressImageFile(file);
      $('nutri-photo-preview').src = data;
      $('nutri-photo-preview').style.display = 'block';
      $('nutri-form').dataset.photo = data;
    } catch (_) { toast('图片处理失败'); }
    e.target.value = '';
  }
  function nutriVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('当前浏览器不支持语音，请手动输入'); return; }
    const r = new SR(); r.lang = 'zh-CN'; r.interimResults = false;
    toast('请说吃了什么…（如「西兰花炒虾仁」）');
    r.onresult = (e) => { const t = e.results[0][0].transcript; $('nutri-text').value = t; previewNutriFoods(); toast('已识别：' + t); };
    r.onerror = () => toast('语音识别失败，请手动输入');
    r.start();
  }
  async function scanNutri() {
    if (!('BarcodeDetector' in window)) { toast('当前浏览器不支持扫码，请手动输入食物名'); return; }
    let bd; try { bd = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'data_matrix'] }); } catch (e) { bd = new BarcodeDetector(); }
    let stream = null, raf = null, stopped = false;
    const overlay = document.createElement('div');
    overlay.className = 'scan-overlay';
    overlay.innerHTML = '<div class="scan-box"><video autoplay playsinline></video><p>将条码对准取景框…</p><button class="x" style="position:absolute;top:8px;right:8px;font-size:22px;background:none;border:none;color:#fff">✕</button></div>';
    document.body.appendChild(overlay);
    const video = overlay.querySelector('video');
    function stop() { stopped = true; if (raf) cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); overlay.remove(); }
    overlay.querySelector('.x').addEventListener('click', stop);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; await video.play();
      const loop = async () => {
        if (stopped) return;
        try {
          const codes = await bd.detect(video);
          if (codes.length) {
            const v = codes[0].rawValue; stop();
            const cur = $('nutri-text').value.trim();
            $('nutri-text').value = (cur ? cur + ' ' : '') + v;
            previewNutriFoods();
            toast('已识别条码：' + v + '（包装食品请补充名称，如：某某饼干）');
            return;
          }
        } catch (e) {}
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) { stop(); toast('无法打开相机，请手动输入'); }
  }
  async function deleteNutri() {
    if (!editingNutriId) return;
    if (!confirm('删除这条饮食记录？')) return;
    await DB.deleteNutrition(editingNutriId);
    state.nutrition = await DB.getAllNutrition();
    showSheet('sheet-nutri', false);
    toast('已删除');
    renderNutrition();
  }
  // 营养目标（用于「我的」页展示粗略热量建议）
  function renderNutriProfile() {
    const p = state.nutritionProfile;
    const bmr = p.gender === '男'
      ? 10 * p.weight + 6.25 * p.height - 5 * p.age + 5
      : 10 * p.weight + 6.25 * p.height - 5 * p.age - 161;
    let kcal = Math.round(bmr * 1.375);
    if (p.goal === '减脂') kcal -= 400;
    if (p.goal === '增肌') kcal += 300;
    const tip = $('nutri-target-tip');
    if (tip) tip.textContent = `按${p.gender}、${p.age}岁、${p.height}cm、${p.weight}kg、目标「${p.goal}」，建议每日约 ${kcal} kcal（粗略估算）。营养进度按「不同食物种类次数」评估，无需精确称重。`;
  }
  async function saveNutriProfile() {
    const p = state.nutritionProfile;
    p.gender = $('nutri-gender').value;
    p.age = Number($('nutri-age').value) || 30;
    p.height = Number($('nutri-height').value) || 165;
    p.weight = Number($('nutri-weight').value) || 55;
    p.goal = $('nutri-goal').value;
    await saveSetting('nutritionProfile', p);
    renderNutriProfile();
    if ($('view-nutrition').classList.contains('active')) renderNutrition();
  }
  async function seedNutrition() {
    const t = todayStr();
    const recs = [
      { meal: '早餐', raw: '一杯牛奶 + 一个煮鸡蛋', foods: Nutri.parseFoods('牛奶 鸡蛋') },
      { meal: '午餐', raw: '西兰花炒虾仁、一碗米饭', foods: Nutri.parseFoods('西兰花炒虾仁 米饭') }
    ];
    for (const r of recs) {
      if (state.nutrition.some(x => x.date === t && x.raw === r.raw)) continue;
      await DB.putNutrition({ id: 'nt-seed-' + Date.now() + Math.random().toString(36).slice(2, 5), date: t, ts: Date.now(), meal: r.meal, raw: r.raw, foods: r.foods, kcal: kcalEstimate(r.foods), photo: '' });
    }
  }

  // ---------- 导出到期日到日历(.ics) ----------
  function exportCalendar() {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//物品管家//ZH', 'CALSCALE:GREGORIAN'];
    let n = 0;
    state.items.forEach(it => {
      const s = statusOf(it);
      const d = s.eff; if (!d) return;
      const ds = d.replace(/-/g, '');
      const next = addDays(d, 1).replace(/-/g, '');
      lines.push('BEGIN:VEVENT', 'UID:' + it.id + '@item-keeper',
        'DTSTART;VALUE=DATE:' + ds, 'DTEND;VALUE=DATE:' + next,
        'SUMMARY:' + (s.expired ? '已过期' : '即将到期') + '：' + it.name,
        'DESCRIPTION:' + '存放：' + (it.location || '未定位') + '\\n分类：' + it.category,
        'END:VEVENT');
      n++;
    });
    lines.push('END:VCALENDAR');
    if (!n) { toast('没有带到期日的物品'); return; }
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '物品管家-到期日.ics'; a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出 ' + n + ' 条到期日到日历文件');
  }

  // ---------- 渲染：提醒 ----------
  async function renderReminders() {
    const expired = [], expiring = [], low = [];
    state.items.forEach(it => {
      const s = statusOf(it);
      if (s.expired) expired.push(it);
      else if (s.expiring) expiring.push(it);
      else if (s.stockLow) low.push(it);
    });
    expired.sort((a, b) => daysLeft(statusOf(a).eff) - daysLeft(statusOf(b).eff));
    const sec = (title, cls, arr, action) => {
      if (!arr.length) return '';
      return `<div class="rem-group"><h3 class="${cls}">${title}（${arr.length}）</h3>` +
        arr.map(it => {
          const s = statusOf(it);
          const info = s.eff ? `${fmtDate(s.eff)} · ${s.expiryDays >= 0 ? '剩' + s.expiryDays + '天' : '已过' + Math.abs(s.expiryDays) + '天'}` : '';
          return `<div class="rem-item ${cls}"><div><b>${escapeHtml(it.name)}</b><br><small>${KB.categoryById(it.category).icon}${it.category} · ${escapeHtml(it.location || '')} · ${info}</small></div>
            <button class="mini" data-buy="${it.id}">🛒待购</button></div>`;
        }).join('') + '</div>';
    };
    const html = sec('🔴 已过期', 'red', expired) + sec('🟠 临近过期', 'orange', expiring) + sec('🟡 库存不足', 'yellow', low);
    $('reminders-list').innerHTML = html || '<p class="empty">暂无提醒，棒极了！</p>';
    $('reminders-list').querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => addToShopping(b.dataset.buy)));
  }

  async function addToShopping(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return;
    const exists = state.shopping.find(s => s.name === it.name);
    if (exists) { exists.qty = (Number(exists.qty) || 1) + 1; await DB.putShopping(exists); }
    else { await DB.putShopping({ id: 'sh-' + Date.now(), name: it.name, qty: 1, cat: it.category, done: false }); }
    state.shopping = await DB.getAllShopping();
    toast('已加入待购清单');
  }

  // ---------- 渲染：统计 ----------
  function renderStats() {
    const byCat = {};
    state.items.forEach(it => { byCat[it.category] = (byCat[it.category] || 0) + 1; });
    const segs = KB.categories.filter(c => byCat[c.id]).map(c => ({ label: c.id, value: byCat[c.id], color: catColor(c.id) }));
    drawDoughnut($('chart-cat2'), segs);

    // 浪费趋势（最近6个月）
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      months.push(d.toISOString().slice(0, 7));
    }
    const wasteByM = months.map(m => state.events.filter(e => e.type === 'waste' && (e.date || '').slice(0, 7) === m)
      .reduce((s, e) => s + (Number(e.value) || 0), 0));
    drawBar($('chart-waste'), months.map((m, i) => ({ label: m.slice(2), value: wasteByM[i] })));

    const totalWaste = state.events.filter(e => e.type === 'waste').reduce((s, e) => s + (Number(e.value) || 0), 0);
    $('stats-waste-total').textContent = '¥' + totalWaste.toFixed(2);
    $('stats-waste-count').textContent = state.events.filter(e => e.type === 'waste').length;

    // 浪费分类
    const byCatWaste = {};
    state.events.filter(e => e.type === 'waste').forEach(e => { byCatWaste[e.category] = (byCatWaste[e.category] || 0) + (Number(e.value) || 0); });
    const wasteSegs = Object.keys(byCatWaste).map(c => ({ label: c, value: byCatWaste[c], color: catColor(c) }));
    drawDoughnut($('chart-waste-cat'), wasteSegs);

    // 待购清单
    renderShopping();
  }

  function renderShopping() {
    const box = $('shopping-list');
    if (!state.shopping.length) { box.innerHTML = '<p class="empty">待购清单为空</p>'; $('shopping-clear').style.display = 'none'; return; }
    $('shopping-clear').style.display = 'block';
    box.innerHTML = state.shopping.map(s => `<div class="shop-item ${s.done ? 'done' : ''}">
      <label><input type="checkbox" data-sh="${s.id}" ${s.done ? 'checked' : ''}> <span>${escapeHtml(s.name)} ×${s.qty}</span></label>
      <button class="mini del" data-shdel="${s.id}">✕</button></div>`).join('');
    box.querySelectorAll('[data-sh]').forEach(c => c.addEventListener('change', async () => {
      const s = state.shopping.find(x => x.id === c.dataset.sh); s.done = c.checked; await DB.putShopping(s); renderShopping();
    }));
    box.querySelectorAll('[data-shdel]').forEach(b => b.addEventListener('click', async () => {
      await DB.deleteShopping(b.dataset.shdel); state.shopping = await DB.getAllShopping(); renderShopping();
    }));
    $('shopping-clear').onclick = async () => { if (confirm('清空待购清单？')) { await DB.clearShopping(); state.shopping = []; renderShopping(); } };
  }

  // ---------- 渲染：我的/设置 ----------
  function renderMe() {
    $('set-advance').value = state.settings.advanceDays;
    $('set-theme').value = state.settings.theme;
    $('set-notify').checked = state.settings.notify;
    $('set-autocal').checked = !!state.settings.autoCal;
    $('set-proxy').value = state.settings.recipeProxy || '';
    $('set-member').value = state.settings.member;
    $('members-list').innerHTML = state.settings.members.map(m => `<span class="chip">${m}</span>`).join('') || '<span class="empty">暂无</span>';
    $('me-count').textContent = state.items.length + ' 件物品';
    // 营养目标
    $('nutri-gender').value = state.nutritionProfile.gender;
    $('nutri-age').value = state.nutritionProfile.age;
    $('nutri-height').value = state.nutritionProfile.height;
    $('nutri-weight').value = state.nutritionProfile.weight;
    $('nutri-goal').value = state.nutritionProfile.goal;
    renderNutriProfile();
  }
  async function addMember() {
    const name = prompt('添加家庭成员/使用者名称：');
    if (!name) return;
    const n = name.trim();
    if (!n || state.settings.members.includes(n)) return;
    state.settings.members.push(n);
    await saveSetting('members', state.settings.members);
    buildMemberSelect(); buildMemberFilter(); renderMe();
    toast('已添加 ' + n);
  }

  // ---------- 通知 ----------
  function askNotify() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission();
  }
  async function maybeNotify() {
    if (!state.settings.notify) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    let expired = 0, expiring = 0, low = 0;
    state.items.forEach(it => { const s = statusOf(it); if (s.expired) expired++; else if (s.expiring) expiring++; if (s.stockLow) low++; });
    if (!expired && !expiring && !low) return;
    const body = `已过期 ${expired} · 临期 ${expiring} · 库存不足 ${low}`;
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification('物品管家 · 今日提醒', { body, icon: './icon.svg', tag: 'ik-daily', renotify: true });
    } catch (e) {
      new Notification('物品管家 · 今日提醒', { body });
    }
  }
  function testNotify() {
    if (!('Notification' in window)) { toast('浏览器不支持通知'); return; }
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => { if (p === 'granted') fireTest(); else toast('通知权限被拒绝'); });
    } else if (Notification.permission === 'granted') fireTest();
    else toast('通知权限被拒绝，请在浏览器设置中开启');
  }
  function fireTest() {
    const reg = navigator.serviceWorker.ready;
    reg.then(r => r.showNotification('物品管家 · 测试通知', { body: '这是一条测试提醒，到期/低库存会自动推送', icon: './icon.svg' }))
      .catch(() => new Notification('物品管家 · 测试通知', { body: '测试' }));
  }

  // ---------- 导出/导入/清空 ----------
  function exportData() {
    const data = { app: 'item-keeper', version: 1, exportedAt: new Date().toISOString(),
      items: state.items, shopping: state.shopping, events: state.events, recipes: state.recipes, nutrition: state.nutrition, settings: state.settings };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '物品管家备份-' + todayStr() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('备份已导出');
  }
  function importData(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        if (!confirm('导入将覆盖当前同名物品，确定继续？')) return;
        if (Array.isArray(data.items)) for (const it of data.items) await DB.putItem(it);
        if (Array.isArray(data.shopping)) for (const s of data.shopping) await DB.putShopping(s);
        if (Array.isArray(data.events)) for (const ev of data.events) await DB.putEvent(ev);
        if (Array.isArray(data.recipes)) for (const rc of data.recipes) await DB.putRecipe(rc);
        if (Array.isArray(data.nutrition)) for (const n of data.nutrition) await DB.putNutrition(n);
        if (data.settings) { Object.assign(state.settings, data.settings); await saveSetting('advanceDays', state.settings.advanceDays); await saveSetting('theme', state.settings.theme); await saveSetting('members', state.settings.members); applyTheme(); buildMemberSelect(); buildMemberFilter(); }
        if (data.nutritionProfile) { Object.assign(state.nutritionProfile, data.nutritionProfile); await saveSetting('nutritionProfile', state.nutritionProfile); }
        state.items = await DB.getAllItems(); markCalDirty();
        state.shopping = await DB.getAllShopping();
        state.events = await DB.getAllEvents();
        state.recipes = await DB.getAllRecipes();
        state.nutrition = await DB.getAllNutrition();
        toast('导入完成');
        renderItems();
      } catch (err) { toast('导入失败：文件格式错误'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  }
  async function clearAll() {
    if (!confirm('确定清空全部物品、待购与统计？此操作不可恢复（请先导出备份）')) return;
    await DB.clearItems(); await DB.clearShopping(); await DB.clearEvents(); await DB.clearNutrition();
    state.items = []; state.shopping = []; state.events = []; state.nutrition = [];
    toast('已清空'); renderItems(); renderHome();
  }

  // ---------- 主题 ----------
  function applyTheme() {
    document.body.classList.toggle('dark', state.settings.theme === 'dark');
  }

  // ---------- Canvas 图表 ----------
  function catColor(cat) {
    const map = { '零食': '#f4a259', '饮料': '#5b8e7d', '蔬菜肉类': '#e07a5f', '水果': '#ef8354', '粮油': '#c9a227',
      '调料': '#9c6644', '蛋奶': '#f2cc8f', '冷冻食品': '#6096ba', '日用品': '#577590', '母婴': '#c98bb9',
      '医药': '#e63946', '美妆': '#d670a3', '其他': '#8d99ae' };
    return map[cat] || '#8d99ae';
  }
  function setupCanvas(c) {
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 280, h = c.clientHeight || 160;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }
  function drawDoughnut(c, segs) {
    if (!c) return;
    const { ctx, w, h } = setupCanvas(c);
    ctx.clearRect(0, 0, w, h);
    const total = segs.reduce((s, x) => s + x.value, 0);
    if (!total) { ctx.fillStyle = '#999'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('暂无数据', w / 2, h / 2); return; }
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 6, ir = r * 0.6;
    let a = -Math.PI / 2;
    segs.forEach(s => {
      const ang = s.value / total * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a + ang); ctx.closePath();
      ctx.fillStyle = s.color; ctx.fill();
      a += ang;
    });
    ctx.beginPath(); ctx.arc(cx, cy, ir, 0, Math.PI * 2); ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--card').trim() || '#fff'; ctx.fill();
    ctx.fillStyle = '#333'; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(total, cx, cy - 6); ctx.font = '11px sans-serif'; ctx.fillStyle = '#888'; ctx.fillText('件', cx, cy + 10);
    // 图例
    let ly = 8; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '11px sans-serif';
    segs.forEach(s => { ctx.fillStyle = s.color; ctx.fillRect(4, ly, 9, 9); ctx.fillStyle = '#555'; ctx.fillText(`${s.label} ${s.value}`, 17, ly); ly += 15; });
  }
  function drawBar(c, bars) {
    if (!c) return;
    const { ctx, w, h } = setupCanvas(c);
    ctx.clearRect(0, 0, w, h);
    if (!bars.length || bars.every(b => !b.value)) { ctx.fillStyle = '#999'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('暂无数据', w / 2, h / 2); return; }
    const max = Math.max(...bars.map(b => b.value), 1);
    const pad = 24, bw = (w - pad) / bars.length * 0.6, gap = (w - pad) / bars.length;
    bars.forEach((b, i) => {
      const bh = b.value / max * (h - 36);
      const x = pad / 2 + i * gap + (gap - bw) / 2, y = h - 22 - bh;
      ctx.fillStyle = '#e07a5f'; ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = '#333'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('¥' + b.value.toFixed(0), x + bw / 2, y - 4);
      ctx.fillStyle = '#888'; ctx.fillText(b.label, x + bw / 2, y + bh + 14);
    });
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- 示例数据与日历同步辅助 ----------
  async function seedSample() {
    const t = todayStr();
    const seeds = [
      { name: '纯牛奶', category: '蛋奶', location: '冰箱-冷藏室', quantity: 1, unit: '盒', openDate: addDays(t, -2), shelfAfterOpen: 5, price: 8, note: '开封后尽快喝' },
      { name: '鸡蛋', category: '蛋奶', location: '冰箱-冷藏室', quantity: 10, unit: '个', expiryDate: addDays(t, 2), price: 15 },
      { name: '西红柿', category: '蔬菜肉类', location: '冰箱-冷藏室', quantity: 4, unit: '个', expiryDate: addDays(t, 1), price: 5 },
      { name: '土豆', category: '蔬菜肉类', location: '阳台储物', quantity: 2, unit: '斤', expiryDate: addDays(t, 20), price: 4 },
      { name: '生抽酱油', category: '调料', location: '厨房橱柜', quantity: 1, unit: '瓶', expiryDate: addDays(t, -3), price: 12 },
      { name: '洗衣液', category: '日用品', location: '卫生间', quantity: 1, unit: '瓶', lowThreshold: 1, price: 39 },
      { name: '抽纸', category: '日用品', location: '客厅储物', quantity: 1, unit: '提', lowThreshold: 2, price: 25 },
      { name: '饼干', category: '零食', location: '零食柜', quantity: 2, unit: '袋', expiryDate: addDays(t, 10), price: 9 },
      { name: '苹果', category: '水果', location: '果篮', quantity: 5, unit: '个', expiryDate: addDays(t, 5), price: 10 },
      { name: '矿泉水', category: '饮料', location: '储物间', quantity: 1, unit: '箱', lowThreshold: 1, price: 30 }
    ];
    for (const o of seeds) {
      if (state.items.some(x => x.name === o.name && x.category === o.category)) continue;
      await DB.putItem(makeItem(Object.assign({ member: state.settings.member }, o)));
    }
  }
  async function loadSample() {
    await seedSample();
    state.items = await DB.getAllItems();
    toast('已加载示例数据');
    renderHome(); renderItems();
  }
  function markCalDirty() { if (state.settings.autoCal) calDirty = true; }

  // ---------- 启动 ----------
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
