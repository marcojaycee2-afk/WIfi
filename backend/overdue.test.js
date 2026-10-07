const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOverdueSummary, localDateInTimeZone } = require('./overdue');

test('summarizes unpaid overdue invoices per client, excluding paid and not-yet-due invoices', () => {
  const state = {
    clients: [{ id: 'C-1', name: 'A Client' }, { id: 'C-2', name: 'B Client' }],
    billing: [
      { clientId: 'C-1', month: '2026-01', dueDate: '2026-01-01', amountDue: 1000 },
      { clientId: 'C-1', month: '2026-02', dueDate: '2026-02-01', amountDue: 500 },
      { clientId: 'C-2', month: '2026-03', dueDate: '2026-03-01', amountDue: 200 },
      { clientId: 'C-2', month: '2026-04', dueDate: '2026-04-01', amountDue: 300 }
    ],
    payments: [
      { clientId: 'C-1', month: '2026-01', amount: 250 },
      { clientId: 'C-2', month: '2026-03', amount: 200 }
    ]
  };

  const summary = buildOverdueSummary(state, '2026-03-15');
  assert.equal(summary.overdueInvoices, 2);
  assert.equal(summary.overdueClients, 1);
  assert.equal(summary.totalBalance, 1250);
  assert.match(summary.body, /A Client — ₱1,250\.00/);
});

test('returns no notification when there are no overdue balances', () => {
  const state = {
    clients: [{ id: 'C-1', name: 'Client' }],
    billing: [{ clientId: 'C-1', month: '2026-03', dueDate: '2026-03-15', amountDue: 100 }],
    payments: []
  };
  assert.equal(buildOverdueSummary(state, '2026-03-15'), null);
});

test('uses the configured local timezone date for daily de-duplication', () => {
  assert.equal(localDateInTimeZone(new Date('2026-03-15T17:30:00.000Z'), 'Asia/Manila'), '2026-03-16');
});
