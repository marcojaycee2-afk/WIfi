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

function buildOverdueSummary(state, today){
  if(!state || !Array.isArray(state.billing) ||
     !Array.isArray(state.payments) || !Array.isArray(state.clients)){
    throw new TypeError('Application state is missing billing, payments, or clients');
  }

  const clientById = new Map(state.clients.map(client=>[client.id,client]));
  const balances = new Map();
  for(const payment of state.payments){
    const key = `${payment.clientId}\u0000${payment.month}`;
    const amount = Number(payment.amount||0);
    if(Number.isFinite(amount)) balances.set(key,(balances.get(key)||0)+amount);
  }

  const perClient = new Map();
  let overdueInvoices = 0;
  let totalBalance = 0;
  for(const invoice of state.billing){
    if(typeof invoice.dueDate!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(invoice.dueDate) ||
       invoice.dueDate>today) continue;
    const amountDue = Number(invoice.amountDue);
    if(!Number.isFinite(amountDue)) continue;
    const paid = balances.get(`${invoice.clientId}\u0000${invoice.month}`)||0;
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
    }))
    .sort((a,b)=>b.balance-a.balance);
  const amount = value=>`₱${Number(value).toLocaleString('en-PH',{
    minimumFractionDigits:2,
    maximumFractionDigits:2
  })}`;
  const lines = clients.slice(0,3).map(client=>`${client.name} — ${amount(client.balance)}`);
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
