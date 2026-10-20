const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const billing = require('../billing');

function fixture(dueDate='2026-10-20'){
  return {
    clients:[{id:'C-1',name:'Original Client',rate:800,status:'Active'}],
    billing:[{id:`INV-${dueDate.slice(0,7)}-C-1`,clientId:'C-1',
      month:dueDate.slice(0,7),dueDate,amountDue:800}],
    payments:[],settings:{},napPorts:[],complaints:[],installs:[],inventory:[]
  };
}

function balance(state){
  return state.billing.reduce((total,invoice)=>total+Math.max(0,invoice.amountDue-
    state.payments.filter(payment=>payment.clientId===invoice.clientId && payment.month===invoice.month)
      .reduce((sum,payment)=>sum+payment.amount,0)),0);
}

test('rolls 800 into 1600 and 2400 on the monthly anniversary, once only',()=>{
  const state = fixture();
  assert.equal(billing.synchronizeInvoices(state,'2026-10-20'),0);
  assert.equal(balance(state),800);
  assert.equal(billing.synchronizeInvoices(state,'2026-11-19'),0);
  assert.equal(billing.synchronizeInvoices(state,'2026-11-20'),1);
  assert.equal(balance(state),1600);
  assert.equal(billing.synchronizeInvoices(state,'2026-12-19'),0);
  assert.equal(billing.synchronizeInvoices(state,'2026-12-20'),1);
  assert.equal(balance(state),2400);
  assert.equal(billing.synchronizeInvoices(state,'2026-12-20'),0);
  assert.deepEqual(state.billing.map(invoice=>invoice.dueDate),
    ['2026-10-20','2026-11-20','2026-12-20']);
  const reopened = JSON.parse(JSON.stringify(state));
  assert.equal(billing.synchronizeInvoices(reopened,'2026-12-20'),0);
  assert.equal(balance(reopened),2400);
});

test('fills missed months without duplicating a manually generated monthly invoice',()=>{
  const state = fixture();
  state.billing.push({id:'manual-nov',clientId:'C-1',month:'2026-11',
    dueDate:'2026-11-20',amountDue:800});
  assert.equal(billing.synchronizeInvoices(state,'2026-12-20'),1);
  assert.equal(state.billing.length,3);
  assert.equal(balance(state),2400);
});

test('deleted months stay excluded from rollover while later unpaid months can accrue',()=>{
  const state = fixture();
  billing.synchronizeInvoices(state,'2026-11-20');
  state.billing = state.billing.filter(invoice=>invoice.month!=='2026-11');
  state.billingExclusions = [{clientId:'C-1',month:'2026-11'}];
  assert.equal(billing.synchronizeInvoices(state,'2026-11-20'),0);
  assert.equal(billing.synchronizeInvoices(state,'2026-12-20'),1);
  assert.deepEqual(state.billing.map(invoice=>invoice.month),['2026-10','2026-12']);
  assert.equal(balance(state),1600);
  billing.renameClientReferences(state,'C-1','C-NEW');
  assert.equal(state.billingExclusions[0].clientId,'C-NEW');
});

test('an existing invoice with an invalid due date still prevents duplicate monthly charges',()=>{
  const state = fixture();
  state.billing.push({id:'manual',clientId:'C-1',month:'2026-11',dueDate:'',amountDue:800});
  assert.equal(billing.synchronizeInvoices(state,'2026-11-20'),0);
  assert.equal(state.billing.length,2);
});

test('partial payments reduce total remaining; settled accounts stop rolling',()=>{
  const state = fixture();
  state.payments.push({clientId:'C-1',month:'2026-10',date:'2026-11-01',amount:300});
  billing.synchronizeInvoices(state,'2026-11-20');
  assert.equal(balance(state),1300);
  state.payments.push(
    {clientId:'C-1',month:'2026-10',date:'2026-12-01',amount:500},
    {clientId:'C-1',month:'2026-11',date:'2026-12-01',amount:800}
  );
  assert.equal(billing.synchronizeInvoices(state,'2027-01-20'),0);
  assert.equal(balance(state),0);
});

test('late payments do not erase a monthly charge already due',()=>{
  const state = fixture();
  state.payments.push({clientId:'C-1',month:'2026-10',date:'2026-11-25',amount:800});
  billing.synchronizeInvoices(state,'2026-12-20');
  assert.equal(balance(state),1600);
  assert.equal(state.billing.length,3);
});

