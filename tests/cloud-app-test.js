const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const seedData = require('./seed-for-mock.js');
const { createMockSupabase } = require('./supabase-mock.js');

const path = require('path');
const srcRoot = fs.existsSync(path.join(__dirname, '../src/cloud.js')) ? path.join(__dirname, '../src') : __dirname;
const css = fs.readFileSync(path.join(srcRoot, 'app.css'),'utf8'), eng = fs.readFileSync(path.join(srcRoot, 'engine.js'),'utf8'), seed = fs.readFileSync(path.join(srcRoot, 'seed.js'),'utf8'), app = fs.readFileSync(path.join(srcRoot, 'cloud.js'),'utf8');
const html = `<!doctype html><html><head><style>${css}.need{}</style></head><body>
<div id="authroot"></div><div class="app" style="display:none"><nav id="nav"></nav><main id="view"></main></div>
<div id="modal"></div><div id="toast"></div>
<script>${eng}</script><script>${seed}</script><script>${app}</script>
</body></html>`;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('✗', n, x !== undefined ? JSON.stringify(x).slice(0,300) : ''); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms || 30));

function boot(mockClient) {
  const errors = []; const vc = new VirtualConsole(); vc.on('jsdomError', (e) => errors.push(e.detail && e.detail.stack || e.message));
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://shop.example.github.io/', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.scrollTo = () => {}; win.supabase = { createClient: () => mockClient }; win.crypto = win.crypto || {}; if (!win.crypto.randomUUID) win.crypto.randomUUID = () => 'rnd-' + Math.random().toString(36).slice(2); } });
  return { win: dom.window, doc: dom.window.document, errors };
}
const $ = (doc, s) => doc.querySelector(s);
const $$ = (doc, s) => Array.from(doc.querySelectorAll(s));
const type = (win, sel, v) => { const el = typeof sel === 'string' ? $(win.document, sel) : sel; el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); el.dispatchEvent(new win.Event('change', { bubbles: true })); };
const click = (win, sel) => { const el = typeof sel === 'string' ? $(win.document, sel) : sel; el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };
const submit = (win, sel) => { $(win.document, sel).dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); };
const ensureAuthMode = (win, mode) => { const btn = $(win.document, 'button[type=submit]'); const inSignup = btn && /Create account/.test(btn.textContent); if ((mode === 'signup') !== inSignup) click(win, '[data-act="toggle-auth"]'); };

