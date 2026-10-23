const { synchronizeInvoices } = require('../billing');

const COLLECTIONS = ['clients', 'billing', 'payments', 'napBoxes', 'napPorts',
  'complaints', 'installs', 'inventory'];

class VersionConflictError extends Error {
  constructor(current){
    super('The data was changed by another device');
    this.current = current;
  }
}

function isValidState(state){
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) return false;
  if (!Array.isArray(state.clients)) return false;
  return COLLECTIONS.every(key => state[key] === undefined || Array.isArray(state[key]));
}

function parseBaseVersion(value){
  if (value === null || value === undefined) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) && version > 0 ? version : undefined;
}

async function inTransaction(pool, work){
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    const result = await work(connection);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

// Server-side invoice generation is deterministic and is repeated by every client
// before it saves, so it does not bump the version (that would cause false conflicts).
async function loadState(pool, today){
  return inTransaction(pool, async connection => {
    const result = await connection.query('SELECT data, version FROM app_state WHERE id = 1 FOR UPDATE');
    const row = result.rows[0];
    if (!row) return { state: null, version: null };
    const state = row.data;
    if (state && synchronizeInvoices(state, today)) {
      await connection.query('UPDATE app_state SET data = $1::jsonb, updated_at = now() WHERE id = 1',
        [JSON.stringify(state)]);
    }
    return { state, version: Number(row.version) };
  });
}

function canonicalJSON(value){
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

async function saveState(pool, state, baseVersion){
  return inTransaction(pool, async connection => {
    const result = await connection.query('SELECT data, version FROM app_state WHERE id = 1 FOR UPDATE');
    const row = result.rows[0];
    if (!row) {
      if (baseVersion !== null) {
        throw new VersionConflictError({ state: null, version: null });
      }
      await connection.query(
        'INSERT INTO app_state (id, data, version, updated_at) VALUES (1, $1::jsonb, 1, now())',
        [JSON.stringify(state)]
      );
      return 1;
    }
    const currentVersion = Number(row.version);
    // Identical data is never a conflict and needs no new version (e.g. a device re-saving on
    // open, or two devices generating the same monthly invoices).
    if (canonicalJSON(JSON.parse(JSON.stringify(state))) === canonicalJSON(row.data)) {
      return currentVersion;
    }
    if (baseVersion !== currentVersion) {
      throw new VersionConflictError({ state: row.data, version: currentVersion });
    }
    const updated = await connection.query(
      `UPDATE app_state SET data = $1::jsonb, version = version + 1, updated_at = now()
       WHERE id = 1 RETURNING version`,
      [JSON.stringify(state)]
    );
    return Number(updated.rows[0].version);
  });
}

module.exports = { COLLECTIONS, VersionConflictError, isValidState, parseBaseVersion, loadState, saveState };