test('payment on the anniversary does not waive the new monthly invoice',()=>{
  const state = fixture();
  state.payments.push({clientId:'C-1',month:'2026-10',date:'2026-11-20',amount:800});
  billing.synchronizeInvoices(state,'2026-11-20');
  assert.equal(balance(state),800);
});

test('a paid latest invoice does not hide older outstanding debt',()=>{
  const state = fixture();
  state.billing.push({clientId:'C-1',month:'2026-11',dueDate:'2026-11-20',amountDue:800});
  state.payments.push({clientId:'C-1',month:'2026-11',date:'2026-11-19',amount:800});
  billing.synchronizeInvoices(state,'2026-12-20');
  assert.equal(balance(state),1600);
});

test('early and undated legacy full payments prevent rollover',()=>{
  for(const date of ['2026-11-19',undefined]){
    const state = fixture();
    state.payments.push({clientId:'C-1',month:'2026-10',date,amount:800});
    assert.equal(billing.synchronizeInvoices(state,'2026-12-20'),0);
  }
});

test('short and leap months preserve the original due day',()=>{
  for(const [year,february] of [[2026,'28'],[2028,'29']]){
    const state = fixture(`${year}-01-31`);
    billing.synchronizeInvoices(state,`${year}-03-31`);
    assert.deepEqual(state.billing.map(invoice=>invoice.dueDate),
      [`${year}-01-31`,`${year}-02-${february}`,`${year}-03-31`]);
  }
  const state = fixture('2026-12-20');
  billing.synchronizeInvoices(state,'2027-01-20');
  assert.equal(state.billing[1].dueDate,'2027-01-20');
});

test('does not generate for disconnected clients, missing clients, invalid dates or zero charges',()=>{
  const state = fixture();
  state.clients[0].status = 'Disconnected';
  assert.equal(billing.synchronizeInvoices(state,'2026-12-20'),0);
  state.clients = [];
  assert.equal(billing.synchronizeInvoices(state,'2026-12-20'),0);
  for(const dueDate of ['2026-02-30','invalid']){
    assert.equal(billing.synchronizeInvoices(fixture(dueDate),'2026-12-20'),0);
  }
  const free = fixture();
  free.billing[0].amountDue = 0;
  assert.equal(billing.synchronizeInvoices(free,'2026-12-20'),0);
  assert.throws(()=>billing.synchronizeInvoices(free,'invalid'),TypeError);
});

test('uses integer cents for recurring amounts and partial payments',()=>{
  const state = fixture();
  state.billing[0].amountDue = 800.15;
  state.payments.push({clientId:'C-1',month:'2026-10',date:'2026-10-21',amount:300.10});
  billing.synchronizeInvoices(state,'2026-11-20');
  assert.equal(state.billing[1].amountDue,800.15);
  assert.equal(Math.round(balance(state)*100),130020);
});

test('aging ranges and exact days agree at every boundary',()=>{
  const dueDate = '2026-01-01';
  for(const [days,aging] of [
    [0,'Current'],[1,'1-7 days'],[7,'1-7 days'],[8,'8-15 days'],[15,'8-15 days'],
    [16,'16-30 days'],[30,'16-30 days'],[31,'31-60 days'],[60,'31-60 days'],
    [61,'61-90 days'],[90,'61-90 days'],[91,'91+ days']
  ]){
    const today = new Date(Date.UTC(2026,0,1+days)).toISOString().slice(0,10);
    assert.deepEqual(billing.invoiceAging(dueDate,800,today),
      {daysOverdue:days,aging,dueAsOfToday:true});
  }
  assert.deepEqual(billing.invoiceAging('2026-03-08',800,'2026-03-09'),
    {daysOverdue:1,aging:'1-7 days',dueAsOfToday:true});
  assert.equal(billing.invoiceAging('2026-01-01',0,'2026-12-20').aging,'Paid');
  assert.equal(billing.invoiceAging('2026-12-21',800,'2026-12-20').dueAsOfToday,false);
  assert.equal(billing.invoiceAging('2026-02-30',800,'2026-12-20').dueAsOfToday,false);
});

function frontend(state){
  const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/\binit\(\);\s*$/,'')
    .replace('const todayISO = () => iso(new Date());',"const todayISO = () => '2026-12-20';");
  const context = vm.createContext({
    NapboxBilling:billing, console, setTimeout, clearTimeout,
    window:{addEventListener(){}},
    document:{getElementById:()=>({addEventListener(){}}),addEventListener(){}}
  });
  vm.runInContext(script,context);
  context.fixture = state;
  vm.runInContext("DB = fixture; state.month = '2026-12'; save = ()=>true;",context);
  return context;
}

