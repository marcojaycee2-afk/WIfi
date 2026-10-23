const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { frontend, fakeLocalStorage } = require('./frontend-harness');

function data(){
  return {
    clients:[{id:'C-1',name:'Client One',rate:800,status:'Active'}],
    billing:[{id:'INV-2026-12-C-1',clientId:'C-1',month:'2026-12',dueDate:'2026-12-20',amountDue:800}],
    payments:[],napBoxes:[],napPorts:[],complaints:[],installs:[],inventory:[],
    settings:{business:'Test ISP',plans:['25 Mbps'],methods:['Cash'],dueDay:5,homeBase:{name:'Base',lat:0,lng:0}}
  };
}

function jsonResponse(status, body){
  return {status, ok:status>=200 && status<300, json:async()=>body};
}

test('generic payment form requires a positive amount, an existing invoice and no overpayment',()=>{
  const app = frontend(data());
  const prepare = payment => vm.runInContext(`preparePayment(${JSON.stringify(payment)}, null)`,app);
  const base = {clientId:'C-1',date:'2026-12-20',month:'2026-12',amount:300,receivedBy:'Ana'};
  assert.match(prepare({...base,amount:0}),/greater than/);
  assert.match(prepare({...base,amount:-5}),/greater than/);
  assert.match(prepare({...base,month:'2026-13'}),/YYYY-MM/);
  assert.match(prepare({...base,date:'2026-02-30'}),/valid payment date/);
  assert.match(prepare({...base,month:'2026-01'}),/No invoice/);
  assert.match(prepare({...base,amount:800.01}),/more than the invoice balance/);
  assert.match(prepare({...base,receivedBy:'  '}),/received/);
  const payment = {...base};
  app.payment = payment;
  assert.equal(vm.runInContext('preparePayment(payment, null)',app),'');
  assert.equal(payment.invoiceId,'INV-2026-12-C-1');
});

test('editing a payment does not count its own previous amount against the balance',()=>{
  const state = data();
  state.payments.push({id:'P-1',clientId:'C-1',month:'2026-12',invoiceId:'INV-2026-12-C-1',amount:800,date:'2026-12-20'});
  const app = frontend(state);
  app.existing = state.payments[0];
  app.edited = {...state.payments[0],amount:700,receivedBy:'Ana'};
  assert.equal(vm.runInContext('preparePayment(edited, existing)',app),'');
  app.newPayment = {clientId:'C-1',date:'2026-12-20',month:'2026-12',amount:1,receivedBy:'Ana'};
  assert.match(vm.runInContext('preparePayment(newPayment, null)',app),/already fully paid/);
});

test('backup validation rejects malformed files before anything is replaced',()=>{
  const app = frontend(data());
  const check = value => vm.runInContext(`backupError(${JSON.stringify(value)})`,app);
  assert.equal(check(data()),'');
  assert.match(check([]),/does not contain/);
  assert.match(check({settings:{}}),/no client list/);
  assert.match(check({...data(),billing:{}}),/not a list/);
  assert.match(check({...data(),payments:[null]}),/invalid records/);
  assert.match(check({...data(),clients:[{id:'C-1'},{id:'C-1'}]}),/duplicate IDs/);
  assert.match(check({...data(),clients:[{name:'no id'}]}),/no ID/);
});

test('normalizeState fills missing collections and keeps a 0 latitude/longitude home base',()=>{
  const app = frontend(data());
  const normalized = vm.runInContext(`normalizeState(${JSON.stringify({clients:[{id:'C-1'}],settings:{homeBase:{name:'Equator',lat:0,lng:0},dueDay:40}})})`,app);
  for(const key of ['billing','payments','napBoxes','napPorts','complaints','installs','inventory','billingExclusions']){
    assert.ok(Array.isArray(normalized[key]),key);
  }
  assert.equal(normalized.settings.homeBase.lat,0);
  assert.equal(normalized.settings.homeBase.lng,0);
  assert.equal(normalized.settings.dueDay,5);
  assert.ok(normalized.settings.plans.length>0);
});

test('save sends the base version and adopts the new server version',async()=>{
  const requests = [];
  const app = frontend(data(),{fetch:async(url,options)=>{
    requests.push(JSON.parse(options.body));
    return jsonResponse(200,{saved:true,version:4});
  }});
  vm.runInContext('serverVersion = 3',app);
  assert.equal(await vm.runInContext('save()',app),'saved');
  assert.equal(requests[0].baseVersion,3);
  assert.equal(vm.runInContext('serverVersion',app),4);
  assert.equal(app.localStorage.getItem('isp-manager-v3-pending-save'),null);
});

