const Seed = require(require('fs').existsSync(require('path').join(__dirname, '../src/seed.js')) ? '../src/seed.js' : './seed.js');
const db = Seed.build();
function toRow(map, obj) { const o = {}; map.forEach(([k,j]) => { let v = obj[j||k]; if (v==='' || v===undefined) v=null; o[k]=v; }); return o; }
const M = {
  materials: [['id'],['name'],['category'],['gsm_thickness','gsm'],['sheet_width_mm','sheetW'],['sheet_height_mm','sheetH'],['roll_width_mm','rollWidth'],['roll_length_m','rollLength'],['unit'],['pack_size','packSize'],['purchase_cost','purchaseCost'],['min_charge','minCharge'],['supplier'],['notes'],['is_demo','demo']],
  machines: [['id'],['name'],['machine_type','type'],['hourly_rate','hourlyRate'],['setup_rate','setupRate'],['speed'],['color_units','colorUnits'],['click_color','clickColor'],['click_bw','clickBW'],['cost_per_impression','costPerImpression'],['cost_per_sqm','costPerSqm'],['notes'],['is_demo','demo']],
  finishing_operations: [['id'],['name'],['pricing_method','method'],['rate'],['setup_cost','setupCost'],['min_charge','minCharge'],['notes'],['is_demo','demo']],
  labor_rates: [['id'],['category'],['hourly_cost','hourlyCost'],['notes'],['is_demo','demo']]
};
let uidn = 0; const uid = () => 'seed-uuid-' + (++uidn);
const materials = db.materials.map(m => Object.assign(toRow(M.materials, m), {id: uid()}));
const machines = db.machines.map(m => Object.assign(toRow(M.machines, m), {id: uid()}));
const finishing_operations = db.finishing.map(m => Object.assign(toRow(M.finishing_operations, m), {id: uid()}));
const labor_rates = db.labor.map(m => Object.assign(toRow(M.labor_rates, m), {id: uid()}));
const settings = [{ key: 'app', value: { currency: db.settings.currency, unitDecimals: db.settings.unitDecimals, printing: db.settings.printing, minimums: db.settings.minimums } }];
const waste_defaults = Object.keys(db.settings.waste).map(method => ({ method, waste_pct: db.settings.waste[method].pct, setup_waste: db.settings.waste[method].setup, min_waste: db.settings.waste[method].min }));
module.exports = { materials, machines, finishing_operations, labor_rates, settings, waste_defaults, calculations: [], calculation_materials: [], calculation_printing: [], calculation_finishing: [], calculation_labor: [], calculation_other_costs: [], profiles: [], auth_users: [] };
