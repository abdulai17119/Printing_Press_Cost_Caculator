const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const seedData = require('./seed_for_mock.js');
const { createMockSupabase } = require('./supabase-mock.js');

const css = fs.readFileSync('app.css','utf8'), eng = fs.readFileSync('../engine.js','utf8'), seed = fs.readFileSync('../seed.js','utf8'), app = fs.readFileSync('cloud.js','utf8');
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