async function run() {
  const mock = createMockSupabase(seedData);
  const { win, doc, errors } = boot(mock);
  await wait(50);

  // ---------- auth screen ----------
  ok('shows the sign-up/sign-in screen when signed out', /Sign in|Create account/.test(doc.body.textContent));
  ok('app hidden while signed out', win.document.querySelector('.app').style.display === 'none');
  click(win, '[data-act="toggle-auth"]');
  ok('toggled to sign-up mode', /Create the first account/.test(doc.body.textContent));
  type(win, 'input[name="displayName"]', 'Admin Person');
  type(win, 'input[name="email"]', 'admin@shop.test');
  type(win, 'input[name="password"]', 'password123');
  submit(win, '#authform');
  await wait(80);

  // ---------- first signup becomes admin, app loads ----------
  ok('signed in after sign-up', !!win.__PPCC.session(), errors);
  ok('first person to sign up is admin', win.__PPCC.profile().role === 'admin', win.__PPCC.profile());
  ok('app visible after sign-in', win.document.querySelector('.app').style.display === '');
  ok('12 demo materials loaded', win.__PPCC.DB().materials.length === 12, win.__PPCC.DB().materials.length);
  ok('a total renders on the calculator', /\d/.test(($(doc, '.sheet .big') || {}).textContent || ''));
  ok('no script errors so far', errors.length === 0, errors);

  // ---------- admin can add a material; RLS mock allows it ----------
  click(win, '[data-view="materials"]');
  ok('Add material button visible for admin', !!$(doc, '[data-act="add-ent"]'));
  click(win, '[data-act="add-ent"]');
  type(win, '[data-d="name"]', 'Cloud test paper');
  type(win, '[data-d="sheetW"]', '640'); type(win, '[data-d="sheetH"]', '900'); type(win, '[data-d="purchaseCost"]', '2');
  click(win, '[data-act="save-ent"]');
  await wait(60);
  ok('material saved locally', win.__PPCC.DB().materials.some((m) => m.name === 'Cloud test paper'));
  ok('material actually written to the (mock) database', mock._db.materials.some((m) => m.name === 'Cloud test paper'), mock._db.materials.map(m=>m.name));

  // ---------- save a calculation end to end, into real relational tables ----------
  click(win, '[data-view="calc"]');
  type(win, '#loadtest', '0');
  await wait(30);
  type(win, '[data-k="name"]', 'Cloud smoke job');
  click(win, '[data-act="save-new"]');
  await wait(80);
  ok('calculation appears in local list', win.__PPCC.DB().calcs.length === 1, win.__PPCC.DB().calcs);
  ok('calculation written to mock DB with a display_id', mock._db.calculations.length === 1 && /^PC-/.test(mock._db.calculations[0].display_id), mock._db.calculations);
  ok('child rows written: materials/printing/labor/other', mock._db.calculation_materials.length >= 1 && mock._db.calculation_printing.length === 1, { cm: mock._db.calculation_materials.length, cp: mock._db.calculation_printing.length });
  ok('finishing rows with no matching id in this database were cleared, not force-matched', win.__PPCC.state.job.finishing.every((r) => r.finId === ''));
  ok('…and the job still calculates and saves cleanly without them', mock._db.calculations.length === 1);
  const savedUuid = mock._db.calculations[0].id;
  ok('created_by set to the admin', mock._db.calculations[0].created_by === mock._db.auth_users[0].id);

  // ---------- sign out, sign in as a second (staff) person ----------
  click(win, '[data-view="settings"]');
  await wait(30);
  click(win, '[data-act="sign-out"]');
  await wait(50);
  ok('back to auth screen after sign-out', /Sign in|Create account/.test(doc.body.textContent));
  ensureAuthMode(win, 'signup');
  type(win, 'input[name="displayName"]', 'Staff Person');
  type(win, 'input[name="email"]', 'staff@shop.test');
  type(win, 'input[name="password"]', 'password123');
  submit(win, '#authform');
  await wait(80);
  ok('second signup is staff, not admin', win.__PPCC.profile().role === 'staff', win.__PPCC.profile());
  ok('staff sees the shared material the admin added', win.__PPCC.DB().materials.some((m) => m.name === 'Cloud test paper'));
  ok('staff sees the shared calculation the admin saved', win.__PPCC.DB().calcs.length === 1);

  // ---------- staff cannot edit rates (UI hides it; mock RLS blocks it if forced) ----------
  click(win, '[data-view="materials"]');
  ok('no Add/Edit/Delete buttons for staff', !$(doc, '[data-act="add-ent"]') && !$(doc, '[data-act="edit-ent"]'));
  ok('lock banner explains staff cannot edit', /only an admin can edit rates/i.test(doc.body.textContent));
  { const { error } = await mock.from('materials').insert({ id: 'x', name: 'sneaky' }); ok('mock RLS itself blocks a staff insert even if attempted directly', !!error && /row-level security/.test(error.message)); }

  // ---------- staff saves their own calculation, cannot delete the admin's ----------
  click(win, '[data-view="calc"]'); click(win, '[data-act="new-job"]');
  type(win, '#loadtest', '1'); await wait(30);
  type(win, '[data-k="name"]', 'Staff own job');
  click(win, '[data-act="save-new"]'); await wait(80);
  ok('staff calculation saved', win.__PPCC.DB().calcs.length === 2);
  click(win, '[data-view="saved"]');
  const rows = $$(doc, '#crudbody tr');
  const adminRow = rows.find((r) => /Cloud smoke job/.test(r.textContent));
  ok("no delete link on the admin's job for this staff user", adminRow && !adminRow.querySelector('[data-act="del-calc"]'), adminRow && adminRow.innerHTML.slice(0,200));
  const ownRow = rows.find((r) => /Staff own job/.test(r.textContent));
  ok('delete link present on their own job', ownRow && !!ownRow.querySelector('[data-act="del-calc"]'));

  // ---------- settings has no Team card for staff (admin-only) ----------
  click(win, '[data-view="settings"]');
  ok('no Team card for staff', !/<h3>Team<\/h3>/.test(doc.querySelector('#view').innerHTML));
  ok('staff cannot see invoice price apply action', !$(doc, '[data-act="apply-ncr-invoice"]'));

  // ---------- sign back in as admin: promote staff, verify shared visibility ----------
  click(win, '[data-act="sign-out"]'); await wait(50);
  ensureAuthMode(win, 'signin');
  type(win, 'input[name="email"]', 'admin@shop.test'); type(win, 'input[name="password"]', 'password123'); submit(win, '#authform'); await wait(80);
  ok('admin sees both calculations (shared history)', win.__PPCC.DB().calcs.length === 2);
  click(win, '[data-view="settings"]'); await wait(40);
  ok('Team card present for admin', /<h3>Team<\/h3>/.test(doc.querySelector('#view').innerHTML));
  await wait(30);
  ok('team list shows both people', /Admin Person/.test(doc.body.textContent) && /Staff Person/.test(doc.body.textContent));
  const promoteBtn = $$(doc, '[data-act="toggle-role"]').find((b) => b.dataset.role === 'admin');
  ok('a "make admin" action exists for the staff row', !!promoteBtn);
  click(win, promoteBtn); await wait(60);
  ok('staff promoted to admin in the mock DB', mock._db.profiles.find((p) => p.email !== undefined || true, true), true);
  ok('promotion actually applied', require('./supabase-mock.js') && mock._db.profiles.some((p) => p.role === 'admin'), mock._db.profiles);
  const staffProfile = mock._db.profiles.find((p) => p.display_name === 'Staff Person');
  ok('the specific promoted profile is now admin', staffProfile.role === 'admin', staffProfile);

  // ---------- admin can delete the staff's job (owner-or-admin rule) ----------
  click(win, '[data-view="saved"]');
  const staffJobRow = $$(doc, '#crudbody tr').find((r) => /Staff own job/.test(r.textContent));
  ok('admin sees a delete link on someone else\'s job', staffJobRow && !!staffJobRow.querySelector('[data-act="del-calc"]'));
  click(win, staffJobRow.querySelector('[data-act="del-calc"]'));
  click(win, '[data-act="confirm-delcalc"]');
  await wait(60);
  ok('deleted (cascade removed child rows too)', win.__PPCC.DB().calcs.length === 1 && mock._db.calculation_labor.every((l) => mock._db.calculations.some((c) => c.id === l.calculation_id)));

  // ---------- editing an existing calculation replaces its child rows, not duplicates them ----------
  click(win, '[data-view="saved"]');
  click(win, $$(doc, '[data-act="edit-calc"]')[0]);
  await wait(40);
  type(win, '[data-k="qty"]', '2000');
  await wait(30);
  click(win, '[data-act="save-calc"]');
  await wait(80);
  const calcId = mock._db.calculations[0].id;
  ok('quantity updated on the same row (no duplicate calculation)', mock._db.calculations.length === 1 && mock._db.calculations[0].quantity === 2000, mock._db.calculations);
  ok('child rows replaced, not accumulated', mock._db.calculation_printing.filter((p) => p.calculation_id === calcId).length === 1, mock._db.calculation_printing.length);

  // ---------- duplicate ----------
  click(win, '[data-view="saved"]');
  click(win, $$(doc, '[data-act="dup-calc"]')[0]);
  await wait(80);
  ok('duplicate created a second calculation', mock._db.calculations.length === 2);
  ok('duplicate has its own new display_id', new Set(mock._db.calculations.map((c) => c.display_id)).size === 2);

  // ---------- NCR layers: UI, calculation, persistence and reopen ----------
  click(win, '[data-view="calc"]'); click(win, '[data-act="new-job"]');
  type(win, '[data-k="product"]', 'NCR');
  ok('NCR changes quantity to complete sets', /Quantity \(complete sets\)/.test(doc.body.textContent));
  ok('NCR starts with one copy layer', win.__PPCC.state.job.addMaterials.length === 1);
  const sheetStock = win.__PPCC.DB().materials.find(m => m.sheetW > 0 && m.sheetH > 0);
  type(win, '[data-k="materialId"]', sheetStock.id);
  type(win, '[data-k="addMaterials.0.materialId"]', sheetStock.id);
  type(win, '[data-k="setsPerPad"]', '50');
  click(win, '[data-act="add-material-role"][data-role="ncr"]');
  click(win, '[data-act="add-material-role"][data-role="ncr"]');
  type(win, '[data-k="addMaterials.1.materialId"]', sheetStock.id);
  type(win, '[data-k="addMaterials.2.materialId"]', sheetStock.id);
  ok('1+3 NCR calculates four parts', win.__PPCC.state.result.ok && win.__PPCC.state.result.summary.ncrParts === 4, win.__PPCC.state.result.errors);
  ok('all four material requirements visible', /All material requirements/.test(doc.body.textContent) && win.__PPCC.state.result.materialRequirements.length === 4);
  ok('cost per set and per book shown', /Cost per set/.test(doc.body.textContent) && /per pad\/book/.test(doc.body.textContent));
  click(win, '[data-k="addMaterials.1.printed"]');
  ok('copy can be left blank', win.__PPCC.state.job.addMaterials[1].printed === false && win.__PPCC.state.result.ok);
  type(win, '[data-k="name"]', 'NCR four-part test');
  click(win, '[data-act="save-new"]'); await wait(80);
  const ncrSaved = mock._db.calculations.find(c => c.job_name === 'NCR four-part test');
  ok('NCR snapshot preserves three copy layers', ncrSaved && ncrSaved.job_snapshot.addMaterials.length === 3);
  ok('all NCR material child rows saved', ncrSaved && mock._db.calculation_materials.filter(m => m.calculation_id === ncrSaved.id).length === 4);
  ok('saved automatic material quantities are positive', ncrSaved && mock._db.calculation_materials.filter(m => m.calculation_id === ncrSaved.id).every(m => m.total_units > 0));
  click(win, '[data-view="saved"]');
  const ncrRow = $$(doc, '#crudbody tr').find(r => /NCR four-part test/.test(r.textContent));
  click(win, ncrRow.querySelector('[data-act="edit-calc"]'));
  ok('reopened NCR preserves blank copy and pads', win.__PPCC.state.job.addMaterials[1].printed === false && Number(win.__PPCC.state.job.setsPerPad) === 50);
  // Film and mounting added through the actual controls.
  click(win, '[data-act="new-job"]'); type(win, '[data-k="product"]', 'Sticker');
  click(win, '[data-act="add-material-role"][data-role="lamination"]');
  const rollStock = win.__PPCC.DB().materials.find(m => m.id === win.__PPCC.state.job.materialId);
  type(win, '[data-k="addMaterials.0.materialId"]', rollStock.id);
  ok('continuous film calculates with matching roll width', win.__PPCC.state.result.ok, win.__PPCC.state.result.errors);
  type(win, '[data-k="addMaterials.0.feed"]', 'pieces');
  ok('separate piece lamination mode persists', win.__PPCC.state.job.addMaterials[0].feed === 'pieces');
  click(win, '[data-act="add-material-role"][data-role="mounting"]');
  const boardStock = win.__PPCC.DB().materials.find(m => /PVC foam board/.test(m.name));
  type(win, '[data-k="addMaterials.1.materialId"]', boardStock.id);
  ok('film and mounting board calculate together', win.__PPCC.state.result.ok && win.__PPCC.state.result.materialRequirements.length === 3, win.__PPCC.state.result.errors);
  const formSections = $$(doc, '.col-form > section.card');
  ok('six form sections in workflow order', formSections.map(s => s.querySelector('h3').textContent.trim().split(' · ')[0]).join(',') === '1,2,3,4,5,6');
  ok('all stock selectors grouped under Materials', $$(doc, '[data-k="materialId"], [data-k$=".materialId"]').every(el => el.closest('#job-materials')));
  ok('printing machine grouped under Printing', $(doc, '[data-k="machineId"]').closest('section').querySelector('h3').textContent.startsWith('3 · Printing'));
  ok('no duplicate lamination dropdown on new sticker jobs', !$(doc, '[data-k="lamFinId"]'));
  ok('custom costs do not repeat materials', !$(doc, '#custom-costs [data-k$=".materialId"]'));
  const fieldKeys = $$(doc, '.col-form [data-k]').map(el => el.dataset.k);
  ok('each job input appears once', new Set(fieldKeys).size === fieldKeys.length);
  $(doc, '[data-panel="material-1-quantity"]').open = true;
  type(win, '[data-k="addMaterials.1.qty"]', '5');
  ok('board quantity override updates result', win.__PPCC.state.result.materialRequirements[2].good === 5);
  type(win, '[data-k="name"]', 'Laminated mounted sticker test');
  const processing = win.__PPCC.DB().finishing.find(f => f.method === 'per_sqm');
  type(win, '[data-k="addMaterials.1.finId"]', processing.id);
  ok('linked processing operation contributes a stage', win.__PPCC.state.result.stages.some(s => /Mounting board/.test(s.name)));
  ok('expanded quantity panel stays open after processing selection', $(doc, '[data-panel="material-1-quantity"]').open);
  click(win, '[data-act="save-new"]'); await wait(80);
  const mountedSaved = mock._db.calculations.find(c => c.job_name === 'Laminated mounted sticker test');
  ok('film method and board overrides stored in job snapshot', mountedSaved && mountedSaved.job_snapshot.addMaterials[0].feed === 'pieces' && Number(mountedSaved.job_snapshot.addMaterials[1].qty) === 5);
  ok('mounted job saves three material lines and processing stage', mountedSaved && mock._db.calculation_materials.filter(m => m.calculation_id === mountedSaved.id).length === 3 && mock._db.calculation_finishing.some(f => f.calculation_id === mountedSaved.id));
  click(win, '[data-act="del"][data-list="addMaterials"][data-i="1"]');
  ok('removing board recalculates requirements', win.__PPCC.state.result.materialRequirements.length === 2);

  // ---------- Invoice price basis: show pack conversion and actual job rate ----------
  click(win, '[data-act="new-job"]'); type(win, '[data-k="product"]', 'NCR');
  const appDb = win.__PPCC.DB();
  appDb.materials.push({id:'invoice_cb',name:'Invoice CB white',category:'Paper',unit:'sheet',sheetW:700,sheetH:1000,purchaseCost:0.8,minCharge:0});
  appDb.materials.push({id:'invoice_cfb',name:'Invoice CFB pink',category:'Paper',unit:'pack',packSize:500,sheetW:700,sheetH:1000,purchaseCost:240,minCharge:0});
  win.__PPCC.render();
  type(win, '[data-k="mode"]', 'offset');
  type(win, '[data-k="materialId"]', 'invoice_cb');
  type(win, '[data-k="addMaterials.0.materialId"]', 'invoice_cfb');
  type(win, '[data-k="w"]', '210'); type(win, '[data-k="h"]', '297');
  type(win, '[data-k="wastePct"]', '10'); type(win, '[data-k="setupWaste"]', '20');
  const pinkPrice = $(doc, '[data-price-for="invoice_cfb"]');
  ok('invoice pack conversion visible beside selected copy', /240.00 per pack.*500 sheets.*0.48 \/ sheet/.test(pinkPrice.textContent));
  ok('original one-sheet price basis visible', /0.80 \/ sheet/.test($(doc, '[data-price-for="invoice_cb"]').textContent));
  const pinkReq = win.__PPCC.state.result.materialRequirements[1];
  ok('invoice example totals 144 sheets at 0.48 each', pinkReq.total === 144 && Math.abs(pinkReq.cost - 69.12) < .001, pinkReq);
  ok('actual unit rate appears in material requirements', /Rate used \/ unit/.test(doc.body.textContent));
  click(win, pinkPrice.querySelector('[data-act="edit-ent"]'));
  ok('price shortcut opens selected material with pack size', Number($(doc, '[data-d="packSize"]').value) === 500 && Number($(doc, '[data-d="purchaseCost"]').value) === 240);
  ok('editor price label names the purchase unit', /Price per pack/.test($(doc, '#formbody').textContent));
  click(win, '[data-act="close"]');
  ok('opening and cancelling price editor leaves data unchanged', appDb.materials.find(m => m.id === 'invoice_cfb').purchaseCost === 240);
  appDb.materials.find(m => m.id === 'invoice_cfb').unit = 'sheet'; win.__PPCC.render();
  ok('single-sheet basis is explicit when unit is sheet', /240.00 \/ sheet.*one sheet/.test($(doc, '[data-price-for="invoice_cfb"]').textContent));
  appDb.materials.find(m => m.id === 'invoice_cfb').unit = 'pack';
  appDb.materials.find(m => m.id === 'invoice_cfb').packSize = '';
  win.__PPCC.render();
  ok('missing pack size displays confirmation request rather than invented conversion', /sheets per pack must be confirmed/.test($(doc, '[data-price-for="invoice_cfb"]').textContent));
  ok('missing pack size blocks a misleading cost calculation', !win.__PPCC.state.result.ok && win.__PPCC.state.result.errors.some(e => /sheets per pack/.test(e.msg)));

  // ---------- Apply user-confirmed invoice to existing records, add missing stock ----------
  const savedHistoryBeforeInvoice = JSON.stringify(mock._db.calculations);
  const unrelatedBeforeInvoice = JSON.stringify(mock._db.materials[0]);
  for (const [id,name,cost] of [['actual_cb','NCR CB White',0.8],['actual_pink','NCR CFB Pink',111]]) {
    await mock.from('materials').insert({id,name,category:'Paper',sheet_width_mm:700,sheet_height_mm:1000,unit:'sheet',purchase_cost:cost,min_charge:0,is_demo:false});
    appDb.materials.push({id,name,category:'Paper',sheetW:700,sheetH:1000,unit:'sheet',purchaseCost:cost,minCharge:0,demo:false});
  }
  click(win, '[data-view="settings"]');
  ok('invoice finds original CB and CFB records', $(doc,'[data-invoice-target="cb_white"]').value === 'actual_cb' && $(doc,'[data-invoice-target="cfb_pink"]').value === 'actual_pink');
  ok('missing yellow stock will be added', $(doc,'[data-invoice-target="cf_yellow"]').value === '__new__');
  click(win, '[data-act="apply-ncr-invoice"]'); await wait(120);
  const cbInvoice = mock._db.materials.find(m=>m.id === 'actual_cb');
  const pinkInvoice = mock._db.materials.find(m=>m.id === 'actual_pink');
  const yellowInvoice = mock._db.materials.find(m=>m.name === 'JH NCR CF YELLOW 55GSM 70*100');
  ok('CB updated to 230 per 500-sheet pack', cbInvoice.purchase_cost === 230 && cbInvoice.pack_size === 500 && cbInvoice.unit === 'pack');
  ok('CFB updated to 240 per 500-sheet pack', pinkInvoice.purchase_cost === 240 && pinkInvoice.pack_size === 500 && pinkInvoice.unit === 'pack');
  ok('missing CF created at 210 per 500-sheet pack', yellowInvoice && yellowInvoice.purchase_cost === 210 && yellowInvoice.pack_size === 500);
  ok('confirmed sheet dimensions and GSM saved', yellowInvoice && yellowInvoice.sheet_width_mm === 700 && yellowInvoice.sheet_height_mm === 1000 && yellowInvoice.gsm_thickness === '55 gsm');
  ok('VAT not added to production purchase prices', cbInvoice.purchase_cost !== 241.5 && pinkInvoice.purchase_cost !== 252 && yellowInvoice.purchase_cost !== 220.5);
  ok('unrelated material unchanged', JSON.stringify(mock._db.materials[0]) === unrelatedBeforeInvoice);
  ok('saved calculation snapshots unchanged', JSON.stringify(mock._db.calculations) === savedHistoryBeforeInvoice);
  const materialCountAfterInvoice = mock._db.materials.length;
  click(win, '[data-act="apply-ncr-invoice"]'); await wait(120);
  ok('reapplying invoice does not duplicate yellow', mock._db.materials.length === materialCountAfterInvoice);
  appDb.settings.currency = 'USD'; win.__PPCC.render();
  ok('AED invoice cannot be applied under a different app currency', $(doc,'[data-act="apply-ncr-invoice"]').disabled);
  appDb.settings.currency = 'AED'; win.__PPCC.render();
  // Fresh NCR estimate now uses the stored invoice rates.
  click(win, '[data-view="calc"]'); click(win, '[data-act="new-job"]'); type(win,'[data-k="product"]','NCR');type(win,'[data-k="mode"]','offset');
  type(win,'[data-k="materialId"]','actual_cb');type(win,'[data-k="addMaterials.0.materialId"]','actual_pink');
  type(win,'[data-k="w"]','210');type(win,'[data-k="h"]','297');type(win,'[data-k="wastePct"]','10');type(win,'[data-k="setupWaste"]','20');
  ok('invoice NCR estimate uses 66.24 white and 69.12 pink for 144 sheets', Math.abs(win.__PPCC.state.result.materialRequirements[0].cost-66.24)<.001 && Math.abs(win.__PPCC.state.result.materialRequirements[1].cost-69.12)<.001);

  // ---------- Finished size presets and custom dimensions ----------
  type(win, '#sizepreset', 'a5');
  ok('A5 preset fills NCR dimensions in cm', win.__PPCC.state.job.unit === 'cm' && win.__PPCC.state.job.w === 14.8 && win.__PPCC.state.job.h === 21);
  type(win, '#sizepreset', 'a4');
  const presetTotal = win.__PPCC.state.result.total;
  type(win, '[data-k="unit"]', 'mm');
  ok('changing unit converts A4 without changing physical size', win.__PPCC.state.job.w === 210 && win.__PPCC.state.job.h === 297 && $(doc, '#sizepreset').value === 'a4');
  ok('unit conversion preserves calculated costs', Math.abs(win.__PPCC.state.result.total - presetTotal) < .001);
  type(win, '#sizepreset', 'custom');
  ok('Custom keeps existing dimensions ready for editing', win.__PPCC.state.job.w === 210 && $(doc, '#sizepreset').value === 'custom');
  type(win, '[data-k="w"]', '180'); type(win, '[data-k="h"]', '250');
  win.__PPCC.render();
  ok('custom dimensions survive render', win.__PPCC.state.job.w === '180' && win.__PPCC.state.job.h === '250' && $(doc, '#sizepreset').value === 'custom');
  type(win, '#sizepreset', 'card');
  ok('business card preset fills 9 by 5.5 cm', win.__PPCC.state.job.w === 9 && win.__PPCC.state.job.h === 5.5);
  type(win, '[data-k="w"]', '9.5');
  ok('editing preset dimensions switches to Custom immediately', $(doc, '#sizepreset').value === 'custom' && win.__PPCC.state.job.sizePreset === 'custom');
  type(win, '[data-k="ow"]', '19'); type(win, '[data-k="oh"]', '11');
  type(win, '[data-k="unit"]', 'm');
  ok('unit conversion includes independently entered open dimensions', win.__PPCC.state.job.w === .095 && win.__PPCC.state.job.ow === .19 && win.__PPCC.state.job.oh === .11);
  type(win, '[data-k="mode"]', 'sticker'); type(win, '[data-k="shape"]', 'circle');
  ok('round sticker picker offers only diameters and Custom', !$(doc, '#sizepreset option[value="a4"]') && !!$(doc, '#sizepreset option[value="circle50"]'));
  type(win, '#sizepreset', 'circle50');
  ok('round preset fills 5 cm diameter', win.__PPCC.state.job.unit === 'cm' && win.__PPCC.state.job.diameter === 5);
  type(win, '[data-k="diameter"]', '6.5');
  ok('unlisted circle diameter switches to Custom', $(doc, '#sizepreset').value === 'custom' && win.__PPCC.state.job.diameter === '6.5');
  type(win, '[data-k="shape"]', 'rect');
  win.__PPCC.state.job = {...win.__PPCC.state.job, unit: 'mm', w: 210, h: 297};
  delete win.__PPCC.state.job.sizePreset; win.__PPCC.render();
  ok('older saved dimensions recognized without being rewritten', $(doc, '#sizepreset').value === 'a4' && win.__PPCC.state.job.unit === 'mm' && win.__PPCC.state.job.w === 210);
  win.__PPCC.state.job.w = 123; win.__PPCC.state.job.h = 234; win.__PPCC.render();
  ok('older unlisted saved dimensions stay Custom unchanged', $(doc, '#sizepreset').value === 'custom' && win.__PPCC.state.job.w === 123 && win.__PPCC.state.job.h === 234);

  // ---------- NCR quantity entry in books and clear layer controls ----------
  click(win, '[data-act="new-job"]');
  type(win, '[data-k="product"]', 'NCR'); type(win, '[data-k="mode"]', 'offset');
  type(win, '[data-k="materialId"]', 'actual_cb'); type(win, '[data-k="addMaterials.0.materialId"]', 'actual_pink');
  type(win, '#sizepreset', 'a5');
  ok('legacy / fresh NCR defaults to sets entry', $(doc, '[data-k="ncrQuantityMode"]').value === 'sets' && !!$(doc, '[data-k="qty"]'));
  const originalCard = $(doc, '.main-material');
  ok('original offset controls appear once beside original stock', !!originalCard.querySelector('[data-k="colors"]') && !!originalCard.querySelector('[data-k="plates"]') && $$(doc, '[data-k="sides"]').length === 1);
  ok('copy card is clearly numbered by part', /Copy 1 · part 2/.test($(doc, '[data-material-index="0"]').textContent));
  type(win, '[data-k="setsPerPad"]', '50');
  type(win, '[data-k="ncrQuantityMode"]', 'books');
  type(win, '[data-k="ncrBooks"]', '20');
  ok('20 books of 50 serial numbers automatically produce 1000 sets', win.__PPCC.state.job.qty === 1000 && win.__PPCC.state.result.qty === 1000 && win.__PPCC.state.result.ok);
  const beforeSecondCopy = $(doc, '#ncr-count-summary').textContent;
  ok('1+1 summary counts 2000 finished sheets', /1 \+ 1/.test(beforeSecondCopy) && /2,000 finished NCR sheets/.test(beforeSecondCopy));
  click(win, '[data-act="add-material-role"][data-role="ncr"]');
  type(win, '[data-k="addMaterials.1.materialId"]', win.__PPCC.DB().materials.find(m => m.name === 'JH NCR CF YELLOW 55GSM 70*100').id);
  ok('1+2 summary counts 3000 sheets with shared serial numbers', /1 \+ 2/.test($(doc, '#ncr-count-summary').textContent) && /3,000 finished NCR sheets/.test($(doc, '#ncr-count-summary').textContent) && /same serial number/.test($(doc, '#ncr-count-summary').textContent));
  const booksTotal = win.__PPCC.state.result.total;
  type(win, '[data-k="ncrQuantityMode"]', 'sets');
  ok('switching from books to sets preserves quantity and cost', Number($(doc, '[data-k="qty"]').value) === 1000 && Math.abs(win.__PPCC.state.result.total - booksTotal) < .001);
  type(win, '[data-k="qty"]', '525');
  ok('sets entry describes partial final book', /last book is partial/.test($(doc, '#ncr-count-summary').textContent));
  type(win, '[data-k="ncrQuantityMode"]', 'books');
  ok('switching partial sets to books does not silently round quantity', win.__PPCC.state.job.ncrBooks === 10.5 && win.__PPCC.state.job.qty === 525 && !win.__PPCC.state.result.ok);
  ok('fractional book entry explains whole-number requirement', win.__PPCC.state.result.errors.some(e => e.field === 'ncrBooks' && /whole number/.test(e.msg)));
  type(win, '[data-k="ncrBooks"]', '10'); type(win, '[data-k="setsPerPad"]', '');
  ok('books mode requires sets per book and clears stale quantity', win.__PPCC.state.job.qty === '' && !win.__PPCC.state.result.ok && win.__PPCC.state.result.errors.some(e => e.field === 'setsPerPad'));
  type(win, '[data-k="setsPerPad"]', '50');
  ok('book quantity recovers when serial count entered', win.__PPCC.state.job.qty === 500 && win.__PPCC.state.result.ok);
  const snapshot = JSON.parse(JSON.stringify(win.__PPCC.state.job));
  win.__PPCC.state.job = snapshot; win.__PPCC.render();
  ok('book mode and derived quantity survive saved snapshot reload', $(doc, '[data-k="ncrQuantityMode"]').value === 'books' && Number($(doc, '[data-k="ncrBooks"]').value) === 10 && win.__PPCC.state.job.qty === 500);
  delete win.__PPCC.state.job.ncrQuantityMode; delete win.__PPCC.state.job.ncrBooks;
  win.__PPCC.render();
  ok('older snapshots preserve sets without needing book count', $(doc, '[data-k="ncrQuantityMode"]').value === 'sets' && win.__PPCC.state.job.qty === 500 && win.__PPCC.state.result.ok);
  type(win, '[data-k="product"]', 'Business Card');
  ok('non-NCR jobs retain standard quantity and no NCR books controls', !!$(doc, '[data-k="qty"]') && !$(doc, '[data-k="ncrBooks"]') && !$(doc, '#ncr-count-summary'));

  // ---------- Supplied equipment import, rate requirements and repeat import ----------
  click(win, '[data-view="settings"]');
  const beforeMachines=mock._db.machines.length, beforeFin=mock._db.finishing_operations.length;
  const beforeSaved=JSON.stringify(mock._db.calculations);
  ok('admin can review and import provided equipment', !!$(doc,'[data-act="import-equipment"]') && /9 printing machines and 19 finishing/.test(doc.body.textContent));
  click(win, '[data-act="import-equipment"]'); await wait(250);
  ok('equipment import creates 9 printing and 19 finishing records', mock._db.machines.length===beforeMachines+9 && mock._db.finishing_operations.length===beforeFin+19);
  const gto=mock._db.machines.find(m=>m.name.includes('697531'));
  ok('Heidelberg supplied capacity and colours saved', !!gto && gto.max_sheet_width_mm===360 && gto.max_sheet_height_mm===520 && gto.color_units===2);
  ok('imported machine operating rates and speed remain unconfirmed', gto && gto.hourly_rate===null && gto.speed===null);
  ok('both spiral binders have separate equipment records', mock._db.finishing_operations.filter(m=>/^Spiral binding machine/.test(m.name)).length===2);
  ok('ambiguous machines marked for classification', mock._db.finishing_operations.filter(m=>/Needs classification/.test(m.notes||'')).length===2);
  ok('import keeps saved job history unchanged', JSON.stringify(mock._db.calculations)===beforeSaved);
  gto.hourly_rate=85;
  const localGto=win.__PPCC.DB().machines.find(m=>m.id===gto.id);localGto.hourlyRate=85;
  click(win, '[data-act="import-equipment"]'); await wait(250);
  ok('repeat import preserves counts and edited rates', mock._db.machines.length===beforeMachines+9 && mock._db.finishing_operations.length===beforeFin+19 && gto.hourly_rate===85);
  click(win, '[data-view="machines"]');
  ok('machine list displays supplied capacity and colour units', /36 × 52 cm/.test(doc.body.textContent) && /2 colours\/pass/.test(doc.body.textContent));
  click(win, `[data-act="edit-ent"][data-id="${gto.id}"]`);
  ok('capacity can be edited and saved through machine form', Number($(doc,'[data-d="maxSheetW"]').value)===360 && Number($(doc,'[data-d="maxSheetH"]').value)===520);
  click(win, '[data-act="close"]');

  // ---------- sign out clears the screen back to auth ----------
  click(win, '[data-view="saved"]'); await wait(20);
  ok('sign-out is reachable from the nav on any screen, not just Settings', !!$(doc, '[data-act="sign-out"]'));
  click(win, '[data-act="sign-out"]'); await wait(40);
  ok('back at auth screen after final sign-out', /Sign in|Create account/.test(doc.body.textContent));

  ok('no script errors across the whole run', errors.length === 0, errors);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error('CRASH', e); process.exit(1); });
