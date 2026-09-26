const E = require('./engine.js');
const Seed = require('./seed.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  ✗ FAIL:', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); } };
const near = (name, a, b, tol = 0.011) => ok(name, Math.abs(a - b) <= tol, { got: a, expected: b });
const eq = (name, a, b) => ok(name, a === b, { got: a, expected: b });

const db = Seed.build();
const jobs = Seed.testJobs();
const R = jobs.map((j) => E.calculate(j, db));
R.forEach((r, i) => ok(`test ${i + 1} has no errors`, r.ok, r.errors));

/* ---------------- unit tests: imposition ---------------- */
console.log('\n[imposition]');
let imp = E.imposeSheet({ pieceW: 90, pieceH: 55, sheetW: 640, sheetH: 900, margin: 5, gripper: 10, bleed: 3, gutter: 0 });
eq('A: 6 x 14 = 84', imp.A.ups, 84);
eq('B: 10 x 9 = 90', imp.B.ups, 90);
eq('best orientation is B', imp.orientation, 'B');
eq('printable width 630', imp.printW, 630);
eq('printable height 880', imp.printH, 880);
imp = E.imposeSheet({ pieceW: 90, pieceH: 55, sheetW: 640, sheetH: 900, margin: 0, gripper: 0, bleed: 0, gutter: 0 });
eq('no margins, no bleed: A = 7 x 16 = 112', imp.A.ups, 112);
eq('no margins, no bleed: B = 11 x 10 = 110', imp.B.ups, 110);
eq('spec example picks A (112)', imp.ups, 112);
imp = E.imposeSheet({ pieceW: 100, pieceH: 100, sheetW: 200, sheetH: 200, margin: 0, gripper: 0, bleed: 0, gutter: 0 });
eq('exact fit 2x2 (float safe)', imp.ups, 4);
imp = E.imposeSheet({ pieceW: 100, pieceH: 100, sheetW: 200, sheetH: 200, margin: 0, gripper: 0, bleed: 0, gutter: 10 });
eq('gap 10 makes 2x2 impossible -> 1', imp.ups, 1);
imp = E.imposeSheet({ pieceW: 700, pieceH: 700, sheetW: 640, sheetH: 900, margin: 0, gripper: 0, bleed: 0, gutter: 0 });
eq('piece too big -> 0 ups', imp.ups, 0);

console.log('[roll layout]');
let rl = E.imposeRoll({ pieceW: 50, pieceH: 50, usableW: 1270, bleed: 2, gutter: 3, qty: 1000 }).best;
eq('22 across', rl.across, 22); eq('46 rows', rl.rows, 46); eq('length 2619 mm', rl.length, 2619);
rl = E.imposeRoll({ pieceW: 2000, pieceH: 1000, usableW: 1600, bleed: 0, gutter: 10, qty: 100 }).best;
eq('banner rotates (B)', rl.orientation, 'B'); eq('1 across', rl.across, 1); eq('length 200,990 mm', rl.length, 200990);
eq('piece wider than roll both ways -> null', E.imposeRoll({ pieceW: 2000, pieceH: 1700, usableW: 1600, bleed: 0, gutter: 0, qty: 5 }), null);

/* ---------------- Test 1: 1,000 business cards, offset ---------------- */
console.log('\n[Test 1 — hand-worked]');
{
  const r = R[0], L = r.summary.requirement;
  const good = Math.ceil(1000 / 90);                       // 12 sheets
  const waste = Math.ceil(good * 0.10) + 20;               // 2 + 20 = 22
  const total = good + waste;                              // 34
  eq('good sheets', L.good, good); eq('waste sheets', L.waste, waste); eq('total sheets', L.total, total);
  const mat = total * 1.2;                                 // 40.80
  const ink = (total * 2 * 4 / 1000) * 1;                  // 0.272
  const plates = 4 * 2 * 15;                               // 120
  const hours = (total * 2) / 8000, run = hours * 100;     // 0.85
  const setup = 0.5 * 80;                                  // 40
  const cutting = Math.max(12 * 0.05, 2);                  // min charge 2
  const lam = 12 * (0.64 * 0.9) * 2 * 3.5;                 // 48.384
  const labor = 20 * 1 + 15 * 0.5 + 12 * 0.25;             // 30.5
  const other = 2;
  near('material subtotal + waste share = 40.80', r.subtotals.material + r.lines.waste.find((l) => l.label.startsWith('Art card')).amount, mat);
  near('plates 120', r.subtotals.printing - (r.lines.printing.find((l) => l.label === 'Ink').amount), plates);
  near('setup 40', r.subtotals.setup, setup);
  near('finishing', r.subtotals.finishing, r2(cutting) + r2(lam));
  near('labor 30.50', r.subtotals.labor, labor);
  near('other 2', r.subtotals.other, other);
  near('TOTAL (independent sum)', r.total, r2(mat) + plates + r2(ink) + r2(run) + setup + r2(cutting) + r2(lam) + labor + other, 0.03);
  near('per piece = total / 1000', r.perPiece, r.total / 1000, 1e-9);
}
function r2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }

