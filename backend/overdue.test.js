const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOverdueSummary, localDateInTimeZone } = require('./overdue');

test('summarizes unpaid invoices and monthly rollover, excluding paid and future-due invoices', () => {
  const state = {
    clients: [{ id: 'C-1', name: 'A Client' }, { id: 'C-2', name: 'B Client' }],
    billing: [
      { clientId: 'C-1', month: '2026-01', dueDate: '2026-01-01', amountDue: 1000 },
      { clientId: 'C-1', month: '2026-02', dueDate: '2026-02-01', amountDue: 500 },
      { clientId: 'C-2', month: '2026-03', dueDate: '2026-03-15', amountDue: 200 },
      { clientId: 'C-2', month: '2026-04', dueDate: '2026-04-01', amountDue: 300 }
    ],
    payments: [
      { clientId: 'C-1', month: '2026-01', amount: 250 },
      { clientId: 'C-2', month: '2026-03', amount: 200 }
    ]
  };

  const summary = buildOverdueSummary(state, '2026-03-15');
  assert.equal(summary.overdueInvoices, 3);
  assert.equal(summary.overdueClients, 1);
  assert.equal(summary.totalBalance, 1750);
  assert.match(summary.body, /A Client — ₱1,750\.00/);
  assert.equal(summary.notification.title,'1 unpaid client · ₱1,750.00 due');
  assert.match(summary.notification.body,/A Client — ₱1,750\.00/);
  assert.equal(state.billing.length,4,'building a summary does not mutate the saved state');
});

test('reminders use the same anniversary balances and current client names as billing',()=>{
  const state = {
    clients:[{id:'C-1',name:'Renamed Client',status:'Active'}],
    billing:[{clientId:'C-1',month:'2026-10',dueDate:'2026-10-20',amountDue:800}],
    payments:[]
  };
  for(const [today,total] of [
    ['2026-10-20',800],['2026-11-19',800],
    ['2026-11-20',1600],['2026-12-19',1600],['2026-12-20',2400]
  ]){
    const summary = buildOverdueSummary(state,today);
    assert.equal(summary.totalBalance,total);
    assert.match(summary.body,/Renamed Client/);
  }
});
test('returns no notification when there are no overdue balances', () => {
  const state = {
    clients: [{ id: 'C-1', name: 'Client' }],
    billing: [{ clientId: 'C-1', month: '2026-03', dueDate: '2026-03-16', amountDue: 100 }],
    payments: []
  };
  assert.equal(buildOverdueSummary(state, '2026-03-15'), null);
});

test('notification randomly samples four clients and directs the user to the full due list', () => {
  const clients = Array.from({length:9},(_,index)=>({id:`C-${index+1}`,name:`Client ${index+1}`}));
  const state = {
    clients,
    billing: clients.map(client=>({
      clientId:client.id,
      month:'2026-03',
      dueDate:'2026-03-15',
      amountDue:100
    })),
    payments:[]
  };

  const summary = buildOverdueSummary(state,'2026-03-15',max=>max-1);
  assert.equal(summary.notification.title,'9 unpaid clients · ₱900.00 due');
  const shownClients=[...summary.notification.body.matchAll(/Client \d+ — ₱100\.00/g)]
    .map(match=>Number(match[0].match(/\d+/)[0]));
  assert.equal(shownClients.length,4);
  assert.equal(new Set(shownClients).size,4);
  assert.match(summary.notification.body,/\+5 more\. Click to view all\./);
  assert.deepEqual(shownClients,[9,1,2,3]);
});

test('uses the configured local timezone date for daily de-duplication', () => {
  assert.equal(localDateInTimeZone(new Date('2026-03-15T17:30:00.000Z'), 'Asia/Manila'), '2026-03-16');
});
