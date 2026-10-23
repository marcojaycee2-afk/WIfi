const test = require('node:test');
const assert = require('node:assert/strict');
const billing = require('../billing');
const { buildOverdueSummary } = require('./overdue');

function state(){
  return {
    clients:[{id:'C-1',name:'Client',status:'Active'}],
    billing:[
      {id:'INV-A',clientId:'C-1',month:'2026-10',dueDate:'2026-10-05',amountDue:800},
      {id:'INV-B',clientId:'C-1',month:'2026-10',dueDate:'2026-10-20',amountDue:500}
    ],
    payments:[]
  };
}

test('legacy payments are linked to one invoice so duplicate-month invoices are not double counted',()=>{
  const data = state();
  data.payments.push({id:'P-1',clientId:'C-1',month:'2026-10',amount:800});
  assert.equal(billing.linkPaymentsToInvoices(data),1);
  assert.equal(data.payments[0].invoiceId,'INV-A');
  assert.equal(billing.linkPaymentsToInvoices(data),0,'linking is idempotent');
  const totals = billing.invoicePaidTotals(data);
  assert.equal(totals.get(data.billing[0]),80000);
  assert.equal(totals.get(data.billing[1]),undefined);
  assert.equal(billing.invoiceBalance(data,data.billing[0]),0);
  assert.equal(billing.invoiceBalance(data,data.billing[1]),500);
});

test('payments linked by invoiceId only reduce that invoice',()=>{
  const data = state();
  data.payments.push({id:'P-1',clientId:'C-1',month:'2026-10',invoiceId:'INV-B',amount:200});
  assert.equal(billing.invoiceBalance(data,data.billing[0]),800);
  assert.equal(billing.invoiceBalance(data,data.billing[1]),300);
  assert.equal(billing.invoiceBalance(data,data.billing[1],'P-1'),500,'a payment being edited can be excluded');
  const summary = buildOverdueSummary(data,'2026-10-25');
  assert.equal(summary.totalBalance,1100);
});

test('payments pointing at a deleted invoice are re-linked to an invoice of the same month',()=>{
  const data = state();
  data.payments.push({id:'P-1',clientId:'C-1',month:'2026-10',invoiceId:'INV-GONE',amount:100});
  assert.equal(billing.linkPaymentsToInvoices(data),1);
  assert.equal(data.payments[0].invoiceId,'INV-A');
});

test('renaming a client or invoice keeps payment invoice links',()=>{
  const data = {
    clients:[{id:'C-1'}],
    billing:[{id:'INV-2026-10-C-1',clientId:'C-1',month:'2026-10'}],
    payments:[{id:'P-1',clientId:'C-1',month:'2026-10',invoiceId:'INV-2026-10-C-1'}]
  };
  billing.renameClientReferences(data,'C-1','C-9');
  assert.equal(data.billing[0].id,'INV-2026-10-C-9');
  assert.equal(data.payments[0].invoiceId,'INV-2026-10-C-9');
  billing.renameInvoiceReferences(data,'INV-2026-10-C-9','CUSTOM-1');
  assert.equal(data.payments[0].invoiceId,'CUSTOM-1');
});

test('CSV cells are quoted and spreadsheet formulas are neutralised',()=>{
  assert.equal(billing.csvCell('Juan "JD" Cruz'),'"Juan ""JD"" Cruz"');
  assert.equal(billing.csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');
  for(const prefix of ['+','-','@','\t','\r']){
    assert.ok(billing.csvCell(`${prefix}1`).startsWith('"\''),`prefix ${JSON.stringify(prefix)} is escaped`);
  }
  assert.equal(billing.csvCell(800),'"800"');
  assert.equal(billing.csvCell(null),'""');
});