/* ---------------- Test 2: 500 flyers, digital ---------------- */
console.log('[Test 2 — hand-worked]');
{
  const r = R[1], L = r.summary.requirement;
  eq('ups = 4 (2 x 2)', r.layout.ups, 4);
  eq('good sheets 125', L.good, 125); eq('waste = 7 + 3', L.waste, 10); eq('total 135', L.total, 135);
  const paper = 135 * 0.25, clicks = 135 * 2 * 0.3, mach = (135 * 2 / 3000) * 20, setup = 0.1 * 20;
  const cut = Math.max(125 * 0.05, 2), lab = 0.25 * 15 + 0.25 * 12;
  near('TOTAL', r.total, r2(paper) + r2(clicks) + r2(mach) + r2(setup) + r2(cut) + lab, 0.03);
  near('cost/piece', r.perPiece, r.total / 500, 1e-9);
}

/* ---------------- Test 3: 1,000 round stickers ---------------- */
console.log('[Test 3 — hand-worked]');
{
  const r = R[2], L = r.summary.requirement;
  near('good length 2.619 m', L.good, 2.619, 1e-9);
  near('waste = 0.2619 + 0.5', L.waste, 0.7619, 1e-9);
  near('total 3.3809 m', L.total, 3.3809, 1e-9);
  const mat = 3.3809 * 8;                                           // 27.0472
  const printed = 1000 * 0.054 * 0.054 * (3.3809 / 2.619);          // 3.7644
  const ink = printed * 2, run = (printed / 20) * 25, setup = 0.25 * 25;
  const lam = 2.619 * 1.27 * 3, cutM = Math.PI * 50 * 1000 / 1000, cut = cutM * 0.2 + 2;
  const lab = 20 * 0.5 + 12 * 0.25;
  near('cut length = 157.08 m', r.stages.find((s) => s.name.startsWith('Cutting')).basis, cutM, 0.001);
  near('TOTAL', r.total, r2(mat) + r2(ink) + r2(run) + r2(setup) + r2(lam) + r2(r2(cutM * 0.2)) + 2 + lab, 0.04);
}

/* ---------------- Test 4: 100 banners ---------------- */
console.log('[Test 4 — hand-worked]');
{
  const r = R[3], L = r.summary.requirement;
  near('good length 200.99 m', L.good, 200.99, 1e-9);
  near('waste = 10.0495 + 1', L.waste, 11.0495, 1e-9);
  const total = 200.99 + 11.0495;
  const mat = total * 8, printed = 200 * (total / 200.99), ink = printed * 2, run = (printed / 20) * 25, setup = 0.25 * 25;
  const hem = 6 * 100 * 0.3, eye = 100 * 4 * 0.2, lab = 3 * 15 + 12;
  near('TOTAL', r.total, r2(mat) + r2(ink) + r2(run) + setup + hem + eye + lab, 0.04);
}

/* ---------------- Test 5: 500 booklets ---------------- */
console.log('[Test 5 — hand-worked]');
{
  const r = R[4], L = r.summary.requirement;
  eq('open size auto = 296 x 210', r.layout.pieceW + 'x' + r.layout.pieceH, '296x210');
  eq('ups = 2', r.layout.ups, 2);
  eq('flats (16 pp / 4) = 4', r.layout.flats, 4);
  eq('good sheets = 4 x 250', L.good, 1000);
  eq('waste = 50 + 3', L.waste, 53); eq('total 1053', L.total, 1053);
  const paper = 1053 * 0.2, clicks = 1053 * 2 * 0.3, mach = (1053 * 2 / 3000) * 20, setup = 0.1 * 20;
  const fold = 1000 * 0.03 + 5, stitch = 500 * 0.1 + 10, trim = Math.max(500 * 0.02, 5), lab = 2 * 15 + 0.5 * 12;
  near('TOTAL', r.total, r2(paper) + r2(clicks) + r2(mach) + setup + fold + stitch + trim + lab, 0.04);
  eq('3 finishing stages', r.stages.length, 3);
}

