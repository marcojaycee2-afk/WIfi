(function(root){
  const dayMilliseconds = 86400000;
  const money = value=>Math.round((Number(value)||0)*100);

  function dateValue(value){
    if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value
      ? date : null;
  }

  function invoiceAging(dueDate, balance, today){
    const due = dateValue(dueDate);
    const reference = dateValue(today);
    const daysOverdue = balance>0 && due && reference
      ? Math.max(0,Math.round((reference-due)/dayMilliseconds)) : 0;
    const aging = balance<=0 ? 'Paid'
      : daysOverdue===0 ? 'Current'
      : daysOverdue<=7 ? '1-7 days'
      : daysOverdue<=15 ? '8-15 days'
      : daysOverdue<=30 ? '16-30 days'
      : daysOverdue<=60 ? '31-60 days'
      : daysOverdue<=90 ? '61-90 days' : '91+ days';
    return {
      daysOverdue, aging,
      dueAsOfToday:Boolean(balance>0 && due && reference && due<=reference)
    };
  }

  function paymentAppliesTo(payment, invoice){
    if(payment.invoiceId) return payment.invoiceId===invoice.id;
    return payment.clientId===invoice.clientId && payment.month===invoice.month;
  }

  // Legacy payments only carry clientId+month; attach each to the first matching invoice
  // so two invoices in the same month never both count the same payment.
  function linkPaymentsToInvoices(state){
    const invoices = state.billing || [];
    const invoiceIds = new Set(invoices.map(invoice=>invoice.id));
    let linked = 0;
    for(const payment of state.payments || []){
      if(payment.invoiceId && invoiceIds.has(payment.invoiceId)) continue;
      const invoice = invoices.find(row=>row.clientId===payment.clientId && row.month===payment.month);
      if(invoice){
        payment.invoiceId = invoice.id;
        linked++;
      }
    }
    return linked;
  }

  // Returns a Map keyed by invoice object -> paid amount in cents.
  function invoicePaidTotals(state, beforeDate=null){
    const totals = new Map();
    const invoices = state.billing || [];
    const byId = new Map();
    const byClientMonth = new Map();
    for(const invoice of invoices){
      if(invoice.id!==undefined && !byId.has(invoice.id)) byId.set(invoice.id,invoice);
      const key = `${invoice.clientId}\u0000${invoice.month}`;
      if(!byClientMonth.has(key)) byClientMonth.set(key,invoice);
    }
    for(const payment of state.payments || []){
      if(beforeDate && payment.date && payment.date>=beforeDate) continue;
      const invoice = payment.invoiceId
        ? byId.get(payment.invoiceId)
        : byClientMonth.get(`${payment.clientId}\u0000${payment.month}`);
      if(!invoice) continue;
      const amount = money(payment.amount);
      if(Number.isFinite(amount)) totals.set(invoice,(totals.get(invoice)||0)+amount);
    }
    return totals;
  }

  function invoiceBalance(state, invoice, excludePaymentId=null){
    const paid = (state.payments || []).reduce((total,payment)=>
      payment.id!==excludePaymentId && paymentAppliesTo(payment,invoice)
        ? total+money(payment.amount) : total, 0);
    return (money(invoice.amountDue)-paid)/100;
  }

  function synchronizeInvoices(state, today){
    if(!dateValue(today)) throw new TypeError('A valid billing reference date is required');
    const invoices = state.billing || [];
    const payments = state.payments || [];
    let added = 0;
    for(const client of state.clients || []){
      if(client.status==='Disconnected') continue;
      const allClientInvoices = invoices.filter(invoice=>invoice.clientId===client.id);
      const clientInvoices = allClientInvoices.filter(invoice=>dateValue(invoice.dueDate))
        .sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
      const months = new Set(allClientInvoices.map(invoice=>invoice.month));
      const excluded = new Set((state.billingExclusions || [])
        .filter(record=>record.clientId===client.id).map(record=>record.month));
      for(let index=0;index<clientInvoices.length;index++){
        const source = clientInvoices[index];
        const due = dateValue(source.dueDate);
        const dueDay = Number(source.recurringDueDay) || due.getUTCDate();
        const next = new Date(due);
        let nextDate, month;
        do{
          next.setUTCDate(1);
          next.setUTCMonth(next.getUTCMonth()+1);
          const lastDay = new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate();
          next.setUTCDate(Math.min(dueDay,lastDay));
          nextDate = next.toISOString().slice(0,10);
          month = nextDate.slice(0,7);
        }while(nextDate<=today && excluded.has(month) && !months.has(month));
        if(nextDate>today || months.has(month)) continue;
        const outstanding = clientInvoices.filter(invoice=>invoice.dueDate<nextDate)
          .reduce((total,invoice)=>{
            const paid = payments.filter(payment=>
              paymentAppliesTo(payment,invoice) &&
              (!payment.date || payment.date<nextDate)
            ).reduce((sum,payment)=>sum+money(payment.amount),0);
            return total+Math.max(0,money(invoice.amountDue)-paid);
          },0);
        if(outstanding<=0 || money(source.amountDue)<=0) continue;
        const invoice = {
          id:`INV-${month}-${client.id}`, clientId:client.id, month,
          dueDate:nextDate, amountDue:money(source.amountDue)/100,
          recurringDueDay:dueDay, remarks:''
        };
        invoices.push(invoice);
        clientInvoices.push(invoice);
        months.add(month);
        added++;
      }
    }
    return added;
  }

  function renameClientReferences(state, oldId, newId){
    if(oldId===newId) return;
    for(const table of ['billing','payments','napPorts','complaints','installs','inventory','billingExclusions']){
      for(const record of state[table] || []){
        if(record.clientId!==oldId) continue;
        if(table==='billing' && record.id===`INV-${record.month}-${oldId}`){
          renameInvoiceReferences(state, record.id, `INV-${record.month}-${newId}`);
          record.id = `INV-${record.month}-${newId}`;
        }
        record.clientId = newId;
      }
    }
  }

  function renameInvoiceReferences(state, oldId, newId){
    if(oldId===newId) return;
    for(const payment of state.payments || []){
      if(payment.invoiceId===oldId) payment.invoiceId = newId;
    }
  }

  // Neutralises spreadsheet formulas (=, +, -, @, tab, CR) so exported CSVs are safe to open.
  function csvCell(value){
    let text = String(value ?? '');
    if(/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g,'""')}"`;
  }

  const api = {
    invoiceAging,synchronizeInvoices,renameClientReferences,renameInvoiceReferences,
    paymentAppliesTo,linkPaymentsToInvoices,invoicePaidTotals,invoiceBalance,csvCell
  };
  if(typeof module==='object' && module.exports) module.exports = api;
  else root.NapboxBilling = api;
})(globalThis);
