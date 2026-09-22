const E = require('./engine.js'), Seed = require('./seed.js');
const db = Seed.build();
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const nasty = () => pick([0, -1, -0.5, 1, 2, 3.7, 10, 55, 90, 148, 210, 640, 900, 1000, 5000, 1e6, 1e12, 1e308, '', ' ', 'abc', 'NaN', 'Infinity', '-Infinity', '1e999', null, undefined, true, '12.5', '0', '007']);
const sane = () => pick([1, 2, 5, 10, 50, 90, 148, 210, 300, 1000, 2000, '', 0.5, 0]);
const ids = (arr) => arr.map((x) => x.id).concat(['', 'ghost']);
const fields = ['qty','w','h','ow','oh','pages','sides','bleed','margin','gripper','gutter','rollEdge','colors','plates','plateCost','inkRate','setupHours','speed','clickColor','clickBW','inkSqm','machineSqm','wastePct','setupWaste','extraWaste','diameter','cutLen','pressW','pressH','parentDivisor'];
let n = 0, okc = 0, errc = 0, bad = [];
const t0 = Date.now();
for (let i = 0; i < 60000; i++) {
  const mode = pick(Object.keys(E.MODES));
  const machs = db.machines.filter((m) => E.MODE_MACHINES[mode].includes(m.type));
  const wantSheet = mode === 'offset' || mode === 'digital';
  const mats = db.materials.filter((m) => (wantSheet ? E.materialMode(m) === 'sheet' : true));
  const j = E.newJob({ product: pick(E.PRODUCT_TYPES), mode, materialId: rnd() < 0.97 ? pick(mats).id : pick(ids(db.materials)), machineId: rnd() < 0.97 ? pick(machs).id : pick(ids(db.machines)), colorMode: pick(['color', 'bw']), shape: pick(['rect', 'circle', 'custom']), cutFinId: pick(ids(db.finishing)), lamFinId: pick(ids(db.finishing)) });
  j.qty = pick([1, 7, 100, 500, 1000, 12345, 250000]); j.w = pick([20, 50, 90, 148, 210, 600, 2000]); j.h = pick([20, 55, 100, 210, 297, 1000]); j.sides = pick([1, 2]); j.diameter = pick([20, 50, 100]);
  j.pages = pick(['', 8, 16, 18, 64]); j.colors = pick([1, 2, 4, 5]); j.bleed = pick([0, 2, 3, 5]); j.margin = pick([0, 5, 10]); j.gripper = pick([0, 10]); j.gutter = pick([0, 3, 10]);
  fields.forEach((f) => { const r = rnd(); if (r < 0.02) j[f] = nasty(); else if (r < 0.06) j[f] = sane(); });
  for (let k = 0; k < Math.floor(rnd() * 4); k++) j.finishing.push({ finId: pick(ids(db.finishing)), qty: pick(['', sane(), nasty()]), mult: pick([1, 1, 2, '', nasty()]) });
  for (let k = 0; k < Math.floor(rnd() * 3); k++) j.labor.push({ laborId: pick(ids(db.labor)), hours: pick([0.5, 1, nasty()]) });
  for (let k = 0; k < Math.floor(rnd() * 2); k++) j.other.push({ desc: 'x', qty: pick([1, nasty()]), unitCost: pick([1, nasty()]) });
  for (let k = 0; k < Math.floor(rnd() * 2); k++) j.addMaterials.push({ materialId: pick(ids(db.materials)), qty: pick([1, nasty()]) });
  let r;
  try { r = E.calculate(j, db); } catch (e) { bad.push({ why: 'THREW ' + e.message, j }); continue; }
  n++;
  const cats = E.CATEGORIES;
  if (r.ok) {
    okc++;
    const nums = [r.total, r.perPiece, ...cats.map((c) => r.subtotals[c])];
    if (!nums.every(Number.isFinite)) bad.push({ why: 'non-finite in OK result', j });
    else if (r.total < 0 || cats.some((c) => r.subtotals[c] < 0)) bad.push({ why: 'negative cost', j, sub: r.subtotals });
    else if (Math.abs(cats.reduce((a, c) => a + r.subtotals[c], 0) - r.total) > 0.011) bad.push({ why: 'subtotals != total', j });
    else if (Math.abs(r.perPiece * r.qty - r.total) > 0.01) bad.push({ why: 'per piece * qty != total', j });
    else if (r.lines && cats.some((c) => r.lines[c].some((l) => !Number.isFinite(l.amount) || l.amount < 0))) bad.push({ why: 'bad line', j });
    else { const q = r.summary.requirement; if (!(q.total >= q.good && q.good > 0 && q.waste >= 0)) bad.push({ why: 'bad units', j, q }); }
  } else {
    errc++;
    if (!r.errors.length || !Number.isFinite(r.total) || !Number.isFinite(r.perPiece)) bad.push({ why: 'error result malformed', j });
    else if (r.errors.some((e) => typeof e.msg !== 'string' || /NaN|undefined|Infinity/.test(e.msg))) bad.push({ why: 'ugly error message: ' + r.errors.map((e) => e.msg).join(' | '), j });
  }
}
console.log(`${n} jobs: ${okc} calculated, ${errc} rejected with a message, ${bad.length} PROBLEMS  (${Date.now() - t0} ms)`);
const seen = {}; bad.forEach((b) => { seen[b.why] = (seen[b.why] || 0) + 1; }); console.log(seen);
const showDiff = (x) => { const d = E.newJob(); const diff = {}; Object.keys(x.j).forEach((k) => { if (JSON.stringify(x.j[k]) !== JSON.stringify(d[k])) diff[k] = x.j[k]; }); return JSON.stringify(diff); };
['bad units'].forEach((w) => bad.filter((x) => x.why === w).slice(0, 2).forEach((x) => { const r = E.calculate(x.j, db); console.log('\n##', w, showDiff(x), '\nlayout:', JSON.stringify(r.layout).slice(0, 400)); }));
process.exit(bad.length ? 1 : 0);