/* ---------------- cross-checks on every test ---------------- */
console.log('[invariants]');
R.forEach((r, i) => {
  const sum = E.CATEGORIES.reduce((a, c) => a + r.subtotals[c], 0);
  near(`test ${i + 1}: categories add up to total`, sum, r.total, 0.005);
  const lineSum = E.CATEGORIES.reduce((a, c) => a + r.lines[c].reduce((x, l) => x + l.amount, 0), 0);
  near(`test ${i + 1}: lines add up to total`, lineSum, r.total, 0.005);
  ok(`test ${i + 1}: all numbers finite`, [r.total, r.perPiece].every(Number.isFinite));
});

/* ---------------- validation: negatives, zero, NaN, division by zero ---------------- */
console.log('[validation]');
const base = () => JSON.parse(JSON.stringify(jobs[1]));
const bad = (name, patch, field) => {
  const j = Object.assign(base(), patch), r = E.calculate(j, db);
  ok(`${name} is rejected`, !r.ok && (!field || r.errors.some((e) => e.field === field)), r.errors);
  ok(`${name}: total stays finite`, Number.isFinite(r.total) && Number.isFinite(r.perPiece));
};
bad('qty 0', { qty: 0 }, 'qty'); bad('qty negative', { qty: -5 }, 'qty'); bad('qty 2.5', { qty: 2.5 }, 'qty'); bad('qty text', { qty: 'abc' }, 'qty');
bad('width 0', { w: 0 }, 'w'); bad('height negative', { h: -1 }, 'h'); bad('width NaN text', { w: 'NaN' }, 'w'); bad('width Infinity', { w: 'Infinity' }, 'w');
bad('bleed negative', { bleed: -1 }, 'bleed'); bad('speed 0', { speed: 0 }, 'speed'); bad('waste 150%', { wastePct: 150 }, 'wastePct');
bad('negative extra waste', { extraWaste: -2 }, 'extraWaste'); bad('sides 3', { sides: 3 }, 'sides'); bad('no material', { materialId: '' }, 'materialId');
bad('wrong machine type', { machineId: 'mach_offset' }, 'machineId'); bad('piece bigger than sheet', { w: 900, h: 900 }, 'w');
bad('only open width', { ow: 300 }, 'oh'); bad('negative labor hours', { labor: [{ laborId: 'lab_press', hours: -1 }] }, 'labor.0.hours');
bad('negative other cost', { other: [{ desc: 'x', qty: 1, unitCost: -3 }] }, 'other.0.unitCost');
{ // empty machine speed in DB must not divide by zero
  const d2 = Seed.build(); d2.machines.find((m) => m.id === 'mach_digital').speed = 0;
  const r = E.calculate(jobs[1], d2);
  ok('machine speed 0 in database → no crash, warning shown', r.ok && r.warnings.length > 0 && Number.isFinite(r.total), r.errors);
  near('…and running time cost is 0', r.subtotals.machine, 0);
}
{ const j = Object.assign(base(), { product: 'Booklet', pages: 2 }); ok('booklet with 2 pages rejected', !E.calculate(j, db).ok); }
{ const j = Object.assign(base(), { product: 'Booklet', pages: 18, w: 148, h: 210 }); const r = E.calculate(j, db); ok('18 pages rounds up to 20 with a warning', r.ok && r.warnings.length && r.layout.flats === 5, r.errors); }

/* ---------------- regression: found by the randomised stress test ---------------- */
console.log('[stress regressions]');
bad('absurd quantity (1e10)', { qty: 1e10 }, 'qty');
bad('absurd press sheet height 1e308', { pressW: 210, pressH: 1e308 }, 'pressH');
bad('absurd finishing quantity 1e12', { finishing: [{ finId: 'fin_cutting', qty: 1e12, mult: 1 }] }, 'finishing.0.qty');
bad('overflowing extra material 1e308', { addMaterials: [{ materialId: 'mat_paper130', qty: 1e308 }] }, 'addMaterials.0.qty');
{ // a positive amount never rounds down to zero sheets
  const r = E.calculate({ ...base(), qty: 1, w: 20, h: 20, pressW: 1e7, pressH: 1e7, bleed: 0, margin: 0, gripper: 0 }, db);
  ok('1 piece on a gigantic sheet still needs 1 good sheet', r.ok && r.summary.requirement.good === 1, r.errors);
}
{ // invalid results must never carry stale numbers
  const r = E.calculate({ ...base(), qty: -1 }, db);
  ok('invalid result has total 0 and perPiece 0', !r.ok && r.total === 0 && r.perPiece === 0 && E.CATEGORIES.every((c) => r.subtotals[c] === 0));
}
{ // a total above the ceiling is refused with a clear message
  const d3 = Seed.build(); d3.machines.find((x) => x.id === 'mach_digital').hourlyRate = 1e9;
  const r = E.calculate({ ...base(), qty: 1000000, speed: 1 }, d3);
  ok('total above 1e12 is refused', !r.ok && r.errors.some((e) => /unrealistically large/.test(e.msg)), r.errors);
}

