const { randomInt } = require('node:crypto');
const { synchronizeInvoices, invoicePaidTotals } = require('../billing');

function localDateInTimeZone(date=new Date(), timeZone='Asia/Manila'){
  const parts = new Intl.DateTimeFormat('en-CA',{
    timeZone,
    year:'numeric',
    month:'2-digit',
    day:'2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function buildOverdueSummary(state, today, chooseRandomIndex=randomInt){
  if(!state || !Array.isArray(state.billing) ||
     !Array.isArray(state.payments) || !Array.isArray(state.clients)){
    throw new TypeError('Application state is missing billing, payments, or clients');
  }
  state = {...state, billing:state.billing.slice()};
  synchronizeInvoices(state, today);

  const clientById = new Map(state.clients.map(client=>[client.id,client]));
  const paidTotals = invoicePaidTotals(state);

  const perClient = new Map();
  let overdueInvoices = 0;
  let totalBalance = 0;
  for(const invoice of state.billing){
    if(typeof invoice.dueDate!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(invoice.dueDate) ||
       invoice.dueDate>today) continue;
    const amountDue = Number(invoice.amountDue);
    if(!Number.isFinite(amountDue)) continue;
    const paid = (paidTotals.get(invoice)||0)/100;
    const balance = Math.max(0,Math.round((amountDue-paid)*100)/100);
    if(balance<=0) continue;
    overdueInvoices++;
    totalBalance += balance;
    const current = perClient.get(invoice.clientId)||{balance:0,invoices:0};
    current.balance += balance;
    current.invoices++;
    perClient.set(invoice.clientId,current);
  }

  if(!overdueInvoices) return null;
  const clients = [...perClient.entries()]
    .map(([clientId,details])=>({
      clientId,
      name:clientById.get(clientId)?.name || clientId,
      balance:Math.round(details.balance*100)/100,
      invoices:details.invoices
    }));
  const amount = value=>`₱${Number(value).toLocaleString('en-PH',{
    minimumFractionDigits:2,
    maximumFractionDigits:2
  })}`;
  const sample=clients.slice();
  const sampleCount=Math.min(4,sample.length);
  for(let index=0;index<sampleCount;index++){
    const selected=index+chooseRandomIndex(sample.length-index);
    [sample[index],sample[selected]]=[sample[selected],sample[index]];
  }
  const lines = sample.slice(0,sampleCount)
    .map(client=>`${client.name} — ${amount(client.balance)}`);
  if(clients.length>lines.length) lines.push(`+${clients.length-lines.length} more. Click to view all.`);
  const title=`${clients.length} unpaid client${clients.length===1?'':'s'} · ${amount(totalBalance)} due`;
  const body=lines.join('\n');

  return {
    title,
    body,
    notification:{title,body},
    overdueInvoices,
    overdueClients:clients.length,
    totalBalance:Math.round(totalBalance*100)/100
  };
}

module.exports={buildOverdueSummary,localDateInTimeZone};
