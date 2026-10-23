const test = require('node:test');
const assert = require('node:assert/strict');
const { VersionConflictError, isValidState, parseBaseVersion, loadState, saveState } = require('./state-store');

function fakePool(initialRow){
  let row = initialRow ? {...initialRow} : null;
  const statements = [];
  const connection = {
    async query(sql, values){
      statements.push(sql.trim().split(/\s+/)[0]);
      if(sql.startsWith('SELECT')) return {rows:row ? [{data:JSON.parse(JSON.stringify(row.data)),version:row.version}] : []};
      if(sql.startsWith('INSERT')){
        row = {data:JSON.parse(values[0]),version:1};
        return {rows:[]};
      }
      if(sql.startsWith('UPDATE') && sql.includes('version = version + 1')){
        row = {data:JSON.parse(values[0]),version:row.version+1};
        return {rows:[{version:row.version}]};
      }
      if(sql.startsWith('UPDATE')){
        row = {...row,data:JSON.parse(values[0])};
        return {rows:[]};
      }
      return {rows:[]};
    },
    release(){ statements.push('RELEASE'); }
  };
  return {pool:{connect:async()=>connection}, statements, current:()=>row};
}

const sample = (name='A') => ({clients:[{id:'C-1',name}],billing:[],payments:[],settings:{}});

test('first save creates version 1 and later saves must name the version they were based on',async()=>{
  const db = fakePool(null);
  assert.equal(await saveState(db.pool, sample('A'), null),1);
  assert.equal(await saveState(db.pool, sample('B'), 1),2);
  assert.equal(db.current().data.clients[0].name,'B');
  await assert.rejects(saveState(db.pool, sample('stale'), 1), error=>{
    assert.ok(error instanceof VersionConflictError);
    assert.equal(error.current.version,2);
    assert.equal(error.current.state.clients[0].name,'B');
    return true;
  });
  assert.equal(db.current().data.clients[0].name,'B','a stale save never overwrites newer data');
  assert.ok(db.statements.includes('ROLLBACK'));
});

test('a save without a base version is rejected once data exists',async()=>{
  const db = fakePool({data:sample('A'),version:4});
  await assert.rejects(saveState(db.pool, sample('B'), null), VersionConflictError);
  assert.equal(db.current().version,4);
});

test('saving data identical to the server copy is a no-op, even from a stale base version',async()=>{
  const db = fakePool({data:{settings:{},payments:[],billing:[],clients:[{name:'A',id:'C-1'}]},version:4});
  assert.equal(await saveState(db.pool, sample('A'), 2),4);
  assert.equal(await saveState(db.pool, sample('A'), 4),4);
  assert.equal(db.current().version,4);
});

test('a save based on data that no longer exists on the server is a conflict',async()=>{
  const db = fakePool(null);
  await assert.rejects(saveState(db.pool, sample('B'), 3), error=>{
    assert.deepEqual(error.current,{state:null,version:null});
    return true;
  });
});

test('loading returns the version and invoice generation does not bump it',async()=>{
  const data = {
    clients:[{id:'C-1',status:'Active'}],
    billing:[{id:'INV-2026-10-C-1',clientId:'C-1',month:'2026-10',dueDate:'2026-10-20',amountDue:800}],
    payments:[],settings:{}
  };
  const db = fakePool({data,version:7});
  const loaded = await loadState(db.pool,'2026-11-20');
  assert.equal(loaded.version,7);
  assert.equal(loaded.state.billing.length,2);
  assert.equal(db.current().version,7);
  assert.equal(db.current().data.billing.length,2);
  assert.deepEqual(await loadState(fakePool(null).pool,'2026-11-20'),{state:null,version:null});
});

test('state validation and base version parsing',()=>{
  assert.equal(isValidState(sample()),true);
  assert.equal(isValidState({...sample(),billing:{}}),false);
  assert.equal(isValidState({clients:[]}),false);
  assert.equal(isValidState([]),false);
  assert.equal(parseBaseVersion(undefined),null);
  assert.equal(parseBaseVersion(null),null);
  assert.equal(parseBaseVersion(5),5);
  assert.equal(parseBaseVersion(0),undefined);
  assert.equal(parseBaseVersion('abc'),undefined);
});
