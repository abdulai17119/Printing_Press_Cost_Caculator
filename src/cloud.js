(function () {
  'use strict';
  const E = window.Engine, Seed = window.Seed, U = E.util;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = U.clone, find = U.find, num = U.num, isBlank = U.isBlank;
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const setPath = (o, p, v) => { const ks = p.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]]; a[ks[ks.length - 1]] = v; };
  const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });

  /* ================= Supabase connection (public by design; RLS is what protects the data) ================= */
  const SUPA_URL = 'https://rikkaenjbianbryqlfij.supabase.co';
  const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpa2thZW5qYmlhbmJyeXFsZmlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5NjEzMTEsImV4cCI6MjEwNTUzNzMxMX0.12vPu6cTWjLipN7BQTbXsVvKYVuvKXt8IzyvWLSL-ZE';
  const sb = window.supabase.createClient(SUPA_URL, SUPA_ANON_KEY);

  /* ================= field mapping: snake_case DB rows <-> the app's camelCase shape ================= */
  const MAPS = {
    materials: [['id'], ['name'], ['category'], ['gsm_thickness', 'gsm'], ['sheet_width_mm', 'sheetW'], ['sheet_height_mm', 'sheetH'], ['roll_width_mm', 'rollWidth'], ['roll_length_m', 'rollLength'], ['unit'], ['pack_size', 'packSize'], ['purchase_cost', 'purchaseCost'], ['min_charge', 'minCharge'], ['supplier'], ['notes'], ['is_demo', 'demo']],
    machines: [['id'], ['name'], ['machine_type', 'type'], ['hourly_rate', 'hourlyRate'], ['setup_rate', 'setupRate'], ['speed'], ['color_units', 'colorUnits'], ['click_color', 'clickColor'], ['click_bw', 'clickBW'], ['cost_per_impression', 'costPerImpression'], ['cost_per_sqm', 'costPerSqm'], ['notes'], ['is_demo', 'demo']],
    finishing: [['id'], ['name'], ['pricing_method', 'method'], ['rate'], ['setup_cost', 'setupCost'], ['min_charge', 'minCharge'], ['notes'], ['is_demo', 'demo']],
    labor: [['id'], ['category'], ['hourly_cost', 'hourlyCost'], ['notes'], ['is_demo', 'demo']]
  };
  const TABLE_NAME = { materials: 'materials', machines: 'machines', finishing: 'finishing_operations', labor: 'labor_rates' };
  function fromRow(key, row) { const o = {}; MAPS[key].forEach(([db, js]) => { let v = row[db]; if (v === null) v = ''; o[js || db] = v; }); return o; }
  function toRow(key, obj) { const o = {}; MAPS[key].forEach(([db, js]) => { let v = obj[js || db]; if (v === '' || v === undefined) v = null; o[db] = v; }); return o; }
  const eqIgnoring = (a, b, ignore) => { const strip = (o) => { const c = clone(o); (ignore || []).forEach((k) => delete c[k]); return c; }; return JSON.stringify(strip(a)) === JSON.stringify(strip(b)); };

  /* ================= state ================= */
  let DB = null, lastSynced = null, session = null, profile = null;
  const state = { view: 'calc', job: null, editingId: null, editingUuid: null, savedTotal: null, cmp: '500, 1000, 2000, 5000', q: {}, result: null, needsOnly: false, auth: { mode: 'signin', busy: false, error: '', notice: '' } };
  const canEdit = () => profile && profile.role === 'admin';
  const cur = () => (DB && DB.settings.currency) || 'AED';
  const money = (x) => `${cur()} ${U.m(x)}`;
  const perPieceFmt = (x) => {
    let d = Math.max(2, Math.min(6, Number(DB.settings.unitDecimals) || 3));
    if (x > 0 && x < 0.1) d = Math.max(d, 4);
    return `${cur()} ${x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  };

  /* ================= small UI helpers ================= */
  let toastTimer;
  function toast(msg, kind) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.className = 'show' + (kind === 'warn' ? ' warn' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 4200); }
  function openModal(html) { const m = $('#modal'); m.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">${html}</div>`; m.classList.add('open'); const f = $('input,select,textarea,button', m); if (f) f.focus(); }
  function closeModal() { const m = $('#modal'); m.classList.remove('open'); m.innerHTML = ''; modalCtx = null; }
  let modalCtx = null;
  function saveTextFile(filename, data) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'text/plain' })); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  }
  const demoTag = (r) => (r.demo ? '<span class="demo">DEMO</span>' : '');
  const matNeeds = (r) => { const sheetOk = num(r.sheetW) > 0 && num(r.sheetH) > 0, rollOk = num(r.rollWidth) > 0; return { price: isBlank(r.purchaseCost), size: (r.unit === 'sheet' || r.unit === 'pack') ? !sheetOk : !(rollOk || sheetOk) }; };
  const matReady = (r) => { const n = matNeeds(r); return !n.price && !n.size; };
  const opt = (v, label, sel) => `<option value="${esc(v)}"${String(sel) === String(v) ? ' selected' : ''}>${esc(label)}</option>`;

  /* ================= Supabase: load everything after sign-in ================= */
  function friendlyDbError(e) {
    if (!e) return 'Unknown error.';
    if (/permission denied|row-level security/i.test(e.message || '')) return "You don't have permission for that. Ask an admin.";
    if (/JWT|network|fetch/i.test(e.message || '')) return 'Could not reach the database. Check your connection and try again.';
    return e.message || String(e);
  }
  async function hydrate() {
    const [mats, machs, fins, labs, settingsRow, wasteRows, calcRows, profRow] = await Promise.all([
      sb.from('materials').select('*'), sb.from('machines').select('*'), sb.from('finishing_operations').select('*'), sb.from('labor_rates').select('*'),
      sb.from('settings').select('*').eq('key', 'app').maybeSingle(), sb.from('waste_defaults').select('*'),
      sb.from('calculations').select('id,display_id,created_at,job_name,product_type,quantity,total_cost,cost_per_piece,created_by,job_snapshot,full_result').order('created_at', { ascending: false }),
      sb.from('profiles').select('*').eq('id', session.user.id).single()
    ]);
    const firstErr = [mats, machs, fins, labs, settingsRow, wasteRows, calcRows, profRow].find((r) => r.error);
    if (firstErr) throw new Error(friendlyDbError(firstErr.error));
    profile = { role: profRow.data.role, displayName: profRow.data.display_name };
    const wasteDefaults = {}; wasteRows.data.forEach((w) => { wasteDefaults[w.method] = { pct: w.waste_pct, setup: w.setup_waste, min: w.min_waste }; });
    const appSettings = (settingsRow.data && settingsRow.data.value) || E.defaultSettings();
    DB = {
      materials: mats.data.map((r) => fromRow('materials', r)).sort((a, b) => (a.demo ? 1 : 0) - (b.demo ? 1 : 0) || a.name.localeCompare(b.name)),
      machines: machs.data.map((r) => fromRow('machines', r)).sort((a, b) => (a.demo ? 1 : 0) - (b.demo ? 1 : 0) || a.name.localeCompare(b.name)),
      finishing: fins.data.map((r) => fromRow('finishing', r)).sort((a, b) => (a.demo ? 1 : 0) - (b.demo ? 1 : 0) || a.name.localeCompare(b.name)),
      labor: labs.data.map((r) => fromRow('labor', r)).sort((a, b) => (a.demo ? 1 : 0) - (b.demo ? 1 : 0) || a.category.localeCompare(b.category)),
      settings: Object.assign({}, appSettings, { waste: wasteDefaults }),
      calcs: calcRows.data.map((c) => ({ id: c.display_id, _uuid: c.id, date: c.created_at, name: c.job_name, product: c.product_type, quantity: c.quantity, total: c.total_cost, perPiece: c.cost_per_piece, createdBy: c.created_by, job: c.job_snapshot, full: c.full_result }))
    };
    lastSynced = { materials: clone(DB.materials), machines: clone(DB.machines), finishing: clone(DB.finishing), labor: clone(DB.labor), app: clone(appSettings), waste: clone(wasteDefaults) };
  }

  /* ================= generic write-through sync for the four rate tables + settings ================= */
  let syncChain = Promise.resolve();
  function save() { syncChain = syncChain.then(doSync, doSync); }
  async function doSync() {
    try {
      for (const key of Object.keys(MAPS)) await syncTable(key);
      await syncSettingsAndWaste();
    } catch (e) {
      toast('Could not save that to the shared database: ' + friendlyDbError(e) + ' Reload to see what is actually saved.', 'warn');
    }
  }
  async function syncTable(key) {
    const table = TABLE_NAME[key], before = lastSynced[key], after = DB[key];
    const beforeById = {}; before.forEach((r) => { beforeById[r.id] = r; });
    const afterIds = new Set(after.map((r) => r.id));
    const toDelete = before.filter((r) => !afterIds.has(r.id));
    const toUpsert = after.filter((r) => !beforeById[r.id] || !eqIgnoring(r, beforeById[r.id], []));
    for (const r of toDelete) { const { error } = await sb.from(table).delete().eq('id', r.id); if (error) throw error; }
    if (toUpsert.length) { const { error } = await sb.from(table).upsert(toUpsert.map((r) => toRow(key, r))); if (error) throw error; }
    lastSynced[key] = clone(after);
  }
  async function syncSettingsAndWaste() {
    const app = { currency: DB.settings.currency, unitDecimals: DB.settings.unitDecimals, printing: DB.settings.printing, minimums: DB.settings.minimums };
    if (!eqIgnoring(app, lastSynced.app, [])) { const { error } = await sb.from('settings').update({ value: app }).eq('key', 'app'); if (error) throw error; lastSynced.app = clone(app); }
    for (const method of Object.keys(DB.settings.waste)) {
      const w = DB.settings.waste[method];
      if (!eqIgnoring(w, lastSynced.waste[method], [])) {
        const { error } = await sb.from('waste_defaults').update({ waste_pct: w.pct, setup_waste: w.setup, min_waste: w.min }).eq('method', method);
        if (error) throw error; lastSynced.waste[method] = clone(w);
      }
    }
  }

  /* ================= job helpers ================= */
  const PRODUCT_MODE = { Sticker: 'sticker', Label: 'sticker', Banner: 'large_format', 'Roll-up': 'large_format', Poster: 'large_format', 'Large Format': 'large_format' };
  function autoPick(j) {
    const okTypes = E.MODE_MACHINES[j.mode];
    const pref = j.mode === 'sticker' ? ['large_format', 'digital', 'uv'] : okTypes;
    if (!DB.machines.find((m) => m.id === j.machineId && okTypes.includes(m.type))) {
      let pick = null; pref.some((t) => (pick = DB.machines.find((m) => m.type === t))); j.machineId = pick ? pick.id : '';
    }
    const need = j.mode === 'offset' || j.mode === 'digital' ? 'sheet' : null;
    const c = find(DB.materials, j.materialId);
    if (!c || (need && E.materialMode(c) !== 'sheet')) {
      const okMode = (m) => (need ? E.materialMode(m) === 'sheet' : E.materialMode(m) === 'roll');
      const p = DB.materials.find((m) => matReady(m) && okMode(m)) || DB.materials.find(okMode) || DB.materials[0];
      j.materialId = p ? p.id : '';
    }
    return j;
  }
  function freshJob() { return autoPick(E.newJob({ mode: 'digital', name: '' })); }
  // Seed.testJobs() references the LOCAL demo ids from seed.js (fin_matte_lam, lab_press, ...).
  // Your Supabase rows have their own generated ids, so any sub-row that doesn't match a real
  // row in this database is cleared rather than left pointing at something that doesn't exist.
  function sanitizeTestJob(j) {
    j = autoPick(j);
    let cleared = 0;
    const clear = (row, key) => { if (row[key] && !find(DB[TABLE_KEY[key]], row[key])) { row[key] = ''; cleared++; } };
    const TABLE_KEY = { finId: 'finishing', laborId: 'labor', materialId: 'materials' };
    (j.finishing || []).forEach((r) => clear(r, 'finId'));
    (j.labor || []).forEach((r) => clear(r, 'laborId'));
    (j.addMaterials || []).forEach((r) => clear(r, 'materialId'));
    ['lamFinId', 'cutFinId'].forEach((k) => { if (j[k] && !find(DB.finishing, j[k])) { j[k] = ''; cleared++; } });
    return { job: j, cleared };
  }
  const isBook = () => E.BOOK.includes(state.job.product);

  /* ================= form field builders (calculator) ================= */
  const val = (k) => { const v = getPath(state.job, k); return v == null ? '' : v; };
  const F = {
    num: (k, label, o) => { o = o || {}; return `<label class="f${o.cls ? ' ' + o.cls : ''}"><span>${label}</span><input data-k="${k}" type="number" step="any" inputmode="decimal" value="${esc(val(k))}" placeholder="${esc(o.ph == null ? '' : o.ph)}"><i class="err" data-err="${k}"></i>${o.hint ? `<small>${o.hint}</small>` : ''}</label>`; },
    txt: (k, label, o) => { o = o || {}; return `<label class="f${o.cls ? ' ' + o.cls : ''}"><span>${label}</span><input data-k="${k}" type="text" value="${esc(val(k))}" placeholder="${esc(o.ph || '')}"><i class="err" data-err="${k}"></i></label>`; },
    sel: (k, label, options, o) => { o = o || {}; return `<label class="f${o.cls ? ' ' + o.cls : ''}"><span>${label}</span><select data-k="${k}"${o.r ? ' data-r="1"' : ''}${o.dis ? ' disabled' : ''}>${options.map((x) => opt(x[0], x[1], val(k))).join('')}</select><i class="err" data-err="${k}"></i>${o.hint ? `<small>${o.hint}</small>` : ''}</label>`; },
    chk: (k, label) => `<label class="chk"><input type="checkbox" data-k="${k}"${getPath(state.job, k) ? ' checked' : ''}> ${label}</label>`
  };
  const matLabel = (m) => { const n = matNeeds(m); return m.name + (n.price ? '  — needs price' : n.size ? '  — needs size' : ''); };

  /* ================= views: New calculation ================= */
  function head(title, sub, actions) { return `<header class="pagehead"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div><div class="actions">${actions || ''}</div></header>`; }

  function viewCalc() {
    const j = state.job;
    const mat = find(DB.materials, j.materialId), mach = find(DB.machines, j.machineId);
    const pressOv = num(j.pressW) > 0 && num(j.pressH) > 0;
    const kind = mat && E.materialMode(mat) === 'roll' && !pressOv && !isBook() ? 'roll' : 'sheet';
    const costing = mach ? (mach.type === 'offset' ? 'offset' : mach.type === 'digital' ? 'digital' : 'area') : 'digital';
    const circle = j.mode === 'sticker' && j.shape === 'circle';
    const U_ = j.unit;
    const tests = Seed.testJobs();
    const S = DB.settings, P = S.printing, WS = S.waste[j.mode] || { pct: 0, setup: 0, min: 0 };

    const jobCard = `<section class="card"><h3>1 · Job</h3><div class="grid">
      ${F.txt('name', 'Job name', { cls: 'span2', ph: 'e.g. Menu cards for client job 1042' })}
      ${F.sel('product', 'Product type', E.PRODUCT_TYPES.map((p) => [p, p]), { r: 1 })}
      ${F.sel('mode', 'Printing method', Object.keys(E.MODES).map((k) => [k, E.MODES[k]]), { r: 1 })}
      ${F.num('qty', 'Quantity (pieces)', { ph: '1000' })}
      ${j.mode === 'sticker' ? F.sel('shape', 'Sticker shape', [['rect', 'Rectangle'], ['circle', 'Circle'], ['custom', 'Custom shape']], { r: 1 }) : ''}
      ${F.sel('unit', 'Size unit', [['mm', 'mm'], ['cm', 'cm'], ['m', 'meter']], { r: 1 })}
      ${circle ? F.num('diameter', `Diameter (${U_})`) : F.num('w', `Finished width (${U_})`) + F.num('h', `Finished height (${U_})`)}
      ${j.mode === 'sticker' && j.shape === 'custom' ? F.num('cutLen', 'Cut path per piece (mm)', { hint: 'Empty = bounding box perimeter' }) : ''}
      ${circle ? '' : F.num('ow', `Open width (${U_})`, { hint: isBook() ? 'Empty = 2 × width (spread)' : 'Only if folded / opened up' }) + F.num('oh', `Open height (${U_})`)}
      ${isBook() ? F.num('pages', 'Number of pages', { ph: '16', hint: 'Multiple of 4' }) : ''}
      ${F.sel('sides', 'Number of sides', [['1', '1 side'], ['2', '2 sides']], { dis: isBook(), hint: isBook() ? 'Booklets print both sides' : '' })}
      ${F.num('bleed', 'Bleed (mm)', { ph: '3' })}
      <label class="f span2"><span>Notes</span><textarea data-k="notes" placeholder="Anything worth remembering about this job">${esc(j.notes)}</textarea></label>
    </div></section>`;

    const matOpts = [['', '— choose material —']].concat(DB.materials.map((m) => [m.id, matLabel(m) + (E.materialMode(m) === 'roll' ? '  [roll]' : '')]));
    const machOpts = [['', '— choose machine —']].concat(DB.machines.filter((m) => E.MODE_MACHINES[j.mode].includes(m.type)).map((m) => [m.id, m.name]));
    const layoutCard = `<section class="card"><h3>2 · Material &amp; layout <small>${kind === 'roll' ? 'Roll layout' : 'Sheet layout'}</small></h3><div class="grid g2">
      ${F.sel('materialId', 'Material', matOpts, { r: 1, cls: 'span2' })}
      ${F.sel('machineId', 'Printing machine', machOpts, { r: 1, cls: 'span2' })}
      </div><div class="grid" style="margin-top:12px">
      ${kind === 'sheet' ? F.num('margin', 'Sheet margin, each edge (mm)', { hint: 'Not printable' }) + F.num('gripper', 'Gripper edge (mm)', { hint: 'Extra, one edge' }) : F.num('rollEdge', 'Roll edge margin, each side (mm)')}
      ${F.num('gutter', 'Gap between pieces (mm)')}
      </div>
      ${kind === 'sheet' ? `<details class="adv"${pressOv || num(j.parentDivisor) > 1 ? ' open' : ''}><summary>Cut press sheets from a bigger purchased sheet</summary><div class="grid" style="margin-top:10px">
        ${F.num('pressW', 'Press sheet width (mm)', { ph: mat && mat.sheetW ? mat.sheetW : '' })}${F.num('pressH', 'Press sheet height (mm)', { ph: mat && mat.sheetH ? mat.sheetH : '' })}
        ${F.num('parentDivisor', 'Press sheets per purchased sheet', { hint: 'Only for materials priced per sheet/pack' })}</div></details>` : ''}
    </section>`;

    let printFields = '';
    if (costing === 'offset') {
      printFields = F.num('colors', 'Number of colours') + F.num('plates', 'Number of plates', { ph: 'auto', hint: 'Auto = colours × sides × designs' })
        + F.num('plateCost', `Plate cost (${cur()})`, { ph: P.plateCost }) + F.num('inkRate', `Ink per 1,000 colour-sides (${cur()})`, { ph: P.offsetInkPer1000 })
        + F.num('setupHours', 'Setup time (hours)', { ph: P.setupHours.offset, hint: 'Per design' }) + F.num('speed', 'Machine speed (impr./h)', { ph: mach ? mach.speed : '' });
    } else if (costing === 'digital') {
      printFields = F.sel('colorMode', 'Colour or B&W', [['color', 'Colour'], ['bw', 'Black & white']])
        + F.num('clickColor', `Colour click (${cur()})`, { ph: mach ? mach.clickColor : '' }) + F.num('clickBW', `B&W click (${cur()})`, { ph: mach ? mach.clickBW : '' })
        + F.num('setupHours', 'Setup time (hours)', { ph: P.setupHours[j.mode] }) + F.num('speed', 'Machine speed (impr./h)', { ph: mach ? mach.speed : '' });
    } else {
      printFields = F.num('inkSqm', `Ink cost per m² (${cur()})`, { ph: P.areaInkPerSqm }) + F.num('machineSqm', `Machine cost per m² (${cur()})`, { ph: mach ? mach.costPerSqm : '' })
        + F.num('setupHours', 'Setup time (hours)', { ph: P.setupHours[j.mode] }) + F.num('speed', 'Machine speed (m²/h)', { ph: mach ? mach.speed : '' });
    }
    const printCard = `<section class="card"><h3>3 · Printing <small>${costing === 'offset' ? 'Offset' : costing === 'digital' ? 'Digital clicks' : 'Area based (per m²)'}</small></h3><div class="grid">${printFields}</div>
      <p class="hint">Empty boxes use the rate from the Machines database or Settings (shown in grey). Type a number to override it for this job only.</p></section>`;

    const wasteCard = `<section class="card"><h3>4 · Waste <small>${E.MODES[j.mode]}</small></h3><div class="grid">
      ${F.num('wastePct', 'Waste %', { ph: WS.pct })}
      ${F.num('setupWaste', `Setup waste (${kind === 'sheet' ? 'sheets' : 'm'} per run)`, { ph: WS.setup })}
      ${F.num('extraWaste', `Additional waste (${kind === 'sheet' ? 'sheets' : 'm'})`)}
      </div><p class="hint">Minimum waste for this method: ${WS.min} ${kind === 'sheet' ? 'sheets' : 'm'}. Defaults per method are edited in Settings.</p></section>`;

    const finOpts = [['', '— choose —']].concat(DB.finishing.map((f) => [f.id, f.name]));
    const chain = ['Printing'].concat(j.mode === 'sticker' && j.lamFinId ? [(find(DB.finishing, j.lamFinId) || {}).name || ''] : []).concat(j.finishing.filter((r) => r.finId).map((r) => (find(DB.finishing, r.finId) || {}).name || '')).concat(j.mode === 'sticker' && j.cutFinId ? [(find(DB.finishing, j.cutFinId) || {}).name || ''] : []).filter(Boolean);
    const finRows = j.finishing.map((r, i) => {
      const op = find(DB.finishing, r.finId);
      const hourly = op && op.method === 'per_hour';
      return `<div class="row fin">
        <label class="f"><span>Operation</span><select data-k="finishing.${i}.finId" data-r="1">${finOpts.map((x) => opt(x[0], x[1], r.finId)).join('')}</select><i class="err" data-err="finishing.${i}.finId"></i></label>
        <label class="f"><span>${hourly ? 'Hours' : 'Quantity'}</span><input type="number" step="any" data-k="finishing.${i}.qty" value="${esc(r.qty)}" placeholder="${hourly ? 'hours' : 'auto'}"><i class="err" data-err="finishing.${i}.qty"></i></label>
        <label class="f"><span>× Times</span><input type="number" step="any" data-k="finishing.${i}.mult" value="${esc(r.mult)}" placeholder="1"><i class="err" data-err="finishing.${i}.mult"></i></label>
        ${F.chk(`finishing.${i}.scales`, 'Scales')}
        <button class="btn sm" data-act="del" data-list="finishing" data-i="${i}" aria-label="Remove operation">Remove</button></div>`;
    }).join('');
    const stickerFin = j.mode === 'sticker' ? `<div class="grid g2" style="margin-bottom:12px">${F.sel('lamFinId', 'Lamination', [['', 'None']].concat(DB.finishing.map((f) => [f.id, f.name])), { r: 1 })}${F.sel('cutFinId', 'Cutting method', [['', 'None']].concat(DB.finishing.map((f) => [f.id, f.name])), { r: 1 })}</div>` : '';
    const finCard = `<section class="card"><h3>5 · Finishing <small>each stage is costed separately</small></h3>
      <div class="chain">${chain.map((c, i) => (i ? '<i>→</i>' : '') + `<b>${esc(c)}</b>`).join('')}</div>${stickerFin}
      <div class="rows">${finRows || '<p class="hint" style="margin:0">No finishing operations added.</p>'}</div>
      <div style="margin-top:10px"><button class="btn sm" data-act="add" data-list="finishing">Add finishing operation</button></div>
      <p class="hint">Quantity “auto” follows the operation's pricing method: pieces, good sheets, cut length (perimeter of all pieces), area, or once per job. “Times” multiplies it (e.g. 2 for both sides, 4 eyelets). Tick “Scales” to let the row grow with quantity in the comparison table.</p></section>`;

    const labOpts = [['', '— choose —']].concat(DB.labor.map((l) => [l.id, l.category]));
    const labRows = j.labor.map((r, i) => `<div class="row lab">
        <label class="f"><span>Labor category</span><select data-k="labor.${i}.laborId" data-r="1">${labOpts.map((x) => opt(x[0], x[1], r.laborId)).join('')}</select><i class="err" data-err="labor.${i}.laborId"></i></label>
        <label class="f"><span>Hours</span><input type="number" step="any" data-k="labor.${i}.hours" value="${esc(r.hours)}"><i class="err" data-err="labor.${i}.hours"></i></label>
        ${F.chk(`labor.${i}.scales`, 'Scales')}<button class="btn sm" data-act="del" data-list="labor" data-i="${i}">Remove</button></div>`).join('');
    const laborCard = `<section class="card"><h3>6 · Labor</h3><div class="rows">${labRows || '<p class="hint" style="margin:0">No labor added.</p>'}</div>
      <div style="margin-top:10px"><button class="btn sm" data-act="add" data-list="labor">Add labor operation</button></div>
      <p class="hint">Machine setup time is already costed at the machine's setup rate. Add labor only for people-time that is not already inside a machine rate.</p></section>`;

    const addMatOpts = [['', '— choose —']].concat(DB.materials.map((m) => [m.id, m.name]));
    const addRows = j.addMaterials.map((r, i) => { const mm = find(DB.materials, r.materialId); const b = mm ? E.matBasis(mm) : null; return `<div class="row mat">
        <label class="f"><span>Other material</span><select data-k="addMaterials.${i}.materialId" data-r="1">${addMatOpts.map((x) => opt(x[0], x[1], r.materialId)).join('')}</select><i class="err" data-err="addMaterials.${i}.materialId"></i></label>
        <label class="f"><span>Quantity${b ? ` (${b.label})` : ''}</span><input type="number" step="any" data-k="addMaterials.${i}.qty" value="${esc(r.qty)}"><i class="err" data-err="addMaterials.${i}.qty"></i></label>
        ${F.chk(`addMaterials.${i}.scales`, 'Scales')}<button class="btn sm" data-act="del" data-list="addMaterials" data-i="${i}">Remove</button></div>`; }).join('');
    const othRows = j.other.map((r, i) => `<div class="row oth">
        <label class="f"><span>Description</span><input type="text" data-k="other.${i}.desc" value="${esc(r.desc)}" placeholder="Glue, tape, cutting die…"></label>
        <label class="f"><span>Quantity</span><input type="number" step="any" data-k="other.${i}.qty" value="${esc(r.qty)}"><i class="err" data-err="other.${i}.qty"></i></label>
        <label class="f"><span>Unit cost (${cur()})</span><input type="number" step="any" data-k="other.${i}.unitCost" value="${esc(r.unitCost)}"><i class="err" data-err="other.${i}.unitCost"></i></label>
        ${F.chk(`other.${i}.scales`, 'Scales')}<button class="btn sm" data-act="del" data-list="other" data-i="${i}">Remove</button></div>`).join('');
    const otherCard = `<section class="card"><h3>7 · Other materials &amp; production costs</h3>
      <div class="rows">${addRows}${othRows || (addRows ? '' : '<p class="hint" style="margin:0">Nothing added.</p>')}</div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="add" data-list="addMaterials">Add other material</button><button class="btn sm" data-act="add" data-list="other">Add custom cost</button></div></section>`;

    const actions = `<label class="f" style="min-width:230px"><span>Load a demo test job</span><select id="loadtest"><option value="">— choose —</option>${tests.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('')}</select></label><button class="btn" data-act="new-job">Start new</button>`;
    return head('New cost calculation', 'Enter the job. The production cost updates as you type.', actions)
      + `<div class="calc"><div class="col-form">${jobCard}${layoutCard}${printCard}${wasteCard}${finCard}${laborCard}${otherCard}</div>
      <div class="col-res"><div id="results"></div>
        <section class="card" id="cmpcard"><h3>Compare quantities <small>uses the real calculation</small></h3>
          <label class="f"><span>Quantities (comma separated)</span><input id="cmpq" type="text" value="${esc(state.cmp)}"></label><div id="cmptable" style="margin-top:12px"></div></section></div></div>
      <div class="mini" id="mini"></div>`;
  }

  /* ---------- results ---------- */
  function sheetSVG(L) {
    const sc = Math.min(300 / L.sheetW, 240 / L.sheetH), w = L.sheetW * sc, h = L.sheetH * sc;
    let s = `<svg viewBox="0 0 ${(w + 2).toFixed(1)} ${(h + 2).toFixed(1)}" width="${Math.min(w + 2, 320)}" role="img" aria-label="Layout of ${L.ups} pieces on the sheet"><g transform="translate(1,1)"><rect class="s-sheet" width="${w}" height="${h}"/>`;
    if (L.gripper > 0) s += `<rect class="s-grip" x="0" y="${(h - L.gripper * sc).toFixed(2)}" width="${w}" height="${(L.gripper * sc).toFixed(2)}"/>`;
    s += `<rect class="s-print" x="${L.margin * sc}" y="${L.margin * sc}" width="${L.printW * sc}" height="${L.printH * sc}"/>`;
    if (L.ups <= 500) for (let r = 0; r < L.down; r++) for (let c = 0; c < L.across; c++) {
      const x = (L.margin + c * (L.cellW + L.gutter)) * sc, y = (L.margin + r * (L.cellH + L.gutter)) * sc;
      s += `<rect class="s-cell" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(L.cellW * sc).toFixed(2)}" height="${(L.cellH * sc).toFixed(2)}"/><rect class="s-trim" x="${(x + L.bleed * sc).toFixed(2)}" y="${(y + L.bleed * sc).toFixed(2)}" width="${(L.pw * sc).toFixed(2)}" height="${(L.ph * sc).toFixed(2)}"/>`;
    }
    return s + '</g></svg>';
  }
  function rollSVG(L) {
    const shown = Math.min(L.rows, 6), rowH = L.cellH + L.gutter;
    const sc = Math.min(300 / L.rollWidth, 220 / (shown * rowH)), w = L.rollWidth * sc, h = shown * rowH * sc;
    let s = `<svg viewBox="0 0 ${(w + 2).toFixed(1)} ${(h + 22).toFixed(1)}" width="${Math.min(w + 2, 320)}" role="img" aria-label="Roll layout"><g transform="translate(1,1)"><rect class="s-roll" width="${w}" height="${h}"/>`;
    for (let r = 0; r < shown; r++) for (let c = 0; c < L.across; c++) {
      const x = (L.rollEdge + (L.usableW - (L.across * L.cellW + (L.across - 1) * L.gutter)) / 2 + c * (L.cellW + L.gutter)) * sc, y = r * rowH * sc;
      s += `<rect class="s-cell" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(L.cellW * sc).toFixed(2)}" height="${(L.cellH * sc).toFixed(2)}"/><rect class="s-trim" x="${(x + L.bleed * sc).toFixed(2)}" y="${(y + L.bleed * sc).toFixed(2)}" width="${(L.pw * sc).toFixed(2)}" height="${(L.ph * sc).toFixed(2)}"/>`;
    }
    return s + `<text class="s-txt" x="0" y="${(h + 15).toFixed(1)}">${shown < L.rows ? `first ${shown} of ${L.rows} rows` : `${L.rows} rows`}</text></g></svg>`;
  }
  const CAT_NAMES = { material: 'Material', printing: 'Printing', finishing: 'Finishing', labor: 'Labor', machine: 'Machine', setup: 'Setup', waste: 'Waste', other: 'Other production costs' };

  function breakdownHTML(r) {
    return `<div class="bk">${E.CATEGORIES.filter((c) => r.lines[c].length).map((c) => `<h4><span>${CAT_NAMES[c]}</span><span>${money(r.subtotals[c])}</span></h4>${r.lines[c].map((l) => `<div class="ln"><span class="nm">${esc(l.label)}</span><span class="am">${U.m(l.amount)}</span><span class="fm">${esc(l.formula)}</span></div>`).join('')}`).join('')}</div>`;
  }
  function formulaHTML(r) {
    const parts = E.CATEGORIES.map((c) => U.m(r.subtotals[c])).join(' + ');
    return `<div class="eq"><b>Total production cost</b> = Material + Printing + Finishing + Labor + Machine + Setup + Waste + Other<br>= ${parts}<br>= <b>${money(r.total)}</b><br><b>Cost per piece</b> = ${U.m(r.total)} ÷ ${U.f(r.qty)} pieces = <b>${perPieceFmt(r.perPiece)}</b></div><p class="hint">Cost per piece divides by the quantity you ordered (good pieces), so the cost of waste is spread over them.</p>`;
  }
  function requirementHTML(r) {
    const s = r.summary, q = s.requirement, L = r.layout, dp = s.kind === 'sheet' ? 0 : 3;
    const rows = [];
    if (L.kind === 'sheet') {
      rows.push(['Pieces per sheet', `${L.across} across × ${L.down} down = <b>${L.ups}</b> (orientation ${L.orientation}: ${L.pw} × ${L.ph} mm)`]);
      rows.push(['Other orientation', `${L.orientation === 'A' ? 'B' : 'A'}: ${L[L.orientation === 'A' ? 'B' : 'A'].across} × ${L[L.orientation === 'A' ? 'B' : 'A'].down} = ${L[L.orientation === 'A' ? 'B' : 'A'].ups}`]);
      rows.push(['Printable area', `${U.f(L.printW)} × ${U.f(L.printH)} mm of ${U.f(L.sheetW)} × ${U.f(L.sheetH)} mm (${U.f(L.utilisation, 1)}% of the sheet is finished product)`]);
      if (L.flats > 1) rows.push(['Designs / flats', `${L.flats} (${s.pages} pages ÷ 4), ${L.goodPerFlat} sheets each${L.openAuto ? '; open size taken as 2 × width' : ''}`]);
    } else {
      rows.push(['Pieces across', `${L.across} (orientation ${L.orientation}: ${L.pw} × ${L.ph} mm) on ${U.f(L.usableW)} mm usable width`]);
      rows.push(['Rows along the roll', `${L.rows} (last row ${L.lastRow} piece${L.lastRow === 1 ? '' : 's'})`]);
      rows.push(['Running length', `<b>${U.f(L.lengthM, 3)} m</b> = ${U.f(L.lengthM * L.rollWidth / 1000, 3)} m²`]);
    }
    rows.push(['Material needed', `${U.f(q.good, dp)} good + ${U.f(q.waste, dp)} waste = <b>${U.f(q.total, dp)} ${s.unitName}</b> (${U.f(q.pct)}% + setup ${U.f(q.setupWaste, dp)} + extra ${U.f(q.addWaste, dp)})`]);
    const p = s.printing;
    if (p.plates != null) rows.push(['Printing', `${U.f(p.impressions)} impressions, ${U.f(p.plates)} plates, ${p.colours} colours${p.passes > 1 ? `, ${p.passes} passes` : ''}`]);
    else if (p.clicks != null) rows.push(['Printing', `${U.f(p.clicks)} clicks (${p.colorMode})`]);
    else rows.push(['Printing', `${U.f(p.printedSqm, 3)} m² printed (${U.f(p.areaPerPiece * 10000, 1)} cm² per piece incl. bleed)`]);
    rows.push(['Machine time', `${U.f(s.machineHours.run, 3)} h running + ${U.f(s.machineHours.setup, 3)} h setup`]);
    if (r.stages.length) rows.push(['Finishing', r.stages.map((x) => `${esc(x.name)}: ${U.f(x.qtyEff, 2)} ${x.unit}`).join('; ')]);
    rows.push(['Labor', `${U.f(s.labor.hours, 2)} h`]);
    return `<dl class="kv">${rows.map((x) => `<dt>${x[0]}</dt><dd>${x[1]}</dd>`).join('')}</dl>`;
  }
  function resultsHTML(r) {
    const j = state.job;
    const editBanner = state.editingId ? (() => { const diff = state.savedTotal != null && r.ok && Math.abs(state.savedTotal - r.total) >= 0.005; return `<div class="notice info">Editing <b>${esc(state.editingId)}</b>. ${state.savedTotal != null ? `Saved total was ${money(state.savedTotal)}${diff ? `; with today's rates and your changes it is ${money(r.total)}.` : '.'}` : ''}</div>`; })() : '';
    if (!r.ok) {
      return `<div class="sheetwrap"><i class="cm tl"></i><i class="cm tr"></i><i class="cm bl"></i><i class="cm br"></i><div class="sheet"><div class="lbl">Total production cost</div><div class="invalid">Not calculated yet — fix the items below.</div><div class="strip"><i></i><i></i><i></i><i></i></div></div></div>${editBanner}<div class="notice bad"><b>${r.errors.length} thing${r.errors.length > 1 ? 's' : ''} to fix</b><ul>${r.errors.map((e) => `<li>${esc(e.msg)}</li>`).join('')}</ul></div>`;
    }
    const warn = r.warnings.length ? `<div class="notice"><ul style="margin:0;padding-left:18px">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '';
    const saveBtns = state.editingId ? `<button class="btn primary" data-act="save-calc">Update ${esc(state.editingId)}</button><button class="btn" data-act="save-new">Save as new</button>` : `<button class="btn primary" data-act="save-new">Save calculation</button>`;
    return `<div class="sheetwrap"><i class="cm tl"></i><i class="cm tr"></i><i class="cm bl"></i><i class="cm br"></i><div class="sheet">
        <div class="lbl">Total production cost</div><div class="big"><small>${esc(cur())}</small>${U.m(r.total)}</div>
        <div class="two"><div><div class="lbl">Quantity</div><div class="v">${U.f(r.qty)}</div></div><div><div class="lbl">Cost per piece</div><div class="v">${perPieceFmt(r.perPiece)}</div></div></div>
        <div class="strip"><i></i><i></i><i></i><i></i></div></div></div>
      <div class="saveline">${saveBtns}</div>${editBanner}${warn}
      <section class="card"><h3>What the job needs</h3><div class="figure">${r.layout.kind === 'sheet' ? sheetSVG(r.layout) : rollSVG(r.layout)}${requirementHTML(r)}</div></section>
      <section class="card"><h3>Cost breakdown <small>${esc(j.name || 'Untitled job')}</small></h3>${breakdownHTML(r)}</section>
      <section class="card"><h3>How the total is built</h3>${formulaHTML(r)}</section>`;
  }
  function paintErrors(r) {
    const map = {};
    r.errors.forEach((e) => { if (e.field && !map[e.field]) map[e.field] = e.msg; });
    $$('[data-err]').forEach((el) => { el.textContent = map[el.dataset.err] || ''; });
    $$('[data-k]').forEach((el) => { if (map[el.dataset.k]) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); });
  }
  function paintCompare() {
    const box = $('#cmptable'); if (!box) return;
    const qs = state.cmp.split(/[,;\s]+/).filter(Boolean).map(Number);
    if (!qs.length || qs.some((q) => !Number.isFinite(q) || q <= 0 || !Number.isInteger(q))) { box.innerHTML = '<p class="hint" style="margin:0"><i class="err" style="display:block">Enter whole quantities above 0, separated by commas.</i></p>'; return; }
    if (qs.length > 12) { box.innerHTML = '<p class="hint" style="margin:0">Compare up to 12 quantities.</p>'; return; }
    if (!state.result || !state.result.ok) { box.innerHTML = '<p class="hint" style="margin:0">Complete the job above to compare quantities.</p>'; return; }
    const rows = E.compare(state.job, DB, qs), max = Math.max.apply(null, rows.map((x) => (x.ok ? x.perPiece : 0))) || 1;
    box.innerHTML = `<table class="tbl tight"><thead><tr><th class="n">Quantity</th><th class="n">Total cost</th><th class="n">Cost / piece</th><th></th></tr></thead><tbody>${rows.map((x) => x.ok ? `<tr><td class="n">${U.f(x.qty)}</td><td class="n">${money(x.total)}</td><td class="n">${perPieceFmt(x.perPiece)}</td><td style="width:70px"><span class="bar" style="width:${Math.max(3, (x.perPiece / max) * 60).toFixed(0)}px"></span></td></tr>` : `<tr><td class="n">${U.f(x.qty)}</td><td colspan="3" class="err">${esc(x.errors[0] ? x.errors[0].msg : 'Cannot calculate')}</td></tr>`).join('')}</tbody></table><p class="hint">Rows ticked “Scales” grow with the quantity; other manual hours, quantities and costs stay fixed.</p>`;
  }
  function recalc() {
    const r = E.calculate(state.job, DB);
    state.result = r;
    const box = $('#results'); if (!box) return;
    box.innerHTML = resultsHTML(r);
    paintErrors(r); paintCompare();
    const mini = $('#mini'); if (mini) mini.innerHTML = r.ok ? `<span>Total production cost</span><b>${money(r.total)}</b><span>Per piece <b style="font-size:16px">${perPieceFmt(r.perPiece)}</b></span>` : '<span>Total production cost</span><b>—</b><span>Fix the highlighted fields</span>';
  }

  /* ================= saving a calculation: the real relational write ================= */
  function buildCalcPayload(job, r, DBnow) {
    const u = E.UNIT_MM[job.unit] || 1, circle = job.mode === 'sticker' && job.shape === 'circle';
    const wmm = (circle ? num(job.diameter) : num(job.w)) * u, hmm = (circle ? num(job.diameter) : num(job.h)) * u;
    const owmm = num(job.ow) > 0 ? num(job.ow) * u : null, ohmm = num(job.oh) > 0 ? num(job.oh) * u : null;
    const header = {
      job_name: job.name || 'Untitled job', product_type: job.product, production_mode: job.mode, quantity: r.qty,
      finished_width_mm: wmm, finished_height_mm: hmm, open_width_mm: owmm, open_height_mm: ohmm,
      pages: r.summary.pages || null, sides: r.summary.sides, bleed_mm: num(job.bleed), notes: job.notes || null,
      subtotal_material: r.subtotals.material, subtotal_printing: r.subtotals.printing, subtotal_finishing: r.subtotals.finishing,
      subtotal_labor: r.subtotals.labor, subtotal_machine: r.subtotals.machine, subtotal_setup: r.subtotals.setup,
      subtotal_waste: r.subtotals.waste, subtotal_other: r.subtotals.other, total_cost: r.total, cost_per_piece: r.perPiece,
      full_result: r, job_snapshot: job
    };
    const mat = find(DBnow.materials, job.materialId), L = r.layout, q = r.summary.requirement;
    const wasteLine = r.lines.waste.find((l) => l.label.startsWith(mat.name));
    const materials = [{
      material_id: mat.id, role: 'main', material_name: mat.name, layout_kind: L.kind,
      press_width_mm: L.kind === 'sheet' ? L.sheetW : null, press_height_mm: L.kind === 'sheet' ? L.sheetH : null,
      margin_mm: L.kind === 'sheet' ? L.margin : null, gripper_mm: L.kind === 'sheet' ? L.gripper : null, gap_mm: L.gutter,
      orientation: L.orientation, pieces_across: L.across, pieces_down: L.kind === 'sheet' ? L.down : null,
      pieces_per_sheet: L.kind === 'sheet' ? L.ups : null, rows_along_roll: L.kind === 'roll' ? L.rows : null,
      good_units: q.good, waste_units: q.waste, total_units: q.total, unit_cost: q.perUnit,
      line_cost: r.lines.material[0].amount + (wasteLine ? wasteLine.amount : 0)
    }];
    (job.addMaterials || []).forEach((row, i) => {
      const mm = find(DBnow.materials, row.materialId); if (!mm) return;
      const line = r.lines.material[i + 1];
      materials.push({ material_id: mm.id, role: 'other', material_name: mm.name, layout_kind: null, orientation: null, good_units: num(row.qty), waste_units: 0, total_units: num(row.qty), unit_cost: E.matBasis(mm).cost || 0, line_cost: line ? line.amount : 0 });
    });
    const printing = { machine_id: find(DBnow.machines, job.machineId).id, machine_name: find(DBnow.machines, job.machineId).name, method: r.summary.costing,
      colours: r.summary.printing.colours || null, plates: r.summary.printing.plates || null, plate_cost: r.summary.printing.plateCost || null, ink_rate: r.summary.printing.inkRate || null,
      impressions: r.summary.printing.impressions || null, printed_sqm: r.summary.printing.printedSqm || null, click_rate: r.summary.printing.clickRate || null,
      speed_used: null, run_hours: r.summary.machineHours.run, setup_hours: r.summary.machineHours.setup, hourly_rate_used: null, setup_rate_used: null,
      plate_or_click_cost: null, ink_cost: null, machine_cost: r.subtotals.machine, setup_cost: r.subtotals.setup };
    const finishing = r.stages.map((s, i) => ({ stage_no: i + 1, operation_name: s.name, pricing_method: s.method, quantity_basis: s.basis, multiplier: s.mult, rate_used: s.rate, min_charge_used: s.minCharge, setup_cost_used: s.setup, run_cost: s.run, setup_cost: s.setup }));
    const labor = (job.labor || []).filter((row) => row.laborId).map((row) => { const lb = find(DBnow.labor, row.laborId); return lb ? { labor_rate_id: lb.id, category_name: lb.category, hours: num(row.hours), hourly_cost_used: num(lb.hourlyCost), line_cost: num(row.hours) * num(lb.hourlyCost) } : null; }).filter(Boolean);
    const other = (job.other || []).filter((row) => row.desc || num(row.qty) || num(row.unitCost)).map((row) => ({ description: row.desc || 'Other cost', quantity: num(row.qty), unit_cost: num(row.unitCost), line_cost: num(row.qty) * num(row.unitCost) }));
    return { header, materials, printing, finishing, labor, other };
  }
  async function writeCalcChildren(calcId, payload) {
    if (payload.materials.length) { const { error } = await sb.from('calculation_materials').insert(payload.materials.map((m) => Object.assign({ calculation_id: calcId }, m))); if (error) throw error; }
    { const { error } = await sb.from('calculation_printing').insert(Object.assign({ calculation_id: calcId }, payload.printing)); if (error) throw error; }
    if (payload.finishing.length) { const { error } = await sb.from('calculation_finishing').insert(payload.finishing.map((f) => Object.assign({ calculation_id: calcId }, f))); if (error) throw error; }
    if (payload.labor.length) { const { error } = await sb.from('calculation_labor').insert(payload.labor.map((l) => Object.assign({ calculation_id: calcId }, l))); if (error) throw error; }
    if (payload.other.length) { const { error } = await sb.from('calculation_other_costs').insert(payload.other.map((o) => Object.assign({ calculation_id: calcId }, o))); if (error) throw error; }
  }
  async function saveCalc(asNew) {
    const r = state.result;
    if (!r || !r.ok) { toast('Fix the highlighted fields before saving.', 'warn'); return; }
    const j = clone(state.job); if (!j.name) j.name = 'Untitled job';
    const payload = buildCalcPayload(j, r, DB);
    try {
      if (!asNew && state.editingId && state.editingUuid) {
        const { error: uerr } = await sb.from('calculations').update(payload.header).eq('id', state.editingUuid);
        if (uerr) throw uerr;
        for (const t of ['calculation_materials', 'calculation_printing', 'calculation_finishing', 'calculation_labor', 'calculation_other_costs']) { const { error } = await sb.from(t).delete().eq('calculation_id', state.editingUuid); if (error) throw error; }
        await writeCalcChildren(state.editingUuid, payload);
        const i = DB.calcs.findIndex((c) => c.id === state.editingId);
        if (i >= 0) DB.calcs[i] = Object.assign(DB.calcs[i], { name: j.name, product: j.product, quantity: r.qty, total: r.total, perPiece: r.perPiece, job: j, full: r });
        state.savedTotal = r.total; toast(`${state.editingId} updated.`);
      } else {
        const { data, error } = await sb.from('calculations').insert(payload.header).select().single();
        if (error) throw error;
        await writeCalcChildren(data.id, payload);
        DB.calcs.unshift({ id: data.display_id, _uuid: data.id, date: data.created_at, name: j.name, product: j.product, quantity: r.qty, total: r.total, perPiece: r.perPiece, createdBy: session.user.id, job: j, full: r });
        state.editingId = data.display_id; state.editingUuid = data.id; state.savedTotal = r.total; toast(`Saved as ${data.display_id}.`);
      }
      render();
    } catch (e) { toast('Could not save: ' + friendlyDbError(e), 'warn'); }
  }

  /* ================= generic databases ================= */
  const nf = (x, d) => (isBlank(x) ? '—' : U.f(num(x), d == null ? 2 : d));
  const ENT = {
    materials: {
      title: 'Materials', one: 'material', search: ['name', 'category', 'supplier', 'gsm'],
      sub: 'Purchase price and unit are what you enter; cost per sheet, meter and m² are worked out for you. Shared with everyone signed in.',
      cols: [
        { h: 'Material', f: (r) => `<b>${esc(r.name)}</b>${demoTag(r)}` }, { h: 'Category', f: (r) => esc(r.category) }, { h: 'GSM / thickness', f: (r) => esc(r.gsm) },
        { h: 'Sheet (mm)', f: (r) => (num(r.sheetW) > 0 ? `${U.f(r.sheetW)} × ${U.f(r.sheetH)}` : (matNeeds(r).size && !(num(r.rollWidth) > 0) ? '<span class="need">Needs size</span>' : '—')) }, { h: 'Roll width (mm)', n: 1, f: (r) => nf(r.rollWidth, 0) },
        { h: 'Purchase cost', n: 1, f: (r) => isBlank(r.purchaseCost) ? '<span class="need">Needs price</span>' : `${U.m(num(r.purchaseCost))} <small>${esc(({ sheet: '/sheet', pack: `/pack of ${r.packSize || '?'}`, meter: '/m', sqm: '/m²', roll: `/roll${num(r.rollLength) ? ' of ' + r.rollLength + ' m' : ''}` })[r.unit] || '')}</small>` },
        { h: 'Per sheet', n: 1, f: (r) => { const d = E.matDerived(r); return d.perSheet == null ? '—' : U.f(d.perSheet, 4); } },
        { h: 'Per meter', n: 1, f: (r) => { const d = E.matDerived(r); return d.perMeter == null ? '—' : U.f(d.perMeter, 4); } },
        { h: 'Per m²', n: 1, f: (r) => { const d = E.matDerived(r); return d.perSqm == null ? '—' : U.f(d.perSqm, 4); } },
        { h: 'Min. charge', n: 1, f: (r) => nf(r.minCharge) }, { h: 'Supplier', f: (r) => esc(r.supplier) }
      ]
    },
    machines: {
      title: 'Machines', one: 'machine', search: ['name', 'type', 'notes'],
      sub: 'Only the fields that matter for each machine type are shown when you edit it. Shared with everyone signed in.',
      cols: [
        { h: 'Machine', f: (r) => `<b>${esc(r.name)}</b>${demoTag(r)}` }, { h: 'Type', f: (r) => esc(E.MACHINE_TYPES[r.type] || r.type) },
        { h: 'Hourly rate', n: 1, f: (r) => nf(r.hourlyRate) }, { h: 'Setup rate', n: 1, f: (r) => (isBlank(r.setupRate) ? '<small>= hourly</small>' : nf(r.setupRate)) },
        { h: 'Speed', n: 1, f: (r) => (isBlank(r.speed) ? '—' : `${U.f(num(r.speed))} <small>${esc(E.SPEED_UNIT[r.type] || '')}</small>`) },
        { h: 'Cost / m²', n: 1, f: (r) => (E.MACHINE_FIELDS[r.type].includes('costPerSqm') ? nf(r.costPerSqm, 4) : '') },
        { h: 'Cost / impression', n: 1, f: (r) => (E.MACHINE_FIELDS[r.type].includes('costPerImpression') ? nf(r.costPerImpression, 4) : '') },
        { h: 'Clicks (colour / B&W)', n: 1, f: (r) => (r.type === 'digital' ? `${nf(r.clickColor, 4)} / ${nf(r.clickBW, 4)}` : '') }
      ]
    },
    finishing: {
      title: 'Finishing', one: 'operation', search: ['name', 'method', 'notes'],
      sub: 'Every operation has a pricing method, an optional fixed setup cost and an optional minimum charge. Shared with everyone signed in.',
      cols: [
        { h: 'Operation', f: (r) => `<b>${esc(r.name)}</b>${demoTag(r)}` }, { h: 'Pricing method', f: (r) => esc(E.FIN_METHODS[r.method] || r.method) },
        { h: 'Rate', n: 1, f: (r) => nf(r.rate, 4) }, { h: 'Fixed setup cost', n: 1, f: (r) => nf(r.setupCost) }, { h: 'Min. charge', n: 1, f: (r) => nf(r.minCharge) }, { h: 'Notes', f: (r) => (r.demo ? '' : esc(r.notes)) }
      ]
    },
    labor: {
      title: 'Labor', one: 'labor category', search: ['category', 'notes'],
      sub: 'Hourly cost of each kind of work. Shared with everyone signed in.',
      cols: [{ h: 'Labor category', f: (r) => `<b>${esc(r.category)}</b>${demoTag(r)}` }, { h: 'Hourly cost', n: 1, f: (r) => nf(r.hourlyCost) }, { h: 'Notes', f: (r) => (r.demo ? '' : esc(r.notes)) }]
    }
  };
  function fieldDefs(key, d) {
    const n = (k, label, o) => Object.assign({ k, label, type: 'number' }, o || {});
    if (key === 'materials') {
      const un = d.unit;
      return [
        { k: 'name', label: 'Material name', type: 'text', req: 1, cls: 'span2' },
        { k: 'category', label: 'Category', type: 'select', options: E.MAT_CATS.map((c) => [c, c]) },
        { k: 'gsm', label: 'GSM / thickness', type: 'text' },
        n('sheetW', 'Sheet width (mm)'), n('sheetH', 'Sheet height (mm)'), n('rollWidth', 'Roll width (mm)'), n('rollLength', 'Roll length (m)', { hint: 'Needed for “per roll” pricing' }),
        { k: 'unit', label: 'Purchase cost is', type: 'select', options: Object.keys(E.MAT_UNITS).map((k) => [k, E.MAT_UNITS[k]]), r: 1 },
        un === 'pack' ? n('packSize', 'Sheets per pack') : null,
        n('purchaseCost', `Purchase cost (${cur()})`, { req: 1 }), n('minCharge', `Minimum charge (${cur()})`),
        { k: 'supplier', label: 'Supplier', type: 'text' }, { k: 'notes', label: 'Notes', type: 'text', cls: 'span2' }
      ].filter(Boolean);
    }
    if (key === 'machines') {
      const fl = E.MACHINE_FIELDS[d.type] || [];
      const map = { hourlyRate: n('hourlyRate', `Hourly rate (${cur()})`, { req: 1 }), setupRate: n('setupRate', `Setup rate (${cur()} / hour)`, { hint: 'Empty = same as hourly rate' }), speed: n('speed', `Speed (${E.SPEED_UNIT[d.type] || 'per hour'})`), colorUnits: n('colorUnits', 'Colours per pass (print units)', { hint: 'A 4-colour press prints CMYK in one pass' }), clickColor: n('clickColor', `Colour click cost (${cur()})`), clickBW: n('clickBW', `B&W click cost (${cur()})`), costPerImpression: n('costPerImpression', `Cost per impression (${cur()})`), costPerSqm: n('costPerSqm', `Cost per m² (${cur()})`) };
      return [{ k: 'name', label: 'Machine name', type: 'text', req: 1, cls: 'span2' }, { k: 'type', label: 'Machine type', type: 'select', options: Object.keys(E.MACHINE_TYPES).map((k) => [k, E.MACHINE_TYPES[k]]), r: 1, cls: 'span2' }].concat(fl.map((k) => map[k])).concat([{ k: 'notes', label: 'Notes', type: 'text', cls: 'span2' }]);
    }
    if (key === 'finishing') {
      const m = d.method;
      const lbl = { per_piece: 'per piece', per_sheet: 'per sheet', per_meter: 'per meter', per_sqm: 'per m²', per_hour: 'per hour', fixed: 'per job' }[m] || '';
      return [{ k: 'name', label: 'Operation name', type: 'text', req: 1, cls: 'span2' }, { k: 'method', label: 'Pricing method', type: 'select', options: Object.keys(E.FIN_METHODS).map((k) => [k, E.FIN_METHODS[k]]), r: 1 },
        n('rate', `Rate (${cur()} ${lbl})`, { req: 1 }), n('setupCost', `Fixed setup cost (${cur()})`), n('minCharge', `Minimum charge (${cur()})`), { k: 'notes', label: 'Notes', type: 'text', cls: 'span2' }];
    }
    return [{ k: 'category', label: 'Labor category', type: 'text', req: 1, cls: 'span2' }, n('hourlyCost', `Hourly cost (${cur()})`, { req: 1 }), { k: 'notes', label: 'Notes', type: 'text', cls: 'span2' }];
  }
  function validateDraft(key, d) {
    const errs = {}; const defs = fieldDefs(key, d);
    defs.forEach((f) => {
      const v = d[f.k];
      if (f.req && isBlank(v)) errs[f.k] = 'Required.';
      else if (f.type === 'number' && !isBlank(v)) { if (!U.isNumeric(v)) errs[f.k] = 'Must be a number.'; else if (Number(v) < 0) errs[f.k] = 'Cannot be negative.'; }
    });
    if (key === 'materials') {
      const p = (k) => num(d[k]);
      if (d.unit === 'sheet' || d.unit === 'pack') { if (!(p('sheetW') > 0)) errs.sheetW = 'Sheet width is needed.'; if (!(p('sheetH') > 0)) errs.sheetH = 'Sheet height is needed.'; }
      if (d.unit === 'pack' && !(p('packSize') >= 1)) errs.packSize = 'Enter sheets per pack (1 or more).';
      if ((d.unit === 'meter' || d.unit === 'roll') && !(p('rollWidth') > 0)) errs.rollWidth = 'Roll width is needed.';
      if (d.unit === 'roll' && !(p('rollLength') > 0)) errs.rollLength = 'Roll length is needed to get cost per meter.';
      if (d.unit === 'sqm' && !(p('rollWidth') > 0) && !(p('sheetW') > 0 && p('sheetH') > 0)) errs.rollWidth = 'Enter a roll width or a sheet size.';
      if (!isBlank(d.sheetW) !== !isBlank(d.sheetH)) errs[isBlank(d.sheetW) ? 'sheetW' : 'sheetH'] = 'Enter both sheet width and height.';
    }
    return errs;
  }
  function blankRecord(key) {
    const id = uuid();
    if (key === 'materials') return { id, name: '', category: 'Paper', gsm: '', sheetW: '', sheetH: '', rollWidth: '', rollLength: '', unit: 'sheet', packSize: '', purchaseCost: '', minCharge: '', supplier: '', notes: '' };
    if (key === 'machines') return { id, name: '', type: 'digital', hourlyRate: '', setupRate: '', speed: '', costPerSqm: '', costPerImpression: '', notes: '' };
    if (key === 'finishing') return { id, name: '', method: 'per_piece', rate: '', setupCost: '', minCharge: '', notes: '' };
    return { id, category: '', hourlyCost: '', notes: '' };
  }
  function formBody(key, d, errs) {
    errs = errs || {};
    const html = fieldDefs(key, d).map((f) => {
      const v = d[f.k] == null ? '' : d[f.k];
      const e = errs[f.k] ? `<i class="err">${esc(errs[f.k])}</i>` : '<i class="err"></i>';
      const inv = errs[f.k] ? ' aria-invalid="true"' : '';
      if (f.type === 'select') return `<label class="f ${f.cls || ''}"><span>${f.label}</span><select data-d="${f.k}"${f.r ? ' data-dr="1"' : ''}>${f.options.map((o) => opt(o[0], o[1], v)).join('')}</select></label>`;
      return `<label class="f ${f.cls || ''}"><span>${f.label}</span><input data-d="${f.k}" type="${f.type === 'number' ? 'number" step="any' : 'text'}" value="${esc(v)}"${inv}>${e}${f.hint ? `<small>${f.hint}</small>` : ''}</label>`;
    }).join('');
    let derived = '';
    if (key === 'materials') {
      const dv = E.matDerived(d), c = (x, u) => (x == null ? '—' : `${U.f(x, 4)} ${cur()}${u}`);
      derived = `<div class="notice info span2" style="grid-column:1/-1;margin:0"><b>Worked out from the purchase cost:</b> ${c(dv.perSheet, ' / sheet')} · ${c(dv.perMeter, ' / m')} · ${c(dv.perSqm, ' / m²')}</div>`;
    }
    return html + derived;
  }
  function openForm(key, id) {
    if (!canEdit()) { toast('Only an admin can edit rates.', 'warn'); return; }
    const rec = id ? clone(find(DB[key], id)) : blankRecord(key);
    if (!rec) return;
    modalCtx = { kind: 'form', key, draft: rec, isNew: !id };
    openModal(`<h2>${id ? 'Edit' : 'Add'} ${ENT[key].one}</h2><div class="grid g2" id="formbody">${formBody(key, rec)}</div><div class="foot"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="save-ent">Save ${ENT[key].one}</button></div>`);
  }
  function saveEnt() {
    const { key, draft } = modalCtx;
    const errs = validateDraft(key, draft);
    if (Object.keys(errs).length) { $('#formbody').innerHTML = formBody(key, draft, errs); toast('Please fix the highlighted fields.', 'warn'); return; }
    const out = clone(draft);
    fieldDefs(key, out).forEach((f) => { if (f.type === 'number') out[f.k] = isBlank(out[f.k]) ? '' : Number(out[f.k]); });
    delete out.demo;
    const i = DB[key].findIndex((x) => x.id === out.id);
    if (i >= 0) DB[key][i] = out; else DB[key].push(out);
    save(); closeModal(); toast(`${ENT[key].one[0].toUpperCase() + ENT[key].one.slice(1)} saved.`); render();
  }
  function crudRows(key) {
    const cfg = ENT[key], q = (state.q[key] || '').toLowerCase(), lock = !canEdit();
    const rows = DB[key].filter((r) => (!q || cfg.search.some((f) => String(r[f] == null ? '' : r[f]).toLowerCase().includes(q))) && !(key === 'materials' && state.needsOnly && matReady(r))).sort((x, y) => (x.demo ? 1 : 0) - (y.demo ? 1 : 0));
    const n = cfg.cols.length + 1;
    return { count: `${rows.length} of ${DB[key].length}`, html: rows.map((r) => `<tr>${cfg.cols.map((c) => `<td class="${c.n ? 'n' : ''}">${c.f(r)}</td>`).join('')}<td class="rowact">${lock ? '' : `<button class="lnk" data-act="edit-ent" data-ent="${key}" data-id="${esc(r.id)}">Edit</button><button class="lnk danger" data-act="del-ent" data-ent="${key}" data-id="${esc(r.id)}">Delete</button>`}</td></tr>`).join('') || `<tr><td class="empty" colspan="${n}">${DB[key].length ? 'Nothing matches your search.' : `No ${cfg.title.toLowerCase()} yet. Add your first ${cfg.one}.`}</td></tr>` };
  }
  const lockBanner = () => (canEdit() ? '' : `<div class="notice info">You're signed in as staff, so you can calculate and view everything, but only an admin can edit rates.</div>`);
  const demoBanner = (key) => (DB[key].some((r) => r.demo) ? '<div class="notice">Rows marked <span class="demo">DEMO</span> are placeholder data to show how the system works. They are not real prices — edit them or remove them in Settings → Data.</div>' : '');
  function viewCrud(key) {
    const cfg = ENT[key], rs = crudRows(key);
    let needNote = '';
    if (key === 'materials') {
      const nc = DB.materials.filter((m) => !matReady(m)).length;
      if (nc) needNote = `<div class="notice info"><b>${nc} material${nc > 1 ? 's' : ''} still need${nc > 1 ? '' : 's'} a price or sheet size.</b> They can't be used in a calculation until they have both, so no cost is ever guessed. <span style="display:inline-flex;gap:6px;flex-wrap:wrap;margin-left:6px"><button class="btn sm" data-act="goto-matcosts">Type prices &amp; sizes in a table</button><button class="btn sm" data-act="toggle-needs">${state.needsOnly ? 'Show all' : 'Show only these'}</button></span></div>`;
    }
    return head(cfg.title, cfg.sub, canEdit() ? `<button class="btn primary" data-act="add-ent" data-ent="${key}">Add ${cfg.one}</button>` : '')
      + lockBanner() + needNote + demoBanner(key)
      + `<div class="card"><div class="toolbar"><input type="search" class="search" data-q="${key}" placeholder="Search ${cfg.title.toLowerCase()}…" value="${esc(state.q[key] || '')}" aria-label="Search"><span class="count" id="crudcount">${rs.count}</span></div><div class="tscroll"><table class="tbl"><thead><tr>${cfg.cols.map((c) => `<th class="${c.n ? 'n' : ''}">${c.h}</th>`).join('')}<th></th></tr></thead><tbody id="crudbody">${rs.html}</tbody></table></div></div>`;
  }

  /* ================= saved calculations ================= */
  function savedRows() {
    const q = (state.q.saved || '').toLowerCase();
    const rows = DB.calcs.filter((c) => !q || [c.id, c.name, c.product].some((x) => String(x || '').toLowerCase().includes(q)));
    return { count: `${rows.length} of ${DB.calcs.length}`, html: rows.map((c) => `<tr><td><b>${esc(c.id)}</b></td><td>${new Date(c.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td><td>${esc(c.name)}</td><td>${esc(c.product)}</td><td class="n">${U.f(c.quantity)}</td><td class="n">${money(c.total)}</td><td class="n">${perPieceFmt(c.perPiece)}</td><td class="rowact"><button class="lnk" data-act="open-calc" data-id="${c.id}">Open</button><button class="lnk" data-act="edit-calc" data-id="${c.id}">Edit</button><button class="lnk" data-act="dup-calc" data-id="${c.id}">Duplicate</button>${(canEdit() || c.createdBy === session.user.id) ? `<button class="lnk danger" data-act="del-calc" data-id="${c.id}">Delete</button>` : ''}</td></tr>`).join('') || `<tr><td class="empty" colspan="8">${DB.calcs.length ? 'Nothing matches your search.' : 'No saved calculations yet. Calculate a job and press “Save calculation”.'}</td></tr>` };
  }
  function viewSaved() {
    const rs = savedRows();
    return head('Saved calculations', 'Costing history shared by everyone signed in. Each entry keeps the job specification and the cost it produced on the day.', DB.calcs.length ? '<button class="btn" data-act="export-csv">Export CSV</button>' : '')
      + `<div class="card"><div class="toolbar"><input type="search" class="search" data-q="saved" placeholder="Search by ID, job name or product…" value="${esc(state.q.saved || '')}" aria-label="Search"><span class="count" id="crudcount">${rs.count}</span></div><div class="tscroll"><table class="tbl"><thead><tr><th>ID</th><th>Date</th><th>Job name</th><th>Product</th><th class="n">Quantity</th><th class="n">Total cost</th><th class="n">Cost / piece</th><th></th></tr></thead><tbody id="crudbody">${rs.html}</tbody></table></div></div>`;
  }
  function openCalc(id) {
    const c = find(DB.calcs, id); if (!c) return;
    const r = c.full;
    const body = r ? `<div class="figure">${r.layout.kind === 'sheet' ? sheetSVG(r.layout) : rollSVG(r.layout)}${requirementHTML(r)}</div>${breakdownHTML(r)}${formulaHTML(r)}` : '<p class="hint">No detailed breakdown was saved for this one.</p>';
    openModal(`<h2>${esc(c.id)} · ${esc(c.name)}</h2><dl class="kv" style="margin-bottom:14px"><dt>Date</dt><dd>${new Date(c.date).toLocaleString('en-GB')}</dd><dt>Product</dt><dd>${esc(c.product)}</dd><dt>Quantity</dt><dd>${U.f(c.quantity)}</dd><dt>Total production cost</dt><dd><b>${money(c.total)}</b></dd><dt>Cost per piece</dt><dd><b>${perPieceFmt(c.perPiece)}</b></dd>${c.job && c.job.notes ? `<dt>Notes</dt><dd>${esc(c.job.notes)}</dd>` : ''}</dl>${body}
      <div class="foot"><button class="btn" data-act="close">Close</button><button class="btn primary" data-act="edit-calc" data-id="${esc(c.id)}">Edit</button></div>`);
  }

  /* ================= settings ================= */
  function sIn(path, label, o) {
    o = o || {}; const v = getPath(DB.settings, path);
    return `<label class="f"><span>${label}</span><input data-s="${path}" type="${o.text ? 'text' : 'number'}" ${o.text ? '' : 'step="any"'} value="${esc(v)}"${o.text ? ' maxlength="6"' : ''}></label>`;
  }
  function quickTable(key, cols) {
    return `<div class="tscroll"><table class="tbl tight"><thead><tr><th>${key === 'labor' ? 'Labor category' : 'Name'}</th>${cols.map((c) => `<th class="n">${c[1]}</th>`).join('')}</tr></thead><tbody>${DB[key].map((r) => `<tr><td>${esc(r.name || r.category)}${demoTag(r)}</td>${cols.map((c) => `<td class="n" style="width:130px"><input type="number" step="any" data-q2="${key}.${r.id}.${c[0]}" value="${esc(r[c[0]])}"${canEdit() ? '' : ' disabled'} aria-label="${esc(c[1])}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function viewSettings() {
    const dis = canEdit() ? '' : ' disabled';
    const wr = Object.keys(E.MODES).map((k) => `<tr><td>${E.MODES[k]}</td><td class="n"><input type="number" step="any" data-s="waste.${k}.pct" value="${esc(DB.settings.waste[k].pct)}"${dis}></td><td class="n"><input type="number" step="any" data-s="waste.${k}.setup" value="${esc(DB.settings.waste[k].setup)}"${dis}></td><td class="n"><input type="number" step="any" data-s="waste.${k}.min" value="${esc(DB.settings.waste[k].min)}"${dis}></td></tr>`).join('');
    const sh = Object.keys(E.MODES).map((k) => `<label class="f"><span>${E.MODES[k].split(' (')[0]}</span><input data-s="printing.setupHours.${k}" type="number" step="any" value="${esc(DB.settings.printing.setupHours[k])}"${dis}></label>`).join('');
    const demoCount = ['materials', 'machines', 'finishing', 'labor'].reduce((a, k) => a + DB[k].filter((r) => r.demo).length, 0);
    return head('Settings', 'Everything the calculator uses lives here or in the rate databases, shared by your whole team. Nothing is hard-coded.')
      + lockBanner()
      + `<section class="card"><h3>Account</h3><dl class="kv"><dt>Signed in as</dt><dd>${esc(profile.displayName)} (${esc(session.user.email)})</dd><dt>Role</dt><dd>${profile.role === 'admin' ? 'Admin — can edit rates' : 'Staff — can calculate and save, not edit rates'}</dd></dl><div class="actions"><button class="btn" data-act="sign-out">Sign out</button></div></section>
        <section class="card"><h3>Currency &amp; display</h3><div class="grid"><label class="f"><span>Currency</span><input data-s="currency" type="text" maxlength="6" value="${esc(DB.settings.currency)}"${dis}></label>
          <label class="f"><span>Decimals for cost per piece</span><select data-s="unitDecimals"${dis}>${[2, 3, 4, 5].map((d) => opt(d, d, DB.settings.unitDecimals)).join('')}</select></label></div><p class="hint">No VAT, profit or selling price exists anywhere in this application.</p></section>
        <section class="card"><h3>Waste by production method <small>editable defaults</small></h3><div class="tscroll"><table class="tbl tight"><thead><tr><th>Method</th><th class="n">Waste %</th><th class="n">Fixed setup waste</th><th class="n">Minimum waste</th></tr></thead><tbody>${wr}</tbody></table></div>
          <p class="hint">Waste is counted in what physically gets spoiled: sheets for sheet jobs, meters for roll jobs. Percentage waste is rounded up to whole sheets; the minimum applies to the percentage part. Offset setup waste is per design (plate set).</p></section>
        <section class="card"><h3>Printing defaults</h3><div class="grid">${sIn('printing.plateCost', `Offset plate cost (${cur()} each)`)}${sIn('printing.offsetInkPer1000', `Offset ink per 1,000 colour-sides (${cur()})`)}${sIn('printing.areaInkPerSqm', `Large-format ink per m² (${cur()})`)}</div>
          <h4 style="margin:16px 0 8px;font-size:14px">Default machine setup time (hours)</h4><div class="grid">${sh}</div></section>
        <section class="card"><h3>Minimum charges <small>used when a material or operation has none of its own</small></h3><div class="grid">${sIn('minimums.material', `Minimum material charge per line (${cur()})`)}${sIn('minimums.finishing', `Minimum finishing charge per operation (${cur()})`)}</div></section>
        <section class="card"><h3>Machine rates</h3>${quickTable('machines', [['hourlyRate', 'Hourly rate'], ['setupRate', 'Setup rate'], ['speed', 'Speed']])}<p class="hint">Setup rate empty = same as hourly rate. Other machine fields are in Machines.</p></section>
        <section class="card"><h3>Labor rates</h3>${quickTable('labor', [['hourlyCost', 'Hourly cost']])}</section>
        <section class="card" id="matcosts"><h3>Material costs</h3>${quickTable('materials', [['sheetW', 'Sheet W (mm)'], ['sheetH', 'Sheet H (mm)'], ['rollWidth', 'Roll W (mm)'], ['purchaseCost', 'Purchase cost'], ['minCharge', 'Min. charge']])}<p class="hint">Purchase cost is per the material's unit (per sheet unless you changed it in Materials → Edit — e.g. per pack, per meter, per m²). Sheets need width and height; rolls need roll width.</p></section>
        <section class="card"><h3>Finishing rates</h3>${quickTable('finishing', [['rate', 'Rate'], ['setupCost', 'Setup cost'], ['minCharge', 'Min. charge']])}</section>
        ${canEdit() ? teamCard() : ''}
        <section class="card"><h3>Data</h3><p class="hint" style="margin-top:0">Materials, machines, finishing and labor are shared by everyone signed in — an edit here is visible to your whole team immediately.</p>
          <div class="actions"><button class="btn" data-act="export-json">Export a read-only backup</button>${canEdit() ? `<button class="btn danger" data-act="clear-demo">Remove all demo data (${demoCount})</button>` : ''}</div></section>`;
  }
  function teamCard() {
    return `<section class="card"><h3>Team</h3><p class="hint" style="margin-top:0">Anyone can sign up; the first person to sign up became admin. As an admin you can promote or demote anyone else here.</p><div id="teamlist" class="tscroll"><p class="hint">Loading…</p></div></section>`;
  }
  async function loadTeam() {
    const box = $('#teamlist'); if (!box) return;
    const { data, error } = await sb.from('profiles').select('*').order('display_name');
    if (error) { box.innerHTML = `<p class="err">${esc(friendlyDbError(error))}</p>`; return; }
    box.innerHTML = `<table class="tbl tight"><thead><tr><th>Name</th><th>Role</th><th></th></tr></thead><tbody>${data.map((p) => `<tr><td>${esc(p.display_name)}${p.id === session.user.id ? ' (you)' : ''}</td><td>${esc(p.role)}</td><td>${p.id === session.user.id ? '' : `<button class="lnk" data-act="toggle-role" data-id="${p.id}" data-role="${p.role === 'admin' ? 'staff' : 'admin'}">Make ${p.role === 'admin' ? 'staff' : 'admin'}</button>`}</td></tr>`).join('')}</tbody></table>`;
  }

  /* ================= test jobs ================= */
  function viewTests() {
    const tdb = Seed.build(), tj = Seed.testJobs(), res = tj.map((j) => E.calculate(j, tdb));
    const rowFor = (j, r) => { const s = r.summary, q = s.requirement, dp = s.kind === 'sheet' ? 0 : 3; return `<tr><td>${esc(j.name)}</td><td>${U.f(q.good, dp)} + ${U.f(q.waste, dp)} = ${U.f(q.total, dp)} ${s.kind === 'sheet' ? 'sheets' : 'm'}</td><td>${s.printing.plates != null ? `${U.f(s.printing.impressions)} impr., ${s.printing.plates} plates` : s.printing.clicks != null ? `${U.f(s.printing.clicks)} clicks` : `${U.f(s.printing.printedSqm, 1)} m²`}</td><td>${r.stages.map((x) => esc(x.name)).join(', ') || '—'}</td><td class="n">${U.f(s.labor.hours, 2)} h · ${U.m(s.labor.cost)}</td><td class="n">${U.m(s.machineCost)}</td><td class="n"><b>${U.m(r.total)}</b></td><td class="n"><b>${r.perPiece.toFixed(4)}</b></td></tr>`; };
    return head('Test jobs', 'The five reference jobs run through the same engine, using the built-in demo rates (not your database) so the numbers are repeatable.')
      + '<div class="notice">These use <b>demo</b> rates. The numbers are placeholders, useful for checking the maths — not real prices.</div>'
      + `<div class="card"><div class="tscroll"><table class="tbl"><thead><tr><th>Job</th><th>Material (good + waste)</th><th>Printing requirement</th><th>Finishing</th><th class="n">Labor</th><th class="n">Machine + setup</th><th class="n">Total (AED)</th><th class="n">Per piece</th></tr></thead><tbody>${tj.map((j, i) => rowFor(j, res[i])).join('')}</tbody></table></div></div>`
      + tj.map((j, i) => { const r = res[i]; return `<details class="card"><summary style="cursor:pointer;font-weight:650">${esc(j.name)} — AED ${U.m(r.total)} · ${r.perPiece.toFixed(4)} per piece</summary><div style="margin-top:12px" class="figure">${r.layout.kind === 'sheet' ? sheetSVG(r.layout) : rollSVG(r.layout)}${requirementHTML(r)}</div><div style="margin-top:14px">${breakdownHTML(r)}</div><div style="margin-top:12px">${formulaHTML(r)}</div><div class="actions" style="margin-top:12px"><button class="btn sm" data-act="load-test" data-i="${i}">Load into calculator</button></div></details>`; }).join('');
  }

  /* ================= auth screen ================= */
  function viewAuth() {
    const a = state.auth, signin = a.mode === 'signin';
    return `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px"><div class="card" style="max-width:380px;width:100%">
      <h1 style="font-size:20px;margin-bottom:4px">Production cost calculator</h1><p class="sub" style="margin-bottom:18px">${signin ? 'Sign in to your shop account.' : 'Create the first account, or join a shop that already uses this.'}</p>
      ${a.error ? `<div class="notice bad">${esc(a.error)}</div>` : ''}${a.notice ? `<div class="notice info">${esc(a.notice)}</div>` : ''}
      <form id="authform" class="grid" style="grid-template-columns:1fr">
        ${signin ? '' : '<label class="f"><span>Your name</span><input name="displayName" required autocomplete="name"></label>'}
        <label class="f"><span>Email</span><input name="email" type="email" required autocomplete="email"></label>
        <label class="f"><span>Password</span><input name="password" type="password" required minlength="6" autocomplete="${signin ? 'current-password' : 'new-password'}"></label>
        <button class="btn primary" type="submit" ${a.busy ? 'disabled' : ''}>${a.busy ? 'Please wait…' : signin ? 'Sign in' : 'Create account'}</button>
      </form>
      <p class="hint" style="margin-top:14px">${signin ? "New here?" : 'Already have an account?'} <button class="lnk" data-act="toggle-auth">${signin ? 'Create an account' : 'Sign in'}</button></p>
    </div></div>`;
  }

  /* ================= render ================= */
  const VIEWS = { calc: viewCalc, saved: viewSaved, materials: () => viewCrud('materials'), machines: () => viewCrud('machines'), finishing: () => viewCrud('finishing'), labor: () => viewCrud('labor'), settings: viewSettings, tests: viewTests };
  const NAV = [['calc', 'New calculation'], ['saved', 'Saved calculations'], ['materials', 'Materials'], ['machines', 'Machines'], ['finishing', 'Finishing'], ['labor', 'Labor'], ['settings', 'Settings'], ['tests', 'Test jobs']];
  function renderNav() {
    $('#nav').innerHTML = `<div class="brand"><b>Production cost calculator</b><span>${esc(profile.displayName)} · ${profile.role} · <button class="lnk" data-act="sign-out" style="padding:0;font-size:inherit">Sign out</button></span></div>` + NAV.map((n, i) => `${i === 2 || i === 6 ? '<div class="sep"></div>' : ''}<button data-view="${n[0]}"${state.view === n[0] ? ' aria-current="page"' : ''}>${n[1]}${n[0] === 'saved' ? `<span class="cnt">${DB.calcs.length}</span>` : ''}</button>`).join('');
  }
  function render() {
    if (!session) { document.querySelector('.app').style.display = 'none'; $('#authroot').innerHTML = viewAuth(); $('#authroot').style.display = ''; return; }
    document.querySelector('.app').style.display = ''; $('#authroot').style.display = 'none'; $('#authroot').innerHTML = '';
    renderNav();
    $('#view').innerHTML = VIEWS[state.view]();
    if (state.view === 'calc') recalc();
    if (state.view === 'settings' && canEdit()) loadTeam();
  }
  function go(v) { state.view = v; render(); window.scrollTo(0, 0); }

  /* ================= auth actions ================= */
  async function doAuth(mode, email, password, displayName) {
    state.auth.busy = true; state.auth.error = ''; state.auth.notice = ''; render();
    try {
      if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
        if (error) throw error;
        if (!data.session) { state.auth.busy = false; state.auth.notice = 'Check your email for a confirmation link, then sign in.'; state.auth.mode = 'signin'; render(); return; }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      // onAuthStateChange (registered below) takes it from here: hydrate() + render()
    } catch (e) {
      state.auth.busy = false; state.auth.error = e.message || 'Something went wrong.'; render();
    }
  }
  sb.auth.onAuthStateChange((event, sess) => {
    if (sess && (!session || session.user.id !== sess.user.id)) {
      session = sess;
      hydrate().then(() => { state.auth.busy = false; state.job = freshJob(); render(); })
        .catch((e) => { toast('Could not load the shared database: ' + friendlyDbError(e), 'warn'); });
    } else if (!sess && session) {
      session = null; profile = null; DB = null; render();
    }
  });

  /* ================= events ================= */
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'authform') {
      e.preventDefault();
      const f = new FormData(e.target);
      doAuth(state.auth.mode, f.get('email').trim(), f.get('password'), (f.get('displayName') || '').trim());
    }
  });
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-act="toggle-auth"]')) { state.auth.mode = state.auth.mode === 'signin' ? 'signup' : 'signin'; state.auth.error = ''; state.auth.notice = ''; render(); return; }
    const nav = e.target.closest('[data-view]'); if (nav) { go(nav.dataset.view); return; }
    if (e.target.id === 'modal') { closeModal(); return; }
    const t = e.target.closest('[data-act]'); if (!t) return;
    const a = t.dataset.act, d = t.dataset;
    switch (a) {
      case 'close': closeModal(); break;
      case 'sign-out': await sb.auth.signOut(); break;
      case 'new-job': state.job = freshJob(); state.editingId = null; state.editingUuid = null; state.savedTotal = null; render(); break;
      case 'add': {
        const rows = state.job[d.list];
        rows.push({ finishing: { finId: '', qty: '', mult: 1, scales: false }, labor: { laborId: '', hours: '', scales: false }, addMaterials: { materialId: '', qty: 1, scales: false }, other: { desc: '', qty: 1, unitCost: '', scales: false } }[d.list]);
        render(); break;
      }
      case 'del': state.job[d.list].splice(Number(d.i), 1); render(); break;
      case 'save-new': saveCalc(true); break;
      case 'save-calc': saveCalc(false); break;
      case 'toggle-needs': state.needsOnly = !state.needsOnly; render(); break;
      case 'goto-matcosts': state.view = 'settings'; render(); { const el = $('#matcosts'); if (el && el.scrollIntoView) el.scrollIntoView(); } break;
      case 'add-ent': openForm(d.ent); break;
      case 'edit-ent': openForm(d.ent, d.id); break;
      case 'save-ent': saveEnt(); break;
      case 'del-ent': {
        if (!canEdit()) { toast('Only an admin can edit rates.', 'warn'); break; }
        const r = find(DB[d.ent], d.id); const nm = r.name || r.category;
        modalCtx = { kind: 'del', ent: d.ent, id: d.id };
        openModal(`<h2>Delete ${esc(ENT[d.ent].one)}?</h2><p>“${esc(nm)}” will be removed for everyone. Saved calculations keep their own record of what it cost then.</p><div class="foot"><button class="btn" data-act="close">Keep it</button><button class="btn danger" data-act="confirm-del">Delete</button></div>`);
        break;
      }
      case 'confirm-del': { const c = modalCtx; DB[c.ent] = DB[c.ent].filter((x) => x.id !== c.id); save(); closeModal(); toast('Deleted.'); render(); break; }
      case 'open-calc': openCalc(d.id); break;
      case 'edit-calc': { const c = find(DB.calcs, d.id); if (!c) break; closeModal(); state.job = E.newJob(clone(c.job)); state.editingId = c.id; state.editingUuid = c._uuid; state.savedTotal = c.total; go('calc'); break; }
      case 'dup-calc': {
        const c = find(DB.calcs, d.id); if (!c) break;
        const j = clone(c.job); j.name = (j.name || c.name) + ' (copy)';
        const r = E.calculate(j, DB); if (!r.ok) { toast('Could not duplicate: the original job no longer calculates cleanly with current rates.', 'warn'); break; }
        const prevJob = state.job, prevEditing = state.editingId, prevUuid = state.editingUuid;
        state.job = j; state.editingId = null; state.editingUuid = null; state.result = r;
        await saveCalc(true);
        state.job = prevJob; state.editingId = prevEditing; state.editingUuid = prevUuid; recalc();
        break;
      }
      case 'del-calc': modalCtx = { kind: 'delcalc', id: d.id }; openModal(`<h2>Delete ${esc(d.id)}?</h2><p>This removes the saved calculation from the shared history.</p><div class="foot"><button class="btn" data-act="close">Keep it</button><button class="btn danger" data-act="confirm-delcalc">Delete</button></div>`); break;
      case 'confirm-delcalc': {
        const c = find(DB.calcs, modalCtx.id); if (!c) { closeModal(); break; }
        const { error } = await sb.from('calculations').delete().eq('id', c._uuid);
        if (error) { toast('Could not delete: ' + friendlyDbError(error), 'warn'); break; }
        DB.calcs = DB.calcs.filter((x) => x.id !== modalCtx.id);
        if (state.editingId === modalCtx.id) { state.editingId = null; state.editingUuid = null; state.savedTotal = null; }
        closeModal(); render(); break;
      }
      case 'export-csv': {
        const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
        const rows = [['ID', 'Date', 'Job name', 'Product', 'Quantity', 'Total cost', 'Cost per piece'].map(q).join(',')].concat(DB.calcs.map((c) => [c.id, c.date.slice(0, 10), c.name, c.product, c.quantity, c.total.toFixed(2), c.perPiece.toFixed(4)].map(q).join(',')));
        saveTextFile('saved-calculations.csv', rows.join('\n')); break;
      }
      case 'export-json': saveTextFile('production-cost-backup.json', JSON.stringify(DB, null, 2)); break;
      case 'clear-demo': modalCtx = { kind: 'cleardemo' }; openModal('<h2>Remove all demo data?</h2><p>Every row marked DEMO in Materials, Machines, Finishing and Labor will be deleted for everyone. Rows you added or edited stay. Saved calculations keep their own record of what it cost then.</p><div class="foot"><button class="btn" data-act="close">Keep it</button><button class="btn danger" data-act="confirm-cleardemo">Remove demo data</button></div>'); break;
      case 'confirm-cleardemo': ['materials', 'machines', 'finishing', 'labor'].forEach((k) => { DB[k] = DB[k].filter((r) => !r.demo); }); state.job = freshJob(); save(); closeModal(); toast('Demo data removed.'); render(); break;
      case 'toggle-role': {
        const { error } = await sb.from('profiles').update({ role: d.role }).eq('id', d.id);
        if (error) { toast('Could not change that: ' + friendlyDbError(error), 'warn'); break; }
        toast('Role updated.'); loadTeam(); break;
      }
      case 'load-test': { const j = Seed.testJobs()[Number(d.i)]; const { job, cleared } = sanitizeTestJob(clone(j)); state.job = job; state.editingId = null; state.editingUuid = null; state.savedTotal = null; if (!find(DB.materials, job.materialId) || !find(DB.machines, job.machineId) || cleared) toast('Some demo rates from this test job are not in your database yet — those rows were left blank.', 'warn'); go('calc'); break; }
    }
  });

  function onField(e) {
    const t = e.target;
    if (t.id === 'cmpq') { state.cmp = t.value; paintCompare(); return; }
    if (t.dataset.q) { state.q[t.dataset.q] = t.value; const rs = t.dataset.q === 'saved' ? savedRows() : crudRows(t.dataset.q); $('#crudbody').innerHTML = rs.html; $('#crudcount').textContent = rs.count; return; }
    if (t.dataset.d && modalCtx && modalCtx.kind === 'form') {
      modalCtx.draft[t.dataset.d] = t.value;
      if (t.dataset.dr && e.type === 'change') { $('#formbody').innerHTML = formBody(modalCtx.key, modalCtx.draft); }
      else if (modalCtx.key === 'materials') { const box = $('.notice.info', $('#formbody')); if (box) { const dv = E.matDerived(modalCtx.draft), c = (x, u) => (x == null ? '—' : `${U.f(x, 4)} ${cur()}${u}`); box.innerHTML = `<b>Worked out from the purchase cost:</b> ${c(dv.perSheet, ' / sheet')} · ${c(dv.perMeter, ' / m')} · ${c(dv.perSqm, ' / m²')}`; } }
      return;
    }
    if (t.dataset.s) {
      if (e.type !== 'change') return;
      if (!canEdit()) { toast('Only an admin can edit rates.', 'warn'); render(); return; }
      const p = t.dataset.s;
      if (p === 'currency') { DB.settings.currency = t.value.trim() || 'AED'; }
      else if (p === 'unitDecimals') { DB.settings.unitDecimals = Number(t.value); }
      else { const v = Number(t.value); if (t.value === '' || !Number.isFinite(v) || v < 0) { toast('Enter a number that is 0 or more.', 'warn'); t.value = getPath(DB.settings, p); return; } setPath(DB.settings, p, v); }
      save(); toast('Saved.'); return;
    }
    if (t.dataset.q2) {
      if (e.type !== 'change') return;
      const [key, id, field] = t.dataset.q2.split('.'); const rec = find(DB[key], id); if (!rec) return;
      if (t.value === '') { if (['setupRate', 'minCharge', 'setupCost', 'sheetW', 'sheetH', 'rollWidth'].includes(field)) rec[field] = ''; else { toast('This value cannot be empty.', 'warn'); t.value = rec[field]; return; } }
      else { const v = Number(t.value); if (!Number.isFinite(v) || v < 0) { toast('Enter a number that is 0 or more.', 'warn'); t.value = rec[field]; return; } rec[field] = v; }
      save(); toast('Saved.'); return;
    }
    if (t.dataset.k) {
      const k = t.dataset.k, v = t.type === 'checkbox' ? t.checked : t.value;
      setPath(state.job, k, v);
      if (e.type === 'change' && t.dataset.r) {
        if (k === 'product') { const pm = PRODUCT_MODE[v]; if (pm) state.job.mode = pm; else if (state.job.mode !== 'offset' && state.job.mode !== 'digital') state.job.mode = 'digital'; if (E.BOOK.includes(v)) state.job.sides = 2; autoPick(state.job); }
        if (k === 'mode') { autoPick(state.job); if (v !== 'sticker') { state.job.shape = 'rect'; state.job.cutFinId = ''; state.job.lamFinId = ''; } }
        render();
      } else if (e.type === 'input' || e.type === 'change') recalc();
    }
  }
  document.addEventListener('input', onField);
  document.addEventListener('change', (e) => {
    if (e.target.id === 'loadtest') { if (e.target.value === '') return; const j = Seed.testJobs()[Number(e.target.value)]; const { job, cleared } = sanitizeTestJob(clone(j)); state.job = job; state.editingId = null; state.editingUuid = null; state.savedTotal = null; if (!find(DB.materials, job.materialId) || !find(DB.machines, job.machineId) || cleared) toast('Some demo rates from this test job are not in your database yet — those rows were left blank.', 'warn'); render(); return; }
    if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT' || e.target.dataset.s || e.target.dataset.q2) onField(e);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal').classList.contains('open')) closeModal(); });

  window.__PPCC = { state, DB: () => DB, render, go, recalc, session: () => session, profile: () => profile };
  render();
  // onAuthStateChange fires for an existing session in most browsers, but check explicitly in case it doesn't.
  sb.auth.getSession().then(({ data }) => { if (data.session && !session) { session = data.session; hydrate().then(() => { state.job = freshJob(); render(); }).catch((e) => toast('Could not load the shared database: ' + friendlyDbError(e), 'warn')); } });
})();