/* ---------------- ink/hardware materials (kg, litre, piece) as "other materials" ---------------- */
console.log('[kg / litre / piece materials]');
{
  const d5 = Seed.build();
  d5.materials.push({ id: 'ink_cyan', name: 'Test ink', category: 'Ink', unit: 'litre', purchaseCost: 330, minCharge: 0 });
  d5.materials.push({ id: 'hw_screw', name: 'Test screw', category: 'Hardware', unit: 'piece', purchaseCost: 0.35, minCharge: 0 });
  d5.materials.push({ id: 'ink_black', name: 'Test kg ink', category: 'Ink', unit: 'kg', purchaseCost: 27, minCharge: 0 });
  eq('litre basis label', E.matBasis(d5.materials[12]).label, 'L');
  eq('litre basis cost = purchase cost (no geometry)', E.matBasis(d5.materials[12]).cost, 330);
  eq('piece basis cost', E.matBasis(d5.materials[13]).cost, 0.35);
  eq('kg basis cost', E.matBasis(d5.materials[14]).cost, 27);
  ok('MAT_CATS includes Ink and Hardware', E.MAT_CATS.includes('Ink') && E.MAT_CATS.includes('Hardware'));
  ok('MAT_UNITS includes kg/litre/piece', ['kg', 'litre', 'piece'].every((u) => u in E.MAT_UNITS));
  const j = { ...jobs[1], addMaterials: [{ materialId: 'ink_cyan', qty: 0.5 }, { materialId: 'hw_screw', qty: 4 }] };
  const r = E.calculate(j, d5);
  ok('a job can use ink and hardware as other materials', r.ok, r.errors);
  const inkLine = r.lines.material.find((l) => l.label.includes('Test ink'));
  const screwLine = r.lines.material.find((l) => l.label.includes('Test screw'));
  near('ink line = 0.5 L x 330', inkLine.amount, 165);
  near('screw line = 4 x 0.35', screwLine.amount, 1.4);
  // unpriced kg material still refused, never costed as 0
  d5.materials.push({ id: 'ink_unpriced', name: 'Unpriced ink', category: 'Ink', unit: 'litre', purchaseCost: '', minCharge: 0 });
  const r2 = E.calculate({ ...jobs[1], addMaterials: [{ materialId: 'ink_unpriced', qty: 1 }] }, d5);
  ok('unpriced litre material is refused, not costed as 0', !r2.ok && r2.errors.some((e) => /no price yet/.test(e.msg)), r2.errors);
}

/* ---------------- unpriced materials (names imported from the inventory list) ---------------- */
console.log('[unpriced materials]');
{
  const d4 = Seed.build(); Seed.inventoryMaterials().forEach((m) => d4.materials.push(m));
  eq('73 inventory materials available', Seed.inventoryMaterials().length, 73);
  ok('inventory names carry no prices', Seed.inventoryMaterials().every((m) => m.purchaseCost === ''));
  ok('inventory ids are unique', new Set(Seed.inventoryMaterials().map((m) => m.id)).size === 73);
  const unpriced = d4.materials.find((m) => m.id === 'inv_001');
  const r = E.calculate({ ...jobs[1], materialId: unpriced.id }, d4);
  ok('an unpriced material is refused (never costed as 0)', !r.ok && r.errors.some((e) => e.field === 'materialId' && /no price yet/.test(e.msg)), r.errors);
  ok('…and the result shows total 0, not a fake number', r.total === 0);
  const r2 = E.calculate({ ...jobs[1], addMaterials: [{ materialId: unpriced.id, qty: 5 }] }, d4);
  ok('an unpriced "other material" line is refused', !r2.ok && r2.errors.some((e) => /addMaterials\.0/.test(e.field) && /no price yet/.test(e.msg)), r2.errors);
  ok('derived costs are null (not 0) without a price', E.matDerived(unpriced).perSheet === null);
  unpriced.purchaseCost = 2;
  const r2b = E.calculate({ ...jobs[1], materialId: unpriced.id }, d4);
  ok('priced but no sheet size → clear message, not a confusing layout error', !r2b.ok && r2b.errors.some((e) => /no sheet size/.test(e.msg)), r2b.errors);
  unpriced.sheetW = 320; unpriced.sheetH = 450;
  const r3 = E.calculate({ ...jobs[1], materialId: unpriced.id }, d4);
  ok('once priced and sized it calculates', r3.ok, r3.errors);
  const sized = d4.materials.find((m) => m.name.startsWith('Gloss : 64 X 90'));
  eq('64 X 90 in a name became 640 x 900 mm', sized.sheetW + 'x' + sized.sheetH, '640x900');
  const roll = d4.materials.find((m) => m.name === 'Banner - 127cm');
  eq('roll width read from the name', roll.rollWidth, 1270);
  ok('unpriced roll refused too', !E.calculate({ ...jobs[3], materialId: roll.id }, d4).ok);
}