test('existing billings and receipts resolve renamed clients without cached names',()=>{
  const state = fixture();
  state.payments.push({id:'P-1',receiptNo:'RCP-1',clientId:'C-1',month:'2026-10',
    date:'2026-10-21',amount:300});
  const context = frontend(state);
  assert.equal(vm.runInContext('billingRows()[0].clientName',context),'Original Client');
  vm.runInContext("DB.clients[0].name = 'Renamed Client'; state.currentReceiptId = 'P-1';",context);
  assert.equal(vm.runInContext('billingRows()[0].clientName',context),'Renamed Client');
  assert.match(vm.runInContext('receiptPlainText()',context),/Renamed Client/);
  assert.doesNotMatch(vm.runInContext('pageBilling()',context),/Original Client/);
  const page = vm.runInContext('pageBilling()',context);
  assert.match(page,/Remaining Payment/);
  assert.match(page,/2,100\.00/);
  assert.match(page,/Days Overdue/);
});

test('client ID changes preserve invoice, payment and other client references',()=>{
  const state = fixture();
  for(const table of ['payments','napPorts','complaints','installs','inventory']){
    state[table].push({id:`${table}-1`,clientId:'C-1',month:'2026-10',amount:300});
  }
  billing.renameClientReferences(state,'C-1','RENAMED-1');
  state.clients[0].id = 'RENAMED-1';
  for(const table of ['billing','payments','napPorts','complaints','installs','inventory']){
    assert.equal(state[table][0].clientId,'RENAMED-1');
  }
  assert.equal(state.billing[0].id,'INV-2026-10-RENAMED-1');
  const context = frontend(JSON.parse(JSON.stringify(state)));
  assert.equal(vm.runInContext('billingRows()[0].paid',context),300);
  assert.equal(vm.runInContext('billingRows()[0].clientName',context),'Original Client');
});

test('state API persists monthly rollover and serves the shared browser calculation',async()=>{
  let saved = fixture();
  let writes = 0;
  const statements = [];
  const connection = {
    async query(sql,values){
      statements.push(sql);
      if(sql.startsWith('SELECT')) return {rows:[{data:JSON.parse(JSON.stringify(saved))}]};
      if(sql.startsWith('UPDATE')){
        saved = JSON.parse(values[0]);
        writes++;
      }
      return {rows:[]};
    },
    release(){ statements.push('RELEASE'); }
  };
  const source = fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
  const context = vm.createContext({
    console, __dirname, process:{env:{}},
    require(name){
      if(name==='dotenv') return {config(){}};
      if(name==='pg') return {Pool:class {async connect(){ return connection; }}};
      if(name==='./auth') return {createAuth:()=>({
        requireAuth:(_req,_res,next)=>next(),loginRateLimit:(_req,_res,next)=>next()
      })};
      if(name==='./overdue') return {
        ...require('./overdue'),localDateInTimeZone:()=>'2026-12-20'
      };
      return require(name);
    }
  });
  vm.runInContext(source.slice(0,source.lastIndexOf('\nstart().catch'))+
    '\nglobalThis.testApp = app;',context);
  const server = context.testApp.listen(0,'127.0.0.1');
  try{
    await new Promise(resolve=>server.once('listening',resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/state`);
    assert.equal(response.status,200);
    const {state} = await response.json();
    assert.equal(balance(state),2400);
    assert.equal(saved.billing.length,3,'new invoices were written to the database');
    assert.equal(writes,1);
    assert.equal((await fetch(`${base}/api/state`)).status,200);
    assert.equal(writes,1,'reopening does not write duplicate invoices');
    assert.equal(statements.filter(sql=>sql==='BEGIN').length,2);
    assert.equal(statements.filter(sql=>sql==='COMMIT').length,2);
    assert.equal(statements.filter(sql=>sql==='RELEASE').length,2);
    const script = await fetch(`${base}/billing.js`);
    assert.equal(script.status,200);
    assert.match(script.headers.get('content-type'),/javascript/);
    assert.equal(await script.text(),fs.readFileSync(path.join(__dirname,'..','billing.js'),'utf8'));
  }finally{
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