test('a conflicting save loads the server data, keeps an unsaved copy and drops queued stale saves',async()=>{
  let releaseFirst;
  const firstResponse = new Promise(resolve=>{ releaseFirst = resolve; });
  let puts = 0;
  const serverState = {...data(),clients:[{id:'C-9',name:'From other device',status:'Active'}],billing:[]};
  const app = frontend(data(),{fetch:async()=>{
    puts++;
    await firstResponse;
    return jsonResponse(409,{error:'conflict',state:serverState,version:9});
  }});
  vm.runInContext('serverVersion = 3',app);
  const first = vm.runInContext('save()',app);
  vm.runInContext("DB.clients[0].name = 'Second edit'",app);
  const second = vm.runInContext('save()',app);
  releaseFirst();
  assert.equal(await first,'conflict');
  assert.equal(await second,'conflict');
  assert.equal(puts,1,'the stale queued save is never sent');
  assert.equal(vm.runInContext('DB.clients[0].id',app),'C-9');
  assert.equal(vm.runInContext('serverVersion',app),9);
  const copy = JSON.parse(app.localStorage.getItem('isp-manager-v3-unsaved-copy'));
  assert.equal(copy.state.clients[0].id,'C-1');
  assert.equal(copy.state.clients[0].name,'Second edit','edits made after the rejected save are kept too');
});

test('when the server has no data, queued saves continue instead of being reported as conflicts',async()=>{
  const bodies = [];
  const app = frontend(data(),{fetch:async(url,options)=>{
    const body = JSON.parse(options.body);
    bodies.push(body);
    if(body.baseVersion!==null) return jsonResponse(409,{error:'conflict',state:null,version:null});
    return jsonResponse(200,{saved:true,version:1});
  }});
  vm.runInContext('serverVersion = 3',app);
  const first = vm.runInContext('save()',app);
  const second = vm.runInContext('save()',app);
  assert.equal(await first,'local');
  assert.equal(await second,'saved');
  assert.equal(bodies[1].baseVersion,null);
  assert.equal(vm.runInContext('serverVersion',app),1);
});

test('a failed commit does not roll back over a newer queued edit',async()=>{
  const app = frontend(data());
  vm.runInContext(`
    let releaseFirst;
    save = function(){
      saveRevision++;
      if(saveRevision===1) return new Promise(resolve=>{ releaseFirst = ()=>resolve('failed'); });
      return Promise.resolve('local');
    };`,app);
  const first = vm.runInContext("commit(()=>{ DB.clients[0].name = 'Edit A'; })",app);
  vm.runInContext("DB.clients[0].rate = 999; save();",app);
  vm.runInContext('releaseFirst()',app);
  assert.equal(await first,true);
  assert.equal(vm.runInContext('DB.clients[0].name',app),'Edit A');
  assert.equal(vm.runInContext('DB.clients[0].rate',app),999);
});

test('opening the app does not save (and bump the server version) when nothing changed',async()=>{
  const server = data();
  server.settings = {...server.settings, pricingDefaultsVersion:1, legacyPricingCorrectionVersion:1};
  server.clients[0].plan = '25 Mbps';
  let puts = 0;
  const app = frontend(null,{synchronize:false,fetch:async(url,options)=>{
    if(options?.method==='PUT'){ puts++; return jsonResponse(200,{saved:true,version:8}); }
    return jsonResponse(200,{state:server,version:7});
  }});
  vm.runInContext('render = ()=>{}',app);
  await vm.runInContext('init()',app);
  assert.equal(puts,0);
  assert.equal(vm.runInContext('serverVersion',app),7);
});

test('commit rolls back only when nothing could be stored',async()=>{
  const app = frontend(data());
  vm.runInContext("save = async ()=>'failed'",app);
  assert.equal(await vm.runInContext("commit(()=>{ DB.clients[0].name = 'Changed'; })",app),false);
  assert.equal(vm.runInContext('DB.clients[0].name',app),'Client One');
  vm.runInContext("save = async ()=>'local'",app);
  assert.equal(await vm.runInContext("commit(()=>{ DB.clients[0].name = 'Offline edit'; })",app),true);
  assert.equal(vm.runInContext('DB.clients[0].name',app),'Offline edit');
});

test('offline saves are kept locally with the version they were based on',async()=>{
  const app = frontend(data(),{fetch:async()=>{ throw new Error('offline'); }});
  vm.runInContext('serverVersion = 6',app);
  assert.equal(await vm.runInContext('save()',app),'local');
  assert.deepEqual(JSON.parse(app.localStorage.getItem('isp-manager-v3-pending-save')),{baseVersion:6});
});

test('load uploads pending local changes only if the server has not changed since',async()=>{
  const local = {...data(),clients:[{id:'C-1',name:'Local edit',status:'Active'}]};
  const server = data();
  const storage = ()=>{
    const store = fakeLocalStorage();
    store.setItem('isp-manager-v3',JSON.stringify(local));
    store.setItem('isp-manager-v3-pending-save',JSON.stringify({baseVersion:5}));
    return store;
  };
  const unchanged = frontend(data(),{localStorage:storage(),fetch:async()=>jsonResponse(200,{state:server,version:5})});
  const keptLocal = await vm.runInContext('load()',unchanged);
  assert.equal(keptLocal.state.clients[0].name,'Local edit');
  assert.equal(keptLocal.conflict,undefined);

  const changed = frontend(data(),{localStorage:storage(),fetch:async()=>jsonResponse(200,{state:server,version:6})});
  const fromServer = await vm.runInContext('load()',changed);
  assert.equal(fromServer.state.clients[0].name,'Client One');
  assert.equal(fromServer.conflict,true);
  assert.equal(changed.localStorage.getItem('isp-manager-v3-pending-save'),null);
  assert.ok(changed.localStorage.getItem('isp-manager-v3-unsaved-copy'));
});
