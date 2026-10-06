/* ============================================================================
   PRINTING PRESS PRODUCTION COST ENGINE
   Pure functions only. No DOM, no storage, no hard-coded prices.
   Every rate comes from the `db` object you pass in (materials, machines,
   finishing, labor, settings).  All sizes are converted to millimetres inside.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- constants ---------- */
  const UNIT_MM = { mm: 1, cm: 10, m: 1000 };
  const EPS = 1e-9;
  const LIMIT = 1e9;            // no single input may exceed this
  const TOTAL_LIMIT = 1e12;     // no total may exceed this (also keeps cent rounding exact)
  const BOOK = ['Booklet', 'Book'];
  const PRODUCT_TYPES = ['Business Card', 'Flyer', 'Brochure', 'Booklet', 'Book', 'Letterhead', 'Envelope', 'NCR', 'Poster', 'Sticker', 'Label', 'Banner', 'Roll-up', 'Menu', 'Packaging', 'Box', 'Certificate', 'Invitation', 'Large Format', 'Custom'];
  const MODES = { offset: 'Offset', digital: 'Digital', large_format: 'Large format', sticker: 'Sticker (roll or sheet + cutting)' };
  const MODE_MACHINES = { offset: ['offset'], digital: ['digital'], large_format: ['large_format', 'uv'], sticker: ['digital', 'large_format', 'uv'] };
  const FIN_METHODS = { per_piece: 'Per piece', per_sheet: 'Per sheet', per_meter: 'Per meter', per_sqm: 'Per m²', per_hour: 'Per hour', fixed: 'Fixed per job' };
  const MAT_UNITS = { sheet: 'Per sheet', pack: 'Per pack of sheets', meter: 'Per meter', sqm: 'Per m²', roll: 'Per roll', kg: 'Per kg', litre: 'Per litre', piece: 'Per piece' };
  const MAT_CATS = ['Paper', 'Card', 'Sticker', 'Vinyl', 'PVC', 'Banner', 'Fabric', 'Film', 'Packaging', 'Ink', 'Hardware', 'Other'];
  const MACHINE_TYPES = { offset: 'Offset press', digital: 'Digital printer', large_format: 'Large-format printer', uv: 'UV printer', laminator: 'Laminator', guillotine: 'Guillotine', cutting_plotter: 'Cutting plotter', die_cutter: 'Die-cutting machine', laser: 'Laser machine' };
  const MACHINE_FIELDS = {
    offset: ['hourlyRate', 'setupRate', 'speed', 'colorUnits', 'costPerImpression'],
    digital: ['hourlyRate', 'setupRate', 'speed', 'clickColor', 'clickBW', 'costPerImpression'],
    large_format: ['hourlyRate', 'setupRate', 'speed', 'costPerSqm'],
    uv: ['hourlyRate', 'setupRate', 'speed', 'costPerSqm'],
    laminator: ['hourlyRate', 'setupRate', 'speed'],
    guillotine: ['hourlyRate', 'setupRate', 'speed'],
    cutting_plotter: ['hourlyRate', 'setupRate', 'speed'],
    die_cutter: ['hourlyRate', 'setupRate', 'speed', 'costPerImpression'],
    laser: ['hourlyRate', 'setupRate', 'speed', 'costPerSqm']
  };
  const SPEED_UNIT = { offset: 'impressions / hour', digital: 'impressions / hour', large_format: 'm² / hour', uv: 'm² / hour', laminator: 'm / hour', guillotine: 'cuts / hour', cutting_plotter: 'm / hour', die_cutter: 'sheets / hour', laser: 'm / hour' };
  const CATEGORIES = ['material', 'printing', 'finishing', 'labor', 'machine', 'setup', 'waste', 'other'];

  /* ---------- tiny helpers ---------- */
  const isBlank = (v) => v === '' || v === null || v === undefined;
  const isNumeric = (v) => isBlank(v) || (typeof v !== 'boolean' && String(v).trim() !== '' && Number.isFinite(Number(v)));
  const num = (v, d = 0) => { if (isBlank(v)) return d; const x = Number(v); return Number.isFinite(x) ? x : d; };
  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const fl = (x) => Math.floor(x + EPS);
  const ce = (x) => Math.max(Math.ceil(x - EPS), x > 0 ? 1 : 0);   // a positive amount always needs at least 1
  const f = (x, dp = 2) => (Number.isFinite(x) ? Number(x.toFixed(dp)).toLocaleString('en-US', { maximumFractionDigits: dp }) : '—');
  const m = (x) => (Number.isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
  const find = (arr, id) => (arr || []).find((x) => x.id === id);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------- defaults ---------- */
  function defaultSettings() {
    return {
      currency: 'AED',
      unitDecimals: 3,
      waste: {
        offset: { pct: 10, setup: 20, min: 0 },
        digital: { pct: 5, setup: 3, min: 0 },
        large_format: { pct: 5, setup: 1, min: 0 },
        sticker: { pct: 10, setup: 0.5, min: 0 }
      },
      printing: {
        plateCost: 15,
        offsetInkPer1000: 1,
        areaInkPerSqm: 2,
        setupHours: { offset: 0.5, digital: 0.1, large_format: 0.25, sticker: 0.25 }
      },
      minimums: { material: 0, finishing: 0 }
    };
  }

  function newJob(o) {
    return Object.assign({
      id: null, name: '', product: 'Business Card', mode: 'digital', qty: 1000,
      w: 90, h: 55, unit: 'mm', ow: '', oh: '', pages: '', sides: 1, bleed: 3, notes: '',
      materialId: '', machineId: '',
      pressW: '', pressH: '', parentDivisor: 1,
      margin: 5, gripper: 0, gutter: 0, rollEdge: 0,
      colors: 4, colorMode: 'color', plates: '', plateCost: '', inkRate: '',
      setupHours: '', speed: '', clickColor: '', clickBW: '', inkSqm: '', machineSqm: '',
      wastePct: '', setupWaste: '', extraWaste: 0,
      shape: 'rect', diameter: '', cutLen: '', cutFinId: '', lamFinId: '',
      setsPerPad: '', finishing: [], labor: [], addMaterials: [], other: []
    }, o || {});
  }

  /* ---------- materials ---------- */
  function materialMode(mat) {
    const rw = num(mat.rollWidth), sw = num(mat.sheetW), sh = num(mat.sheetH);
    if (mat.unit === 'sheet' || mat.unit === 'pack') return 'sheet';
    if (rw > 0) return 'roll';
    if (sw > 0 && sh > 0) return 'sheet';
    return 'unknown';
  }

  /* Turns "purchase cost + unit" into cost per sheet / per meter / per m². */
  function matDerived(mat) {
    if (isBlank(mat.purchaseCost)) return { perSheet: null, perMeter: null, perSqm: null, perUnit: null, mode: materialMode(mat) };   // no price yet: never pretend it is 0
    const sw = num(mat.sheetW), sh = num(mat.sheetH), rw = num(mat.rollWidth), rl = num(mat.rollLength);
    const pc = num(mat.purchaseCost), pack = Math.max(1, num(mat.packSize, 1));
    const sheetArea = (sw * sh) / 1e6, rwm = rw / 1000;
    let perSheet = null, perMeter = null, perSqm = null, perUnit = null;
    switch (mat.unit) {
      case 'sheet': perSheet = pc; break;
      case 'pack': perSheet = pc / pack; break;
      case 'meter': perMeter = pc; break;
      case 'sqm': perSqm = pc; break;
      case 'roll': if (rl > 0) perMeter = pc / rl; break;
      case 'kg': case 'litre': case 'piece': perUnit = pc; break;   // bought and used by the same unit (ink, hardware) — no sheet/roll geometry involved
    }
    if (perSqm === null && perSheet !== null && sheetArea > 0) perSqm = perSheet / sheetArea;
    if (perSqm === null && perMeter !== null && rwm > 0) perSqm = perMeter / rwm;
    if (perSqm !== null) {
      if (perSheet === null && sheetArea > 0) perSheet = perSqm * sheetArea;
      if (perMeter === null && rwm > 0) perMeter = perSqm * rwm;
    }
    return { perSheet, perMeter, perSqm, perUnit, mode: materialMode(mat) };
  }

  /* Unit used for "other material" lines: what one unit of quantity costs. */
  function matBasis(mat) {
    const d = matDerived(mat);
    switch (mat.unit) {
      case 'sheet': case 'pack': return { label: 'sheet', cost: d.perSheet };
      case 'meter': case 'roll': return { label: 'm', cost: d.perMeter };
      case 'sqm': return { label: 'm²', cost: d.perSqm };
      case 'kg': return { label: 'kg', cost: d.perUnit };
      case 'litre': return { label: 'L', cost: d.perUnit };
      case 'piece': return { label: 'piece', cost: d.perUnit };
    }
    return { label: 'unit', cost: null };
  }

  function materialUnitCost(mat, kind, sw, sh, divisor) {
    const d = matDerived(mat);
    if (kind === 'roll') return d.perMeter == null ? null : { cost: d.perMeter, label: 'm', note: '' };
    let cost = null, note = '';
    if (mat.unit === 'sheet' || mat.unit === 'pack') {
      cost = d.perSheet;
      if (divisor > 1) { cost = cost / divisor; note = ` ÷ ${f(divisor)} press sheets per purchased sheet`; }
    } else if (d.perSqm != null && sw > 0 && sh > 0) cost = (d.perSqm * sw * sh) / 1e6;
    return cost == null ? null : { cost, label: 'sheet', note };
  }

  /* ---------- imposition (how many pieces fit) ---------- */
  function evalSheet(pw, ph, printW, printH, bleed, gutter) {
    const cw = pw + 2 * bleed, ch = ph + 2 * bleed;
    const across = printW >= cw ? fl((printW + gutter) / (cw + gutter)) : 0;
    const down = printH >= ch ? fl((printH + gutter) / (ch + gutter)) : 0;
    return { pw, ph, cw, ch, across, down, ups: across * down };
  }

  /* Sheet: printable area = sheet - margin on all 4 edges - gripper (one edge).
     A piece occupies (size + 2 x bleed); neighbours are separated by `gutter`.
     Tests piece upright (A) and rotated 90 degrees (B), keeps the better yield. */
  function imposeSheet(p) {
    const margin = num(p.margin), grip = num(p.gripper), bleed = num(p.bleed), gutter = num(p.gutter);
    const printW = p.sheetW - 2 * margin, printH = p.sheetH - 2 * margin - grip;
    const A = evalSheet(p.pieceW, p.pieceH, printW, printH, bleed, gutter); A.orientation = 'A';
    const B = evalSheet(p.pieceH, p.pieceW, printW, printH, bleed, gutter); B.orientation = 'B';
    const best = B.ups > A.ups ? B : A;
    const usedW = best.across ? best.across * best.cw + (best.across - 1) * gutter : 0;
    const usedH = best.down ? best.down * best.ch + (best.down - 1) * gutter : 0;
    const util = ((p.pieceW * p.pieceH * best.ups) / (p.sheetW * p.sheetH)) * 100;
    return { best, A, B, printW, printH, usedW, usedH, ups: best.ups, orientation: best.orientation, across: best.across, down: best.down, utilisation: util };
  }

  /* Roll: pieces across the usable roll width, rows along the roll.
     Tests both orientations and keeps the one that needs the shortest length. */
  function imposeRoll(p) {
    const bleed = num(p.bleed), gutter = num(p.gutter);
    const opts = [];
    [false, true].forEach((rot) => {
      const pw = rot ? p.pieceH : p.pieceW, ph = rot ? p.pieceW : p.pieceH;
      const cw = pw + 2 * bleed, ch = ph + 2 * bleed;
      if (cw > p.usableW + EPS) return;
      const across = fl((p.usableW + gutter) / (cw + gutter));
      if (across < 1) return;
      const rows = ce(p.qty / across);
      const length = rows * ch + (rows - 1) * gutter;
      opts.push({ orientation: rot ? 'B' : 'A', pw, ph, cw, ch, across, rows, length, lastRow: p.qty - (rows - 1) * across });
    });
    if (!opts.length) return null;
    opts.sort((a, b) => a.length - b.length || (a.orientation === 'A' ? -1 : 1));
    return { best: opts[0], options: opts };
  }

  /* ---------- validation ---------- */
  function layoutKind(job, mat, isBook) {
    const hasPress = num(job.pressW) > 0 && num(job.pressH) > 0;
    return (isBook || !mat || materialMode(mat) !== 'roll' || hasPress) ? 'sheet' : 'roll';
  }

  function validate(job, db) {
    const errors = [], warnings = [];
    const err = (field, msg) => errors.push({ field, msg });
    const chk = (obj, key, label, o, field) => {
      o = o || {}; field = field || key;
      const v = obj[key];
      if (isBlank(v)) { if (o.required) err(field, `${label} is required.`); return; }
      if (!isNumeric(v)) return err(field, `${label} must be a number.`);
      const x = Number(v);
      if (o.int && !Number.isInteger(x)) return err(field, `${label} must be a whole number.`);
      if (o.gt !== undefined && !(x > o.gt)) return err(field, `${label} must be greater than ${o.gt}.`);
      if (o.min !== undefined && x < o.min) return err(field, o.min === 0 ? `${label} cannot be negative.` : `${label} must be at least ${o.min}.`);
      if (o.max !== undefined && x > o.max) return err(field, `${label} cannot be more than ${o.max}.`);
      if (Math.abs(x) > LIMIT) return err(field, `${label} is unrealistically large (over ${LIMIT.toLocaleString('en-US')}). Check for an extra zero.`);
    };
    const circle = job.mode === 'sticker' && job.shape === 'circle';
    const isBook = BOOK.includes(job.product);

    chk(job, 'setsPerPad', 'Sets per pad/book', { int: true, gt: 0 });
    chk(job, 'qty', 'Quantity', { required: true, int: true, gt: 0 });
    if (!(job.unit in UNIT_MM)) err('unit', 'Choose mm, cm or meter.');
    if (circle) chk(job, 'diameter', 'Diameter', { required: true, gt: 0 });
    else { chk(job, 'w', 'Finished width', { required: true, gt: 0 }); chk(job, 'h', 'Finished height', { required: true, gt: 0 }); }
    chk(job, 'ow', 'Open width', { gt: 0 }); chk(job, 'oh', 'Open height', { gt: 0 });
    if (isBlank(job.ow) !== isBlank(job.oh)) err(isBlank(job.ow) ? 'ow' : 'oh', 'Enter both open width and open height, or leave both empty.');
    chk(job, 'pages', 'Pages', { int: true, min: 0 });
    if (isBook) {
      if (!(num(job.pages) >= 4)) err('pages', 'Booklets and books need at least 4 pages.');
      else if (num(job.pages) % 4 !== 0) warnings.push(`Pages (${num(job.pages)}) is not a multiple of 4 — calculated as ${Math.ceil(num(job.pages) / 4) * 4} pages.`);
    }
    if (![1, 2].includes(Number(job.sides))) err('sides', 'Sides must be 1 or 2.');
    ['bleed', 'margin', 'gripper', 'gutter', 'rollEdge'].forEach((k) => chk(job, k, { bleed: 'Bleed', margin: 'Margin', gripper: 'Gripper', gutter: 'Gap', rollEdge: 'Roll edge margin' }[k], { min: 0 }));
    chk(job, 'colors', 'Number of colours', { int: true, min: 0 });
    chk(job, 'plates', 'Number of plates', { int: true, min: 0 });
    ['plateCost', 'inkRate', 'setupHours', 'clickColor', 'clickBW', 'inkSqm', 'machineSqm', 'extraWaste', 'setupWaste', 'cutLen'].forEach((k) => chk(job, k, 'This value', { min: 0 }));
    chk(job, 'speed', 'Machine speed', { gt: 0 });
    chk(job, 'wastePct', 'Waste %', { min: 0, max: 100 });
    chk(job, 'pressW', 'Press sheet width', { gt: 0 }); chk(job, 'pressH', 'Press sheet height', { gt: 0 });
    if (isBlank(job.pressW) !== isBlank(job.pressH)) err(isBlank(job.pressW) ? 'pressW' : 'pressH', 'Enter both press sheet width and height, or leave both empty.');
    chk(job, 'parentDivisor', 'Press sheets per purchased sheet', { gt: 0 });

    (job.finishing || []).forEach((r, i) => {
      chk(r, 'qty', 'Quantity', { min: 0 }, `finishing.${i}.qty`);
      chk(r, 'mult', 'Multiplier', { gt: 0 }, `finishing.${i}.mult`);
      if (r.finId && !find(db.finishing, r.finId)) err(`finishing.${i}.finId`, 'This finishing operation no longer exists.');
    });
    (job.labor || []).forEach((r, i) => {
      chk(r, 'hours', 'Hours', { min: 0 }, `labor.${i}.hours`);
      if (r.laborId && !find(db.labor, r.laborId)) err(`labor.${i}.laborId`, 'This labor category no longer exists.');
    });
    (job.addMaterials || []).forEach((r, i) => {
      const role = r.role || 'manual';
      if (!['manual', 'ncr', 'lamination', 'mounting', 'cover'].includes(role)) err(`addMaterials.${i}.role`, 'Choose a valid material purpose.');
      if (role !== 'manual' && !r.materialId) err(`addMaterials.${i}.materialId`, 'Choose a material for this production layer.');
      if (r.feed && !['web','pieces'].includes(r.feed)) err(`addMaterials.${i}.feed`, 'Choose continuous roll or separate pieces.');
      if (role === 'ncr' && job.product !== 'NCR') err(`addMaterials.${i}.role`, 'NCR layers require the NCR product type.');
      if (role === 'cover' && !(num(job.setsPerPad) > 0)) err('setsPerPad', 'Enter sets per pad/book to calculate covers.');
      chk(r, 'wastePct', 'Material waste %', { min: 0, max: 100 }, `addMaterials.${i}.wastePct`);
      chk(r, 'setupWaste', 'Material setup waste', { min: 0 }, `addMaterials.${i}.setupWaste`);
      chk(r, 'opQty', 'Processing quantity', { min: 0 }, `addMaterials.${i}.opQty`);
      if (r.finId && !find(db.finishing, r.finId)) err(`addMaterials.${i}.finId`, 'This processing operation no longer exists.');
      if (r.sides && ![1,2].includes(Number(r.sides))) err(`addMaterials.${i}.sides`, 'Choose one or two printed sides.');
      chk(r, 'plates', 'Layer plates', {int: true, min: 0}, `addMaterials.${i}.plates`);
      chk(r, 'setupHours', 'Layer setup hours', {min: 0}, `addMaterials.${i}.setupHours`);
      chk(r, 'colors', 'Layer colours', { int: true, min: 0 }, `addMaterials.${i}.colors`);
      if (role === 'ncr' && job.mode === 'offset' && r.printed !== false && !isBlank(r.colors) && num(r.colors) < 1) err(`addMaterials.${i}.colors`, 'Printed offset layers need at least one colour.');
      chk(r, 'qty', 'Quantity', role === 'manual' ? {min: 0} : {gt: 0}, `addMaterials.${i}.qty`);
      if (role !== 'manual' && !isBlank(r.qty) && find(db.materials, r.materialId) && materialMode(find(db.materials, r.materialId)) === 'sheet' && !Number.isInteger(Number(r.qty))) err(`addMaterials.${i}.qty`, 'Sheet overrides must be whole sheets.');
      const mm = r.materialId ? find(db.materials, r.materialId) : null;
      if (r.materialId && !mm) err(`addMaterials.${i}.materialId`, 'This material no longer exists.');
      if (mm && isBlank(mm.purchaseCost)) err(`addMaterials.${i}.materialId`, `"${mm.name}" has no price yet. Enter its purchase cost in Materials.`);
      else if (mm && matBasis(mm).cost == null) err(`addMaterials.${i}.materialId`, 'This material has no usable price. Fix it in Materials.');
    });
    (job.other || []).forEach((r, i) => {
      chk(r, 'qty', 'Quantity', { min: 0 }, `other.${i}.qty`);
      chk(r, 'unitCost', 'Unit cost', { min: 0 }, `other.${i}.unitCost`);
    });

    [{materialId: job.materialId, field: 'materialId'}].concat((job.addMaterials || []).map((r,i) => ({materialId:r.materialId,field:`addMaterials.${i}.materialId`}))).forEach(({materialId,field}) => {
      const stock = find(db.materials, materialId);
      if (stock && stock.unit === 'pack' && !(Number.isInteger(Number(stock.packSize)) && Number(stock.packSize) >= 1)) err(field, `Material "${stock.name}" needs a confirmed whole number of sheets per pack. Edit its purchase unit and pack size in Materials.`);
    });
    const mat = find(db.materials, job.materialId), mach = find(db.machines, job.machineId);
    if (!job.materialId) err('materialId', 'Choose a material.'); else if (!mat) err('materialId', 'This material no longer exists.');
    if (!job.machineId) err('machineId', 'Choose a machine.'); else if (!mach) err('machineId', 'This machine no longer exists.');

    if (mach) {
      const okTypes = MODE_MACHINES[job.mode] || [];
      if (!okTypes.includes(mach.type)) err('machineId', `${MODES[job.mode] || 'This'} printing needs a ${okTypes.map((t) => MACHINE_TYPES[t]).join(' or ').toLowerCase()}.`);
      ['hourlyRate', 'setupRate', 'speed', 'costPerSqm', 'costPerImpression', 'clickColor', 'clickBW'].forEach((k) => {
        if (!isBlank(mach[k]) && (!isNumeric(mach[k]) || Number(mach[k]) < 0)) err('machineId', `Machine "${mach.name}" has an invalid ${k}. Fix it in Machines.`);
      });
    }
    if (mat) {
      if (job.product === 'NCR' && materialMode(mat) !== 'sheet') err('materialId', 'The original NCR part needs sheet stock.');
      if (isBlank(mat.purchaseCost)) err('materialId', `Material "${mat.name}" has no price yet. Enter its purchase cost in Materials (or Settings → Material costs) before using it.`);
      if (!isBlank(mat.purchaseCost) && (!isNumeric(mat.purchaseCost) || Number(mat.purchaseCost) < 0)) err('materialId', `Material "${mat.name}" has an invalid price. Fix it in Materials.`);
      const hasPress = num(job.pressW) > 0 && num(job.pressH) > 0;
      const kind0 = layoutKind(job, mat, isBook);
      const sw0 = hasPress ? num(job.pressW) : num(mat.sheetW), sh0 = hasPress ? num(job.pressH) : num(mat.sheetH);
      if (materialMode(mat) === 'unknown' && !hasPress) err('materialId', `Material "${mat.name}" has no sheet size or roll width yet. Enter it in Materials (or Settings → Material costs).`);
      else if (kind0 === 'sheet' && !(sw0 > 0 && sh0 > 0)) err('materialId', `Material "${mat.name}" has no sheet size yet. Enter its width and height in Materials (or Settings → Material costs).`);
      const kind = layoutKind(job, mat, isBook);
      const costingType = mach ? (mach.type === 'offset' ? 'offset' : mach.type === 'digital' ? 'digital' : 'area') : null;
      if (isBook && materialMode(mat) === 'roll' && !hasPress) err('materialId', 'Booklets and books need sheet material (or a press sheet size).');
      else if ((costingType === 'offset' || costingType === 'digital') && kind === 'roll') err('materialId', 'Offset and digital sheet printing need sheet material. Pick a sheet material, or enter a press sheet size.');
      else if (!errors.some((e) => e.field === 'materialId')) {
        const sw = hasPress ? num(job.pressW) : num(mat.sheetW), sh = hasPress ? num(job.pressH) : num(mat.sheetH);
        if (!materialUnitCost(mat, kind, sw, sh, num(job.parentDivisor, 1))) err('materialId', `Material "${mat.name}" cannot be priced for ${kind === 'roll' ? 'a roll layout' : 'a sheet layout'} (missing roll length, roll width or sheet size).`);
      }
    }
    if (mach && job.mode === 'offset' && !(num(job.colors) >= 1)) err('colors', 'Offset printing needs at least 1 colour.');
    return { errors, warnings };
  }

  /* ---------- the calculation ---------- */
  function calculate(job, db) {
    const res = {
      ok: false, errors: [], warnings: [], qty: num(job.qty), layout: null, summary: null, stages: [],
      lines: { material: [], printing: [], finishing: [], labor: [], machine: [], setup: [], waste: [], other: [] },
      subtotals: { material: 0, printing: 0, finishing: 0, labor: 0, machine: 0, setup: 0, waste: 0, other: 0 }, total: 0, perPiece: 0
    };
    const v = validate(job, db);
    res.errors = v.errors; res.warnings = v.warnings;
    if (res.errors.length) return res;
    try { body(job, db, res); } catch (e) { res.errors.push({ field: '', msg: 'Calculation error: ' + e.message }); }
    if (!res.errors.length) {
      const bad = [res.total, res.perPiece].concat(Object.values(res.subtotals)).some((x) => !Number.isFinite(x));
      if (bad) res.errors.push({ field: '', msg: 'The calculation produced an invalid number. Check rates and quantities.' });
      else if (res.total > TOTAL_LIMIT) res.errors.push({ field: '', msg: `The total is unrealistically large (over ${TOTAL_LIMIT.toLocaleString('en-US')}). Check quantities and rates for an extra zero.` });
    }
    res.ok = res.errors.length === 0;
    if (!res.ok) { res.total = 0; res.perPiece = 0; CATEGORIES.forEach((c) => { res.subtotals[c] = 0; }); }
    return res;
  }

  function body(job, db, res) {
    const S = db.settings || defaultSettings();
    const P = S.printing || defaultSettings().printing;
    const mat = find(db.materials, job.materialId), mach = find(db.machines, job.machineId);
    const qty = num(job.qty);
    const u = UNIT_MM[job.unit] || 1;
    const circle = job.mode === 'sticker' && job.shape === 'circle';
    const W = (circle ? num(job.diameter) : num(job.w)) * u;
    const H = (circle ? num(job.diameter) : num(job.h)) * u;
    const isBook = BOOK.includes(job.product);
    let OW = num(job.ow) * u, OH = num(job.oh) * u, openAuto = false;
    if (isBook && !(OW > 0 && OH > 0)) { OW = 2 * W; OH = H; openAuto = true; }
    const useOpen = OW > 0 && OH > 0;
    const pieceW = useOpen ? OW : W, pieceH = useOpen ? OH : H;
    const bleed = num(job.bleed), gutter = num(job.gutter), margin = num(job.margin), gripper = num(job.gripper);
    const sides = isBook ? 2 : Number(job.sides) || 1;
    const pages = isBook ? Math.ceil(num(job.pages) / 4) * 4 : 0;
    const flats = isBook ? pages / 4 : 1;          // each flat = one open-size sheet printed both sides = 4 pages
    const costing = mach.type === 'offset' ? 'offset' : mach.type === 'digital' ? 'digital' : 'area';
    const hasPress = num(job.pressW) > 0 && num(job.pressH) > 0;
    const kind = layoutKind(job, mat, isBook);
    const sheetW = hasPress ? num(job.pressW) : num(mat.sheetW), sheetH = hasPress ? num(job.pressH) : num(mat.sheetH);
    const divisor = Math.max(num(job.parentDivisor, 1), 1);
    const uc = materialUnitCost(mat, kind, sheetW, sheetH, divisor);
    const rollW = num(mat.rollWidth);

    /* ---- waste settings (by production method, per-job overrides) ---- */
    const WS = (S.waste && S.waste[job.mode]) || { pct: 0, setup: 0, min: 0 };
    const wastePct = isBlank(job.wastePct) ? num(WS.pct) : num(job.wastePct);
    const setupPerRun = isBlank(job.setupWaste) ? num(WS.setup) : num(job.setupWaste);
    const minWaste = num(WS.min), extraWaste = num(job.extraWaste);
    const runs = costing === 'offset' ? flats : 1;
    const rU = kind === 'sheet' ? Math.ceil : (x) => x;

    /* ---- layout + units of material ---- */
    let goodU, unitName, unitWord, layout;
    if (kind === 'sheet') {
      const imp = imposeSheet({ pieceW, pieceH, sheetW, sheetH, margin, gripper, bleed, gutter });
      if (imp.ups < 1) {
        res.errors.push({ field: 'w', msg: `A piece of ${f(pieceW)} × ${f(pieceH)} mm (+ ${f(bleed)} mm bleed) does not fit inside the printable area ${f(imp.printW)} × ${f(imp.printH)} mm of the ${f(sheetW)} × ${f(sheetH)} mm sheet.` });
        return;
      }
      const goodPerFlat = ce(qty / imp.ups);
      goodU = flats * goodPerFlat;
      unitName = 'sheets'; unitWord = 'sheet';
      layout = { kind: 'sheet', sheetW, sheetH, margin, gripper, bleed, gutter, printW: imp.printW, printH: imp.printH, orientation: imp.orientation, across: imp.across, down: imp.down, ups: imp.ups, cellW: imp.best.cw, cellH: imp.best.ch, pw: imp.best.pw, ph: imp.best.ph, utilisation: imp.utilisation, A: { across: imp.A.across, down: imp.A.down, ups: imp.A.ups }, B: { across: imp.B.across, down: imp.B.down, ups: imp.B.ups }, flats, goodPerFlat, pieceW, pieceH, openAuto, usesOpenSize: useOpen };
    } else {
      const usableW = rollW - 2 * num(job.rollEdge);
      const imp = imposeRoll({ pieceW, pieceH, usableW, bleed, gutter, qty });
      if (!imp) {
        res.errors.push({ field: 'w', msg: `A piece of ${f(pieceW)} × ${f(pieceH)} mm (+ ${f(bleed)} mm bleed) does not fit across the usable roll width of ${f(usableW)} mm in either direction.` });
        return;
      }
      const b = imp.best;
      goodU = b.length / 1000;
      unitName = 'm of roll'; unitWord = 'm';
      layout = { kind: 'roll', rollWidth: rollW, usableW, rollEdge: num(job.rollEdge), bleed, gutter, orientation: b.orientation, across: b.across, rows: b.rows, cellW: b.cw, cellH: b.ch, pw: b.pw, ph: b.ph, lengthM: goodU, lastRow: b.lastRow, options: imp.options.map((o) => ({ orientation: o.orientation, across: o.across, rows: o.rows, lengthM: o.length / 1000 })) };
    }
    res.layout = layout;

    if (job._manualGoodUnits != null) goodU = num(job._manualGoodUnits);

    /* ---- waste ---- */
    const pctWaste = rU(goodU * wastePct / 100);
    const runWaste = Math.max(pctWaste, rU(minWaste));
    const setupWaste = rU(setupPerRun * runs);
    const addWaste = rU(extraWaste);
    const wasteU = runWaste + setupWaste + addWaste;
    const totalU = goodU + wasteU;
    const wf = totalU > 0 ? wasteU / totalU : 0;
    const dp = kind === 'sheet' ? 0 : 3;
    res.summary = {
      mode: job.mode, costing, kind, material: mat.name, machine: mach.name, unitName,
      flats, sides, pages,
      requirement: { good: goodU, waste: wasteU, total: totalU, pct: wastePct, runWaste, setupWaste, addWaste, perUnit: uc.cost, unitWord },
      printing: {}, machineHours: { run: 0, setup: 0 }, labor: { hours: 0, cost: 0 }, finishing: []
    };

    /* ---- helpers to write cost lines ---- */
    const add = (cat, label, formula, amount, force) => {
      const a = r2(amount);
      if (a !== 0 || force) res.lines[cat].push({ label, formula, amount: a });
      return a;
    };
    // "variable" costs scale with what runs through the press, so a share belongs to the spoiled units.
    const addVar = (cat, label, formula, raw, force) => {
      const T = r2(raw), w = r2(T * wf), g = r2(T - w);
      if (T !== 0 || force) res.lines[cat].push({ label, formula: formula + (w ? ` — of which ${m(w)} is for spoiled ${unitName} (shown under Waste)` : ''), amount: g });
      if (w) res.lines.waste.push({ label: `${label} — spoiled ${unitName}`, formula: `${f(wasteU, dp)} of ${f(totalU, dp)} ${unitName} × ${m(T)}`, amount: w });
      return T;
    };

    /* ---- MATERIAL ---- */
    const rawMat = totalU * uc.cost;
    const minMat = num(mat.minCharge) > 0 ? num(mat.minCharge) : num(S.minimums && S.minimums.material);
    const matTotal = Math.max(rawMat, minMat);
    const matFormula = `${f(goodU, dp)} good + ${f(wasteU, dp)} spoiled = ${f(totalU, dp)} ${unitName} × ${f(uc.cost, 4)} per ${uc.label}${uc.note || ''} = ${m(rawMat)}` + (minMat > rawMat ? ` → minimum charge ${m(minMat)} applies` : '');
    addVar('material', mat.name, matFormula, matTotal, true);


    /* ---- PRINTING + MACHINE + SETUP ---- */
    const hourly = num(mach.hourlyRate);
    const setupRate = isBlank(mach.setupRate) ? hourly : num(mach.setupRate);
    const speed = isBlank(job.speed) ? num(mach.speed) : num(job.speed);
    const cpi = num(mach.costPerImpression);
    let impressions = 0, runHours = 0;
    const noSpeed = () => res.warnings.push(`Machine speed for "${mach.name}" is empty or 0, so running time (and its cost) is calculated as 0.`);

    if (costing === 'offset') {
      const colors = num(job.colors);
      const units = num(mach.colorUnits) > 0 ? num(mach.colorUnits) : Math.max(colors, 1);
      const passes = Math.ceil(colors / units);
      const plates = isBlank(job.plates) ? colors * sides * flats : num(job.plates);
      const plateCost = isBlank(job.plateCost) ? num(P.plateCost) : num(job.plateCost);
      const inkRate = isBlank(job.inkRate) ? num(P.offsetInkPer1000) : num(job.inkRate);
      add('printing', 'Plates', `${f(plates)} plates × ${m(plateCost)}${isBlank(job.plates) ? ` (auto: ${colors} colours × ${sides} sides × ${flats} design${flats > 1 ? 's' : ''})` : ''}`, plates * plateCost, true);
      const colourSides = totalU * sides * colors;
      addVar('printing', 'Ink', `${f(colourSides)} colour-sides ÷ 1,000 × ${f(inkRate, 4)}`, (colourSides / 1000) * inkRate, true);
      impressions = totalU * sides * passes;
      if (speed > 0) runHours = impressions / speed; else noSpeed();
      addVar('machine', `${mach.name} — running time`, `${f(impressions)} impressions (${f(totalU)} sheets × ${sides} sides${passes > 1 ? ` × ${passes} passes` : ''}) ÷ ${f(speed)} per hour = ${f(runHours, 3)} h × ${m(hourly)}`, runHours * hourly, true);
      if (cpi > 0) addVar('machine', 'Cost per impression', `${f(impressions)} × ${f(cpi, 4)}`, impressions * cpi);
      Object.assign(res.summary.printing, { impressions, plates, colours: colors, passes, plateCost, inkRate });
    } else if (costing === 'digital') {
      const bw = job.colorMode === 'bw';
      const click = bw ? (isBlank(job.clickBW) ? num(mach.clickBW) : num(job.clickBW)) : (isBlank(job.clickColor) ? num(mach.clickColor) : num(job.clickColor));
      impressions = totalU * sides;
      addVar('printing', `Clicks (${bw ? 'B&W' : 'colour'})`, `${f(totalU)} sheets × ${sides} sides = ${f(impressions)} clicks × ${f(click, 4)}`, impressions * click, true);
      if (speed > 0) runHours = impressions / speed; else noSpeed();
      addVar('machine', `${mach.name} — running time`, `${f(impressions)} impressions ÷ ${f(speed)} per hour = ${f(runHours, 3)} h × ${m(hourly)}`, runHours * hourly, true);
      if (cpi > 0) addVar('machine', 'Cost per impression', `${f(impressions)} × ${f(cpi, 4)}`, impressions * cpi);
      Object.assign(res.summary.printing, { impressions, clicks: impressions, clickRate: click, colorMode: bw ? 'B&W' : 'Colour' });
    } else {
      const cellArea = ((W + 2 * bleed) * (H + 2 * bleed)) / 1e6;
      const printedGood = qty * cellArea * sides;
      const printedTotal = goodU > 0 ? printedGood * (totalU / goodU) : 0;
      const inkRate = isBlank(job.inkSqm) ? num(P.areaInkPerSqm) : num(job.inkSqm);
      const msq = isBlank(job.machineSqm) ? num(mach.costPerSqm) : num(job.machineSqm);
      addVar('printing', 'Ink', `${f(printedTotal, 3)} m² printed × ${f(inkRate, 4)} per m²`, printedTotal * inkRate, true);
      if (speed > 0) runHours = printedTotal / speed; else noSpeed();
      addVar('machine', `${mach.name} — running time`, `${f(printedTotal, 3)} m² ÷ ${f(speed)} m²/h = ${f(runHours, 3)} h × ${m(hourly)}`, runHours * hourly, true);
      if (msq > 0) addVar('machine', 'Machine cost per m²', `${f(printedTotal, 3)} m² × ${f(msq, 4)}`, printedTotal * msq);
      Object.assign(res.summary.printing, { printedSqmGood: printedGood, printedSqm: printedTotal, areaPerPiece: cellArea, inkRate });
    }
    const setupHrs = (isBlank(job.setupHours) ? num(P.setupHours && P.setupHours[job.mode]) : num(job.setupHours)) * runs;
    add('setup', `${mach.name} — setup`, `${f(setupHrs, 3)} h${runs > 1 ? ` (${runs} designs)` : ''} × ${m(setupRate)} setup rate`, setupHrs * setupRate, true);
    res.summary.machineHours = { run: runHours, setup: setupHrs };

    /* ---- Additional materials: independent layouts, quantities and operations ---- */
    res.materialRequirements = [{ index: -1, role: job.product === 'NCR' ? 'Original' : 'Main', name: mat.name,
      materialId: mat.id, layout, good: goodU, waste: wasteU, total: totalU, unit: unitName, unitCost: uc.cost,
      cost: r2(matTotal), printingCost: 0 }];
    (job.addMaterials || []).forEach((row, i) => {
      const mm = find(db.materials, row.materialId); if (!mm) return;
      const role = row.role || 'manual', prefix = `${role === 'ncr' ? 'NCR copy' : role === 'lamination' ? 'Lamination film' : role === 'mounting' ? 'Mounting board' : role === 'cover' ? 'Cover / backing' : 'Other material'} ${i + 1}`;
      let detail;
      if (role === 'manual') {
        const b = matBasis(mm), q = num(row.qty), raw = q * b.cost, cost = Math.max(raw, num(mm.minCharge));
        add('material', `${prefix} — ${mm.name}`, `${f(q, 3)} ${b.label} × ${f(b.cost, 4)}`, cost, true);
        detail = { index: i, role, name: mm.name, materialId: mm.id, good: q, waste: 0, total: q, unit: b.label, unitCost: b.cost, cost: r2(cost), printingCost: 0, layout: null };
      } else {
        const layer = newJob(clone(job));
        Object.assign(layer, { product: 'Custom', materialId: mm.id, addMaterials: [], finishing: [], labor: [], other: [], lamFinId: '', cutFinId: '', setsPerPad: '' });
        const printed = role === 'ncr' && row.printed !== false;
        if (role === 'ncr') {
          layer.sides = isBlank(row.sides) ? job.sides : Number(row.sides);
          layer.colors = isBlank(row.colors) ? job.colors : row.colors;
          layer.colorMode = row.colorMode || job.colorMode;
          layer.plates = isBlank(row.plates) ? '' : row.plates;
          layer.setupHours = isBlank(row.setupHours) ? job.setupHours : row.setupHours;
          if (materialMode(mm) !== 'sheet') { res.errors.push({ field: `addMaterials.${i}.materialId`, msg: 'NCR copies need sheet materials.' }); return; }
        } else {
          layer.w = W / u; layer.h = H / u; layer.shape = 'rect'; layer.ow = ''; layer.oh = ''; layer.pages = ''; layer.pressW = ''; layer.pressH = ''; layer.parentDivisor = 1;
          layer.margin = 0; layer.gripper = 0; layer.rollEdge = 0; layer.sides = 1;
          if (role !== 'lamination') layer.bleed = 0;
          if (role === 'cover') layer.qty = Math.ceil(qty / num(job.setsPerPad));
        }
        layer.wastePct = isBlank(row.wastePct) ? (role === 'ncr' ? (isBlank(job.wastePct) ? num(WS.pct) : job.wastePct) : 0) : row.wastePct;
        layer.setupWaste = isBlank(row.setupWaste) ? (role === 'ncr' ? (isBlank(job.setupWaste) ? num(WS.setup) : job.setupWaste) : 0) : row.setupWaste;
        layer.extraWaste = 0;
        layer._manualGoodUnits = isBlank(row.qty) ? null : num(row.qty);
        if (role === 'lamination' && (row.feed || 'web') === 'web' && kind === 'roll') {
          if (materialMode(mm) !== 'roll' || num(mm.rollWidth) < rollW) {
            res.errors.push({field: `addMaterials.${i}.materialId`, msg: 'Continuous roll lamination needs a film roll at least as wide as the printing roll. Choose separate pieces if you cut and rearrange the job first.'}); return;
          }
          if (isBlank(row.qty)) layer._manualGoodUnits = goodU;
        }
        let layerDb = db;
        if (!printed) {
          const neutral = { id: '__material_only__', name: 'Material layout', type: materialMode(mm) === 'roll' ? 'large_format' : 'digital', speed: 1, hourlyRate: 0, setupRate: 0, clickColor: 0, clickBW: 0, costPerSqm: 0 };
          layer.machineId = neutral.id; layer.mode = neutral.type === 'digital' ? 'digital' : 'large_format';
          const settings = clone(S); settings.waste = settings.waste || {}; settings.waste[layer.mode] = {pct: 0, setup: 0, min: role === 'ncr' ? num(WS.min) : 0};
          layerDb = Object.assign({}, db, { machines: db.machines.concat([neutral]), settings });
          layer.setupHours = 0; layer.inkSqm = 0; layer.machineSqm = 0; layer.clickColor = 0; layer.clickBW = 0;
        }
        const lr = calculate(layer, layerDb);
        if (!lr.ok) { lr.errors.forEach((e) => res.errors.push({ field: `addMaterials.${i}.materialId`, msg: `${prefix}: ${e.msg}` })); return; }
        lr.warnings.forEach((w) => res.warnings.push(`${prefix}: ${w}`));
        const categories = printed ? ['material','printing','machine','setup','waste'] : ['material','waste'];
        categories.forEach((c) => lr.lines[c].forEach((l) => res.lines[c].push(Object.assign({}, l, { label: `${prefix} — ${l.label}` }))));
        const req = lr.summary.requirement;
        detail = { index: i, role, name: mm.name, materialId: mm.id, layout: lr.layout, good: req.good, waste: req.waste, total: req.total, unit: lr.summary.unitName,
          unitCost: req.perUnit, cost: r2(lr.lines.material.reduce((a,l)=>a+l.amount,0) + lr.lines.waste.filter(l=>l.label.startsWith(mm.name)).reduce((a,l)=>a+l.amount,0)),
          printingCost: printed ? r2(lr.total - Math.max(req.total * req.perUnit, num(mm.minCharge), num(S.minimums && S.minimums.material))) : 0 };
      }
      res.materialRequirements.push(detail);
      if (row.finId) {
        const op = find(db.finishing, row.finId); if (!op) return;
        let basis = op.method === 'per_piece' ? (role === 'cover' ? Math.ceil(qty / num(job.setsPerPad)) : qty) : op.method === 'per_sheet' ? detail.good : op.method === 'per_sqm' ? qty * W * H / 1e6 : op.method === 'per_meter' ? (detail.layout && detail.layout.kind === 'roll' ? detail.good : qty * 2 * (W + H) / 1000) : op.method === 'fixed' ? 1 : 0;
        if (!isBlank(row.opQty)) basis = num(row.opQty);
        else if (op.method === 'per_hour') res.warnings.push(`${prefix}: enter processing hours for ${op.name}.`);
        const raw = basis * num(op.rate), run = Math.max(raw, num(op.minCharge), num(S.minimums && S.minimums.finishing)), setup = num(op.setupCost);
        add('finishing', `${prefix} — ${op.name}`, `${f(basis, 3)} × ${f(num(op.rate), 4)} (${FIN_METHODS[op.method]})`, run, true);
        add('setup', `${prefix} — ${op.name} setup`, 'Fixed processing setup', setup);
        res.stages.push({ name: `${prefix} — ${op.name}`, method: op.method, basis, mult: 1, qtyEff: basis, unit: op.method, rate: num(op.rate), raw, minCharge: num(op.minCharge), setup: r2(setup), run: r2(run), total: r2(run + setup) });
      }
      if (role === 'lamination' && job.lamFinId) res.warnings.push('Lamination film is charged separately. Ensure the selected lamination operation excludes film, and select the processing operation only once.');
    });
    if (job.product === 'NCR') {
      res.summary.ncrParts = 1 + (job.addMaterials || []).filter(r => r.role === 'ncr').length;
      if (num(job.setsPerPad) > 0) res.summary.pads = Math.ceil(qty / num(job.setsPerPad));
    }

    /* ---- FINISHING (each stage separately) ---- */
    const shape = job.mode === 'sticker' ? (job.shape || 'rect') : 'rect';
    let perim = 2 * (W + H);
    if (shape === 'circle') perim = Math.PI * W;
    else if (shape === 'custom') { if (num(job.cutLen) > 0) perim = num(job.cutLen); else res.warnings.push('Custom shape: no cut length entered, so the bounding-box perimeter is used for cutting.'); }
    const perimM = (perim * qty) / 1000;
    const goodSheets = kind === 'sheet' ? goodU + (job.product === 'NCR' ? res.materialRequirements.filter(x => x.role === 'ncr').reduce((a,x) => a + x.good, 0) : 0) : 0;
    const areaAuto = kind === 'sheet' ? (goodSheets * sheetW * sheetH) / 1e6 : goodU * (rollW / 1000);
    const finRows = (job.finishing || []).filter((r) => r && r.finId).map((r) => Object.assign({}, r));
    if (job.mode === 'sticker') {
      if (job.lamFinId) finRows.push({ finId: job.lamFinId, tag: 'Lamination' });
      if (job.cutFinId) finRows.push({ finId: job.cutFinId, tag: 'Cutting' });
    }
    finRows.forEach((r) => {
      const op = find(db.finishing, r.finId); if (!op) return;
      const method = FIN_METHODS[op.method] ? op.method : 'per_piece';
      let auto = 0, lbl = 'piece', autoTxt = '';
      if (method === 'per_piece') { auto = qty; lbl = 'pieces'; autoTxt = 'job quantity'; }
      else if (method === 'per_sheet') { auto = goodSheets; lbl = 'sheets'; autoTxt = job.product === 'NCR' ? 'good press sheets across all NCR parts' : 'good press sheets'; if (kind === 'roll' && isBlank(r.qty)) res.warnings.push(`"${op.name}" is priced per sheet but this job uses roll material — enter a quantity for it.`); }
      else if (method === 'per_meter') { auto = perimM; lbl = 'm'; autoTxt = 'cut length = perimeter of every piece'; }
      else if (method === 'per_sqm') { auto = areaAuto; lbl = 'm²'; autoTxt = kind === 'sheet' ? 'good sheets × sheet area' : 'good roll length × roll width'; }
      else if (method === 'per_hour') { auto = 0; lbl = 'h'; autoTxt = 'enter hours'; if (isBlank(r.qty)) res.warnings.push(`"${op.name}" is priced per hour — enter the hours it takes.`); }
      else if (method === 'fixed') { auto = 1; lbl = 'job'; autoTxt = 'once per job'; }
      const manual = !isBlank(r.qty);
      const basis = manual ? num(r.qty) : auto;
      const mult = isBlank(r.mult) ? 1 : num(r.mult, 1);
      const qtyEff = basis * mult, rate = num(op.rate), raw = qtyEff * rate;
      const minC = num(op.minCharge) > 0 ? num(op.minCharge) : num(S.minimums && S.minimums.finishing);
      const run = Math.max(raw, minC), setup = num(op.setupCost);
      const name = (r.tag ? `${r.tag}: ` : '') + op.name;
      const formula = `${f(basis, 3)} ${lbl}${manual ? ' (manual)' : ''}${mult !== 1 ? ` × ${f(mult)}` : ''} × ${f(rate, 4)} ${FIN_METHODS[method].toLowerCase()} = ${m(raw)}` + (minC > raw ? ` → minimum charge ${m(minC)} applies` : '');
      const runAmt = add('finishing', name, formula, run, true);
      const setAmt = setup > 0 ? add('setup', `Setup — ${op.name}`, `fixed setup cost for ${op.name}`, setup, true) : 0;
      res.stages.push({ name, method, basis, mult, qtyEff, unit: lbl, autoTxt, manual, rate, raw, minCharge: minC, minApplied: minC > raw, run: runAmt, setup: setAmt, total: r2(runAmt + setAmt) });
    });
    res.summary.finishing = res.stages;

    /* ---- LABOR ---- */
    let labHrs = 0, labCost = 0;
    (job.labor || []).forEach((r) => {
      const lb = find(db.labor, r.laborId); if (!lb) return;
      const hrs = num(r.hours), rate = num(lb.hourlyCost);
      labHrs += hrs; labCost += add('labor', lb.category, `${f(hrs, 3)} h × ${m(rate)}`, hrs * rate, true);
    });
    res.summary.labor = { hours: labHrs, cost: r2(labCost) };

    /* ---- OTHER production costs ---- */
    (job.other || []).forEach((r) => {
      if (isBlank(r.desc) && isBlank(r.qty) && isBlank(r.unitCost)) return;
      add('other', r.desc || 'Other cost', `${f(num(r.qty), 3)} × ${m(num(r.unitCost))}`, num(r.qty) * num(r.unitCost), true);
    });

    /* ---- totals ---- */
    let total = 0;
    CATEGORIES.forEach((c) => {
      const s = r2(res.lines[c].reduce((a, l) => a + l.amount, 0));
      res.subtotals[c] = s; total += s;
    });
    res.total = r2(total);
    res.perPiece = qty > 0 ? res.total / qty : 0;
    res.summary.machineCost = r2(res.subtotals.machine + res.subtotals.setup);
  }

  /* ---------- quantity comparison (runs the real engine per quantity) ---------- */
  function compare(job, db, quantities) {
    const base = num(job.qty);
    return quantities.map((q) => {
      const j = clone(job); j.qty = q;
      const ratio = base > 0 ? q / base : 1;
      (j.labor || []).forEach((r) => { if (r.scales) r.hours = num(r.hours) * ratio; });
      (j.other || []).forEach((r) => { if (r.scales && !isBlank(r.qty)) r.qty = num(r.qty) * ratio; });
      (j.addMaterials || []).forEach((r) => { if (r.scales) { if (!isBlank(r.qty)) { const x = num(r.qty) * ratio, mat = find(db.materials, r.materialId); r.qty = r.role && r.role !== 'manual' && mat && materialMode(mat) === 'sheet' ? Math.ceil(x) : x; } if (!isBlank(r.opQty)) r.opQty = num(r.opQty) * ratio; } });
      (j.finishing || []).forEach((r) => { if (r.scales && !isBlank(r.qty)) r.qty = num(r.qty) * ratio; });
      const r = calculate(j, db);
      return { qty: q, ok: r.ok, errors: r.errors, total: r.total, perPiece: r.perPiece, units: r.summary ? r.summary.requirement.total : 0, unitName: r.summary ? r.summary.unitName : '' };
    });
  }

  return {
    version: '1.1', UNIT_MM, PRODUCT_TYPES, MODES, MODE_MACHINES, FIN_METHODS, MAT_UNITS, MAT_CATS, MACHINE_TYPES, MACHINE_FIELDS, SPEED_UNIT, CATEGORIES, BOOK,
    defaultSettings, newJob, validate, calculate, compare, imposeSheet, imposeRoll, matDerived, matBasis, materialMode, materialUnitCost,
    util: { num, r2, f, m, isBlank, isNumeric, clone, find }
  };
});
