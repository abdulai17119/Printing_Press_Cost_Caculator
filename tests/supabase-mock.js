/* A deliberately faithful mock of the exact supabase-js v2 surface cloud.js calls,
   backed by an in-memory store that enforces the SAME row-level-security rules
   verified live against the real project. This proves cloud.js's control flow,
   error handling and permission logic — it cannot prove the real network round-trip. */
function createMockSupabase(seedRows) {
  const db = JSON.parse(JSON.stringify(seedRows)); // {materials:[],machines:[],finishing_operations:[],labor_rates:[],settings:[],waste_defaults:[],calculations:[],calculation_materials:[],...,profiles:[],auth_users:[]}
  let seq = 0;
  let currentUser = null;
  const listeners = [];
  const uuid = () => 'uuid-' + (++seq) + '-' + Math.random().toString(36).slice(2, 8);
  const isAdmin = (uid) => { const p = db.profiles.find((x) => x.id === uid); return !!p && p.role === 'admin'; };
  const err = (message) => ({ message });

  const RATE_TABLES = ['materials', 'machines', 'finishing_operations', 'labor_rates', 'settings', 'waste_defaults'];
  const CHILD_TABLES = ['calculation_materials', 'calculation_printing', 'calculation_finishing', 'calculation_labor', 'calculation_other_costs'];

  function canWriteRateTable() { return currentUser && isAdmin(currentUser.id); }
  function canWriteCalc(row) { return currentUser && (row.created_by === currentUser.id || isAdmin(currentUser.id)); }
  function canWriteChild(calcId) { const c = db.calculations.find((x) => x.id === calcId); return c && canWriteCalc(c); }

  function query(table) {
    let filters = [];
    const applyFilters = (rows) => rows.filter((r) => filters.every((f) => f.op === 'eq' ? r[f.col] === f.val : true));
    const api = {
      select(cols) { this._select = true; return this; },
      eq(col, val) { filters.push({ op: 'eq', col, val }); return this; },
      order() { return this; },
      maybeSingle() { const rows = applyFilters(db[table] || []); return Promise.resolve(rows.length ? { data: clone(rows[0]), error: null } : { data: null, error: null }); },
      single() {
        const base = this._pending || Promise.resolve({ data: clone(applyFilters(db[table] || [])), error: null });
        return base.then((res) => { if (res.error) return res; const rows = Array.isArray(res.data) ? res.data : [res.data]; return rows.length === 1 ? { data: clone(rows[0]), error: null } : { data: null, error: err('not found') }; });
      },
      then(resolve, reject) {
        if (!this._pending) this._pending = Promise.resolve({ data: clone(applyFilters(db[table] || [])), error: null });
        return this._pending.then(resolve, reject);
      },
      insert(rows) {
        const arr = Array.isArray(rows) ? rows : [rows];
        this._pending = Promise.resolve().then(() => {
          if (!currentUser) return { data: null, error: err('permission denied: not signed in') };
          for (const r of arr) {
            if (RATE_TABLES.includes(table) && !canWriteRateTable()) return { data: null, error: err('new row violates row-level security policy') };
            if (table === 'calculations' && r.created_by && r.created_by !== currentUser.id) return { data: null, error: err('new row violates row-level security policy') };
            if (CHILD_TABLES.includes(table) && !canWriteChild(r.calculation_id)) return { data: null, error: err('new row violates row-level security policy') };
          }
          const out = arr.map((r) => {
            const row = clone(r);
            if (table === 'calculations') { row.id = row.id || uuid(); row.display_id = 'PC-' + String(++seq).padStart(4, '0'); row.created_by = currentUser.id; row.created_at = new Date().toISOString(); }
            else if (!row.id) row.id = uuid();
            db[table].push(row);
            return row;
          });
          return { data: clone(out), error: null };
        });
        return this;
      },
      upsert(rows) {
        const arr = Array.isArray(rows) ? rows : [rows];
        this._pending = Promise.resolve().then(() => {
          if (!canWriteRateTable()) return { data: null, error: err('new row violates row-level security policy (upsert)') };
          arr.forEach((r) => { const i = db[table].findIndex((x) => x.id === r.id); if (i >= 0) db[table][i] = clone(r); else db[table].push(clone(r)); });
          return { data: clone(arr), error: null };
        });
        return this;
      },
      update(patch) {
        this._pending = Promise.resolve().then(() => {
          const rows = applyFilters(db[table] || []);
          for (const r of rows) {
            if (RATE_TABLES.includes(table) && table !== 'settings' && table !== 'waste_defaults' && !canWriteRateTable()) return { data: null, error: err('permission denied for update') };
            if ((table === 'settings' || table === 'waste_defaults') && !canWriteRateTable()) return { data: null, error: err('permission denied for update') };
            if (table === 'calculations' && !canWriteCalc(r)) return { data: null, error: err('permission denied for update') };
            if (table === 'profiles') {
              const isSelf = r.id === currentUser.id;
              if (!isSelf && !isAdmin(currentUser.id)) return { data: null, error: err('permission denied for update') };
              if (isSelf && !isAdmin(currentUser.id) && patch.role && patch.role !== r.role) return { data: null, error: err('permission denied: cannot change your own role') };
            }
          }
          rows.forEach((r) => Object.assign(r, patch));
          return { data: clone(rows), error: null };
        });
        return this;
      },
      delete() {
        this._pending = Promise.resolve().then(() => {
          const rows = applyFilters(db[table] || []);
          for (const r of rows) {
            if (RATE_TABLES.includes(table) && !canWriteRateTable()) return { data: null, error: err('permission denied for delete') };
            if (table === 'calculations' && !canWriteCalc(r)) return { data: null, error: err('permission denied for delete') };
            if (CHILD_TABLES.includes(table) && !canWriteChild(r.calculation_id)) return { data: null, error: err('permission denied for delete (cascade)') };
          }
          const keep = (db[table] || []).filter((r) => !rows.includes(r));
          const removedIds = rows.map((r) => r.id);
          db[table] = keep;
          if (table === 'calculations') { CHILD_TABLES.forEach((ct) => { db[ct] = db[ct].filter((c) => !removedIds.includes(c.calculation_id)); }); }
          if (table === 'profiles') { /* no cascade needed for the mock */ }
          return { data: clone(rows), error: null };
        });
        return this;
      }
    };
    return api;
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  return {
    _db: db, _setUser: (u) => { currentUser = u; },
    from: (table) => query(table),
    auth: {
      async signUp({ email, password, options }) {
        if (db.auth_users.find((u) => u.email === email)) return { data: null, error: err('User already registered') };
        const id = uuid(); const user = { id, email };
        db.auth_users.push(user);
        const role = db.profiles.length === 0 ? 'admin' : 'staff';
        db.profiles.push({ id, display_name: (options && options.data && options.data.display_name) || email.split('@')[0], role });
        const session = { user, access_token: 'mock-' + id };
        currentUser = user;
        listeners.forEach((cb) => cb('SIGNED_IN', session));
        return { data: { user, session }, error: null };
      },
      async signInWithPassword({ email, password }) {
        const user = db.auth_users.find((u) => u.email === email);
        if (!user || (user.password && user.password !== password)) return { data: null, error: err('Invalid login credentials') };
        const session = { user, access_token: 'mock-' + user.id };
        currentUser = user;
        listeners.forEach((cb) => cb('SIGNED_IN', session));
        return { data: { user, session }, error: null };
      },
      async signOut() { currentUser = null; listeners.forEach((cb) => cb('SIGNED_OUT', null)); return { error: null }; },
      async getSession() { return { data: { session: currentUser ? { user: currentUser, access_token: 'mock-' + currentUser.id } : null } }; },
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; }
    }
  };
}
if (typeof module !== 'undefined') module.exports = { createMockSupabase };