/* ---------------- waste rules ---------------- */
console.log('[waste]');
{
  const d = Seed.build(); d.settings.waste.digital = { pct: 10, setup: 0, min: 0 };
  const j = { ...E.newJob(), qty: 1000, w: 100, h: 100, sides: 1, materialId: 'mat_paper150', machineId: 'mach_digital', bleed: 0, margin: 0, gripper: 0 };
  // 100x100 on 320x450: 3 x 4 = 12 ups (A) -> ceil(1000/12) = 84 good sheets
  const r = E.calculate(j, d);
  eq('good sheets', r.summary.requirement.good, 84); eq('10% waste = ceil(8.4) = 9', r.summary.requirement.waste, 9);
  d.settings.waste.digital = { pct: 0, setup: 0, min: 6 };
  eq('minimum waste 6 wins over 0%', E.calculate(j, d).summary.requirement.waste, 6);
  d.settings.waste.digital = { pct: 10, setup: 2, min: 0 };
  eq('10% + fixed setup 2 + extra 3 = 14', E.calculate({ ...j, extraWaste: 3 }, d).summary.requirement.waste, 9 + 2 + 3);
  eq('per-job waste % override 0 + setup 0', E.calculate({ ...j, wastePct: 0, setupWaste: 0 }, d).summary.requirement.waste, 0);
}

/* ---------------- comparison uses the real engine ---------------- */
console.log('[comparison]');
{
  const cmp = E.compare(jobs[1], db, [500, 1000, 2000, 5000]);
  ok('all valid', cmp.every((c) => c.ok));
  ok('cost per piece never rises with quantity', cmp.every((c, i) => i === 0 || c.perPiece <= cmp[i - 1].perPiece + 1e-9), cmp.map((c) => c.perPiece));
  near('500 matches the direct calculation', cmp[0].total, R[1].total, 1e-9);
  const j = JSON.parse(JSON.stringify(jobs[1])); j.labor[0].scales = true;
  const c2 = E.compare(j, db, [500, 1000]);
  near('scaling labor row doubles that row', c2[1].total - E.compare(jobs[1], db, [1000])[0].total, 0.25 * 15, 1e-9);
}

/* ---------------- report ---------------- */
console.log('\n' + '='.repeat(78) + '\nTEST REPORT (demo rates)\n' + '='.repeat(78));
R.forEach((r, i) => {
  const s = r.summary, q = s.requirement;
  console.log(`\n${jobs[i].name}`);
  console.log(`  Layout        : ${r.layout.kind === 'sheet' ? `${r.layout.across} × ${r.layout.down} = ${r.layout.ups} per sheet (orientation ${r.layout.orientation}, ${r.layout.utilisation.toFixed(1)}% used)` : `${r.layout.across} across × ${r.layout.rows} rows, orientation ${r.layout.orientation}`}`);
  console.log(`  Material      : ${E.util.f(q.good, 3)} good + ${E.util.f(q.waste, 3)} waste = ${E.util.f(q.total, 3)} ${s.unitName}`);
  console.log(`  Printing      : ${s.printing.impressions ? E.util.f(s.printing.impressions) + ' impressions' : ''}${s.printing.plates ? ', ' + s.printing.plates + ' plates' : ''}${s.printing.printedSqm ? E.util.f(s.printing.printedSqm, 2) + ' m² printed' : ''}`);
  console.log(`  Finishing     : ${r.stages.map((x) => `${x.name} ${E.util.m(x.total)}`).join('; ') || '—'}`);
  console.log(`  Labor         : ${E.util.f(s.labor.hours, 2)} h = ${E.util.m(s.labor.cost)}`);
  console.log(`  Machine+setup : ${E.util.m(s.machineCost)}`);
  E.CATEGORIES.forEach((c) => console.log(`    ${c.padEnd(10)} ${E.util.m(r.subtotals[c]).padStart(10)}`));
  console.log(`  TOTAL         : ${E.util.m(r.total)}   COST/PIECE: ${r.perPiece.toFixed(4)}`);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
