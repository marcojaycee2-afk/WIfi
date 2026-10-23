/* ------------------------------ computed ------------------------------ */
// Synchronization happens once per render (see render()), not here, so computing rows never saves.
function billingRows(){
  const today = todayISO();
  const clientsById = new Map(DB.clients.map(client=>[client.id,client]));
  const paidTotals = NapboxBilling.invoicePaidTotals(DB);
  return DB.billing.map(b=>{
    const client = clientsById.get(b.clientId);
    const paid = (paidTotals.get(b)||0)/100;
    const amountDue = num(b.amountDue);
    const balance = Math.round((amountDue - paid)*100)/100;
    const {daysOverdue, dueAsOfToday, aging} = NapboxBilling.invoiceAging(b.dueDate, balance, today);
    const status = balance <= 0 ? 'Paid' : (paid === 0 ? 'Unpaid' : 'Partial');
    return {
      ...b, clientName: client ? client.name : '—',
      clientStatus: client ? client.status : '—',
      paid, balance, status, daysOverdue, dueAsOfToday, aging
    };
  });
}

const RECEIVED_BY_KEY = `${KEY}-received-by`;
function lastReceivedBy(){
  try{ return localStorage.getItem(RECEIVED_BY_KEY) || 'Admin'; }
  catch(error){ return 'Admin'; }
}
function rememberReceivedBy(name){
  try{ if(name) localStorage.setItem(RECEIVED_BY_KEY, name); }
  catch(error){ console.warn('Could not remember the collector name', error); }
}

function napStats(box){
  const ports = DB.napPorts.filter(p=>p.napId===box.id).sort((a,b)=>a.port-b.port);
  const used = ports.filter(p=>p.status==='Used').length;
  const faulty = ports.filter(p=>p.status==='Faulty').length;
  const reserved = ports.filter(p=>p.status==='Reserved').length;
  const total = num(box.totalPorts) || ports.length;
  const free = Math.max(0, total - used - faulty - reserved);
  return {used, free, faulty, reserved, total, ports};
}

function agingClass(a){
  return a==='Paid' ? 'b-green'
    : a==='Current' ? 'b-gray'
    : a==='1-7 days' ? 'b-amber'
    : a==='8-15 days' ? 'b-orange'
    : 'b-red';
}

/* ------------------------------ render ------------------------------ */
function render(){
  if(DB && NapboxBilling.synchronizeInvoices(DB, todayISO())) save();
  document.getElementById('tabs').innerHTML = TABS.map(t=>
    `<button class="tab ${state.tab===t.id?'active':''}" data-tab="${t.id}">${t.icon} ${t.label}</button>`
  ).join('') + '<button class="tab mobile-menu-action" type="button" data-mobile-logout>↪ Sign out</button>';

  const PAGES = {
    dashboard: pageDashboard, clients: pageClients, billing: pageBilling,
    payments: pagePayments, naps: pageNaps, complaints: pageComplaints,
    installs: pageInstalls, inventory: pageInventory, settings: pageSettings
  };
  document.getElementById('view').innerHTML = PAGES[state.tab]();
  updateTableScrollControls();
  if(state.tab==='settings') updatePushNotificationStatus();
  window.scrollTo({top:0, behavior:'instant'});
  if(state.tab==='naps' && state.napView==='map') setTimeout(initMap, 60);
}

function updateTableScrollControls(){
  const isMobile = window.matchMedia('(max-width:640px)').matches;
  document.querySelectorAll('#view .tw').forEach(wrapper=>{
    let controls = wrapper.nextElementSibling;
    if(controls && !controls.classList.contains('table-scroll-controls')) controls = null;
    if(!isMobile || wrapper.scrollWidth<=wrapper.clientWidth+1){
      if(controls) controls.remove();
      return;
    }
    if(!controls){
      controls = document.createElement('div');
      controls.className = 'table-scroll-controls';
      controls.innerHTML = `
        <button type="button" data-table-scroll="-1" aria-label="Scroll table left">‹</button>
        <span>Swipe sideways to see more columns</span>
        <button type="button" data-table-scroll="1" aria-label="Scroll table right">›</button>`;
      wrapper.after(controls);
    }
    const syncButtons = ()=>{
      const left = controls.querySelector('[data-table-scroll="-1"]');
      const right = controls.querySelector('[data-table-scroll="1"]');
      left.disabled = wrapper.scrollLeft<=1;
      right.disabled = wrapper.scrollLeft+wrapper.clientWidth>=wrapper.scrollWidth-1;
    };
    if(!controls._scrollSyncBound){
      wrapper.addEventListener('scroll',syncButtons,{passive:true});
      controls._scrollSyncBound = true;
    }
    syncButtons();
  });
}

window.addEventListener('resize',updateTableScrollControls,{passive:true});

/* ------------------------------ dashboard ------------------------------ */
function pageDashboard(){
  const rows = billingRows();
  const m = state.month;
  const total = DB.clients.length;
  const active = DB.clients.filter(c=>c.status==='Active').length;
  const suspended = DB.clients.filter(c=>c.status==='Suspended').length;
  const disc = DB.clients.filter(c=>c.status==='Disconnected').length;
  const mRows = rows.filter(r=>r.month===m);
  const expected = mRows.reduce((s,r)=>s+num(r.amountDue),0);
  const collected = mRows.reduce((s,r)=>s+r.paid,0);
  const unpaid = Math.max(0, expected-collected);
  const rate = expected ? Math.round(collected/expected*100) : 0;
  const arrears = rows.filter(r=>r.balance>0).reduce((s,r)=>s+r.balance,0);

  const byClient = {};
  rows.filter(r=>r.balance>0).forEach(r=>{
    byClient[r.clientId] = byClient[r.clientId] || {name:r.clientName, bal:0, oldest:0};
    byClient[r.clientId].bal += r.balance;
    byClient[r.clientId].oldest = Math.max(byClient[r.clientId].oldest, r.daysOverdue);
  });
  const topUnpaid = Object.entries(byClient).map(([id,v])=>({id,...v}))
    .sort((a,b)=>b.bal-a.bal).slice(0,8);

  const overdue = rows.filter(r=>r.dueAsOfToday)
    .sort((a,b)=>b.daysOverdue-a.daysOverdue);
  const longOverdue = rows.filter(r=>
    r.balance>0 && r.daysOverdue>0 && isAtLeastMonthsOverdue(r.dueDate, 2)
  ).sort((a,b)=>b.daysOverdue-a.daysOverdue);

  const openTickets = DB.complaints.filter(c=>c.status!=='Resolved' && c.status!=='Closed').length;
  const pendingInstalls = DB.installs.filter(r=>r.status!=='Completed' && r.status!=='Cancelled').length;

  const napCards = DB.napBoxes.map(b=>{
    const s = napStats(b);
    const pct = s.total ? Math.round(s.used/s.total*100) : 0;
    const cls = s.free<=2 ? 'full' : s.free<=4 ? 'warn' : 'ok';
    return `
      <div class="mb-12">
        <div class="flex">
          <strong>${esc(b.id)}</strong>
          <span class="small muted">${esc(b.label||'')}</span>
          <span class="spacer"></span>
          <span class="small ${s.free<=2?'':'muted'}">${s.used}/${s.total} used · ${s.free} free</span>
        </div>
        <div class="bar ${cls}"><span style="width:${pct}%"></span></div>
      </div>`;
  }).join('');

  return `
  <div class="page-head">
    <h1>Dashboard</h1>
    <select class="w-auto" id="monthPick">
      ${monthOptions().map(o=>`<option value="${o}" ${o===m?'selected':''}>${monthLabel(o)}</option>`).join('')}
    </select>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="lbl">Total Clients</div><div class="val">${total}</div>
      <div class="sub">${active} active · ${suspended} suspended · ${disc} disc</div></div>
    <div class="kpi"><div class="lbl">Expected</div><div class="val">${peso(expected)}</div>
      <div class="sub">${monthLabel(m)}</div></div>
    <div class="kpi"><div class="lbl">Collected</div><div class="val text-green">${peso(collected)}</div>
      <div class="sub">${rate}% collection rate</div></div>
    <div class="kpi"><div class="lbl">Unpaid</div><div class="val text-red">${peso(unpaid)}</div>
      <div class="sub">${peso(arrears)} total arrears</div></div>
    <div class="kpi"><div class="lbl">Open Tickets</div><div class="val">${openTickets}</div>
      <div class="sub">${pendingInstalls} pending installs</div></div>
  </div>

  <div class="card">
    <div class="card-head"><h2>Collection Rate</h2><span class="small muted">${monthLabel(m)}</span></div>
    <div class="bar ${rate>=90?'ok':rate>=60?'warn':'full'}" style="height:12px"><span style="width:${rate}%"></span></div>
    <div class="flex small muted mt-8">
      <span>${peso(collected)} collected</span><span class="spacer"></span><span>${peso(expected)} expected</span>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>Top Unpaid Accounts</h2></div>
    ${topUnpaid.length ? `
    <div class="tw"><table>
      <thead><tr><th>Client</th><th class="right">Balance</th><th class="right">Oldest</th></tr></thead>
      <tbody>${topUnpaid.map(u=>`<tr>
        <td>${esc(u.name)}<div class="tiny muted">${esc(u.id)}</div></td>
        <td class="right"><strong>${peso(u.bal)}</strong></td>
        <td class="right"><span class="badge ${agingClass(u.oldest>15?'16-30 days':u.oldest>7?'8-15 days':u.oldest>0?'1-7 days':'Current')}">${u.oldest}d</span></td>
      </tr>`).join('')}</tbody>
    </table></div>` : `<div class="empty"><div class="big">🎉</div>No outstanding balances.</div>`}
  </div>

  <div class="card" id="overdueReminderList">
    <div class="card-head"><h2>Overdue / Reminder List</h2>
      <span class="small muted">${overdue.length} account(s)</span></div>
    ${overdue.length ? `
    <div class="tw"><table>
      <thead><tr><th>Client</th><th>Month</th><th>Due</th><th class="right">Balance</th><th>Aging</th></tr></thead>
      <tbody>${overdue.map(r=>`<tr class="${r.dueAsOfToday?'due-unpaid':''}">
        <td>${esc(r.clientName)}</td>
        <td class="muted">${esc(r.month)}</td>
        <td class="muted">${esc(dateLabel(r.dueDate))}</td>
        <td class="right">${peso(r.balance)}</td>
        <td><span class="badge ${r.dueAsOfToday?'b-red':agingClass(r.aging)}">${r.aging} · ${r.daysOverdue}d</span></td>
      </tr>`).join('')}</tbody>
    </table></div>` : `<div class="empty"><div class="big">✅</div>Nothing overdue.</div>`}
  </div>

  <div class="card">
    <div class="card-head"><h2>2+ Months Overdue</h2>
      <span class="small muted">${longOverdue.length} unpaid invoice(s)</span></div>
    ${longOverdue.length ? `
    <div class="tw"><table>
      <thead><tr><th>Client</th><th>Billing Month</th><th>Due</th><th class="right">Balance</th><th>Overdue</th><th></th></tr></thead>
      <tbody>${longOverdue.map(r=>`<tr>
        <td>${esc(r.clientName)}<div class="tiny muted">${esc(r.clientId)}</div></td>
        <td class="muted">${esc(r.month)}</td>
        <td class="muted">${esc(dateLabel(r.dueDate))}</td>
        <td class="right"><strong>${peso(r.balance)}</strong></td>
        <td><span class="badge b-red">${r.daysOverdue} days</span></td>
        <td><button class="btn sm primary" data-act="payInvoice" data-id="${esc(r.id)}">Record Payment</button></td>
      </tr>`).join('')}</tbody>
    </table></div>` : `<div class="empty">No unpaid invoices are at least two months overdue.</div>`}
  </div>

  <div class="card">
    <div class="card-head"><h2>NAP Box Capacity</h2>
      <button class="btn sm" data-tab="naps">View all</button></div>
    ${napCards || '<div class="empty">No NAP boxes yet.</div>'}
  </div>
  `;
}

/* ------------------------------ clients ------------------------------ */
function pageClients(){
  const q = state.search.toLowerCase();
  const list = DB.clients.filter(c=>
    !q || [c.id,c.name,c.barangay,c.contact,c.pppoe].join(' ').toLowerCase().includes(q)
  ).sort((a,b)=>String(a.id||'').localeCompare(String(b.id||''), undefined, {numeric:true, sensitivity:'base'}));
  const rows = list.map(c=>{
    const bal = billingRows().filter(r=>r.clientId===c.id && r.balance>0)
      .reduce((s,r)=>s+r.balance,0);
    const stCls = c.status==='Active' ? 'b-green' : c.status==='Suspended' ? 'b-amber' : 'b-gray';
    return `<tr>
      <td><strong>${esc(c.id)}</strong><div class="tiny muted">${esc(c.pppoe||'')}</div></td>
      <td class="wrap">${esc(c.name)}<div class="tiny muted">${esc(c.barangay||'')}</div></td>
      <td>${esc(c.contact||'')}</td>
      <td>${esc(c.plan||'')}<div class="tiny muted">${peso(c.rate)}/mo</div></td>
      <td>${c.napId?`${esc(c.napId)}<div class="tiny muted">port ${esc(c.port)}</div>`:'<span class="muted">—</span>'}</td>
      <td class="right">${bal>0?`<span class="badge b-red">${peso(bal)}</span>`:`<span class="muted small">${peso(0)}</span>`}</td>
      <td><span class="badge ${stCls}">${esc(c.status)}</span></td>
      <td class="right"><div class="row-actions">
        <button class="btn sm" data-act="connectClient" data-id="${esc(c.id)}">${c.napId?'Change Port':'Connect'}</button>
        <button class="btn sm" data-act="edit" data-table="clients" data-id="${esc(c.id)}">Edit</button>
        <button class="btn sm danger" data-act="del" data-table="clients" data-id="${esc(c.id)}">✕</button>
      </div></td>
    </tr>`;
  }).join('');

  return `
  <div class="page-head">
    <h1>Clients <span class="muted small">(${list.length})</span></h1>
    <button class="btn primary" data-act="add" data-table="clients">+ Add Client</button>
  </div>
  <div class="searchbar">
    <input type="search" id="searchBox" placeholder="Search name, ID, barangay, PPPoE…" value="${esc(state.search)}">
  </div>
  ${DB.clients.some(c=>num(c.rate)<=0)?'<div class="note mb-12">Monthly prices were not included in the PPP export. Set client rates before generating invoices.</div>':''}
  <div class="card">
    ${list.length ? `<div class="tw"><table>
      <thead><tr><th>ID</th><th>Name</th><th>Contact</th><th>Plan</th><th>NAP / Port</th><th class="right">Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>` : `<div class="empty"><div class="big">👥</div>No clients found.</div>`}
  </div>
  `;
}

/* ------------------------------ billing ------------------------------ */
function pageBilling(){
  const m = state.month;
  const allRows = billingRows();
  const monthRows = allRows.filter(r=>r.month===m);
  const remainingByClient = new Map();
  allRows.forEach(row=>{
    remainingByClient.set(row.clientId,
      (remainingByClient.get(row.clientId)||0)+Math.max(0,row.balance));
  });
  const q = state.search.toLowerCase();
  const rows = monthRows.filter(r=>
    !q || [r.clientName,r.clientId].join(' ').toLowerCase().includes(q)
  );
  const expected = monthRows.reduce((s,r)=>s+num(r.amountDue),0);
  const collected = monthRows.reduce((s,r)=>s+r.paid,0);
  const unpaid = Math.max(0, expected-collected);
  const rate = expected ? Math.round(collected/expected*100) : 0;

  const body = rows.sort((a,b)=>b.daysOverdue-a.daysOverdue || a.clientName.localeCompare(b.clientName))
  .map(r=>{
    const stCls = r.status==='Paid'?'b-green':r.dueAsOfToday?'b-red':'b-gray';
    return `    <tr class="${r.dueAsOfToday?'due-unpaid':''}">
      <td>${esc(r.clientName)}<div class="tiny muted">${esc(r.clientId)}</div></td>
      <td class="muted">${esc(dateLabel(r.dueDate))}</td>
      <td class="right">${peso(r.amountDue)}</td>
      <td class="right">${peso(r.paid)}</td>
      <td class="right"><strong>${peso(Math.max(0,r.balance))}</strong></td>
      <td class="right"><strong>${peso(remainingByClient.get(r.clientId)||0)}</strong></td>
      <td><span class="badge ${r.dueAsOfToday?'b-red':stCls}">${r.status}</span></td>
      <td><span class="badge ${r.dueAsOfToday?'b-red':agingClass(r.aging)}">${r.aging}</span></td>
      <td class="right"><span class="small muted">${r.daysOverdue}d</span></td>
      <td class="right"><div class="row-actions">
        ${r.balance>0?`<button class="btn sm primary" data-act="payInvoice" data-id="${esc(r.id)}">Record Payment</button>`:''}
        <button class="btn sm" data-act="edit" data-table="billing" data-id="${esc(r.id)}">Edit</button>
        <button class="btn sm danger" data-act="del" data-table="billing" data-id="${esc(r.id)}">✕</button>
      </div></td>
    </tr>`;
  }).join('');

  return `
  <div class="page-head">
    <h1>Billing</h1>
    <select class="w-auto" id="monthPick">
      ${monthOptions().map(o=>`<option value="${o}" ${o===m?'selected':''}>${monthLabel(o)}</option>`).join('')}
    </select>
    <button class="btn" data-act="generate">⚙ Generate</button>
    <button class="btn primary" data-act="add" data-table="billing">+ Invoice</button>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="lbl">Expected</div><div class="val">${peso(expected)}</div></div>
    <div class="kpi"><div class="lbl">Collected</div><div class="val text-green">${peso(collected)}</div></div>
    <div class="kpi"><div class="lbl">Unpaid</div><div class="val text-red">${peso(unpaid)}</div></div>
    <div class="kpi"><div class="lbl">Rate</div><div class="val">${rate}%</div></div>
  </div>
  <div class="searchbar">
    <input type="search" id="searchBox" placeholder="Find client by name or ID…" value="${esc(state.search)}">
  </div>
  <p class="small muted">Unpaid accounts receive another monthly invoice on the same due day (or the last day of a shorter month). Remaining Payment includes all outstanding invoices for that client; payments are recorded against the selected invoice.</p>
  <div class="card">
    <div class="card-head"><h2>${monthLabel(m)}</h2>
    <span class="small muted">${q?`${rows.length} of ${monthRows.length}`:monthRows.length} invoice(s)</span></div>
    ${rows.length ? `<div class="tw"><table>
      <thead><tr><th>Client</th><th>Due</th><th class="right">Amount</th><th class="right">Paid</th><th class="right">Invoice Balance</th><th class="right">Remaining Payment</th><th>Status</th><th>Aging</th><th class="right">Days Overdue</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>` : `<div class="empty"><div class="big">🧾</div>
      No invoices for ${monthLabel(m)}.<br><br>
      <button class="btn primary" data-act="generate">Generate invoices</button>
    </div>`}
  </div>
  `;
}

function openInvoicePayment(invoiceId){
  const invoice = DB.billing.find(row=>String(row.id)===String(invoiceId));
  const current = invoice && billingRows().find(row=>String(row.id)===String(invoiceId));
  if(!invoice || !current){ toast('Invoice not found'); return; }
  const balance = Math.round((Number(current.balance)+Number.EPSILON)*100)/100;
  if(!Number.isFinite(balance) || balance<=0){ toast('This invoice has no valid outstanding balance'); return; }

  const methods = DB.settings.methods?.length ? DB.settings.methods : ['Cash'];
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <div class="modal-head">
      <h2>Record Payment</h2>
      <button class="btn sm" type="button" data-act="closeModal" aria-label="Close">✕</button>
    </div>
    <p class="muted">${esc(current.clientName)} <span class="tiny">(${esc(current.clientId)})</span><br>
      ${esc(monthLabel(invoice.month))} · Invoice balance ${peso(balance)}<br>
      <span class="small">This payment applies to this invoice only. Other unpaid months remain outstanding.</span></p>
    <form id="invoicePaymentForm">
      <label class="field"><span>Payment Date</span>
        <input name="date" type="date" value="${todayISO()}" required>
      </label>
      <label class="field"><span>Amount Paid (₱)</span>
        <input name="amount" type="number" min="0.01" max="${balance.toFixed(2)}" step="0.01" value="${balance.toFixed(2)}" required>
      </label>
      <label class="field"><span>Mode of Payment</span>
        <select name="method" required>${methods.map(method=>
          `<option value="${esc(method)}">${esc(method)}</option>`
        ).join('')}</select>
      </label>
      <label class="field"><span>Reference Number (optional)</span>
        <input name="ref" type="text" autocomplete="off">
      </label>
      <label class="field"><span>Received By</span>
        <input name="receivedBy" type="text" value="${esc(lastReceivedBy())}" required autocomplete="name">
      </label>
      <div class="modal-actions">
        <button type="button" class="btn" data-act="closeModal">Cancel</button>
        <button type="submit" class="btn primary">Save Payment</button>
      </div>
    </form>`;
  activateDialog('backdrop');
  document.getElementById('invoicePaymentForm').addEventListener('submit', async event=>{
    event.preventDefault();
    const form = event.currentTarget;
    const amount = Math.round(Number(form.elements.namedItem('amount').value)*100)/100;
    const latest = billingRows().find(row=>String(row.id)===String(invoiceId));
    if(!latest || latest.balance<=0){
      toast('This invoice is already paid');
      closeModal();
      render();
      return;
    }
    const latestBalance = Math.round((Number(latest.balance)+Number.EPSILON)*100)/100;
    if(!Number.isFinite(latestBalance) || latestBalance<=0){
      toast('This invoice has no valid outstanding balance');
      return;
    }
    if(!Number.isFinite(amount) || amount<=0 || amount>latestBalance){
      toast(`Enter an amount from ₱0.01 to ${peso(latestBalance)}`);
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const paymentDate = form.elements.namedItem('date').value;
    if(!paymentDate || !Number.isFinite(new Date(`${paymentDate}T00:00:00`).getTime()) ||
       iso(new Date(`${paymentDate}T00:00:00`))!==paymentDate){
      toast('Choose a valid payment date');
      submit.disabled = false;
      return;
    }
    const receivedBy = form.elements.namedItem('receivedBy').value.trim();
    if(!receivedBy){
      toast('Enter who received the payment');
      submit.disabled = false;
      return;
    }
    const payment = {
      id:nextId('P', DB.payments),
      receiptNo:nextReceiptNo(),
      date:paymentDate,
      createdAt:new Date().toISOString(),
      clientId:invoice.clientId,
      invoiceId:invoice.id,
      month:invoice.month,
      amount,
      method:form.elements.namedItem('method').value,
      ref:form.elements.namedItem('ref').value.trim(),
      receivedBy,
      notes:''
    };
    const persisted = await commit(()=>{ DB.payments.push(payment); },
      'Could not save this payment. Please check your connection and try again.');
    if(!persisted){
      submit.disabled = false;
      return;
    }
    rememberReceivedBy(receivedBy);
    closeModal();
    render();
    toast('Payment recorded');
    setTimeout(()=>openReceipt(payment.id), 200);
  });
}

/* ------------------------------ payments ------------------------------ */
function pagePayments(){
  const q = state.search.toLowerCase();
  const clientsById = new Map(DB.clients.map(client=>[client.id,client]));
  const all = [...DB.payments].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  const rows = all.filter(p=>{
    if(!q) return true;
    const c = clientsById.get(p.clientId);
    return [p.id, p.receiptNo, p.ref, p.method, p.month, p.receivedBy, c?c.name:'', c?c.id:'']
      .join(' ').toLowerCase().includes(q);
  });
  const totalThis = all.filter(p=>p.month===state.month).reduce((s,p)=>s+num(p.amount),0);
  const totalAll = all.reduce((s,p)=>s+num(p.amount),0);

  const body = rows.map(p=>{
    const c = clientsById.get(p.clientId);
    return `<tr>
      <td><strong>${esc(p.receiptNo||p.id)}</strong><div class="tiny muted">${esc(p.id)}</div></td>
      <td>${esc(dateLabel(p.date))}</td>
      <td>${esc(c?c.name:p.clientId)}</td>
      <td class="muted">${esc(p.month)}</td>
      <td class="right"><strong>${peso(p.amount)}</strong></td>
      <td><span class="badge b-blue">${esc(p.method)}</span></td>
      <td class="muted">${esc(p.ref||'—')}</td>
      <td class="right"><div class="row-actions">
        <button class="rcpt-btn" data-act="receipt" data-id="${esc(p.id)}" title="View receipt">🧾 Receipt</button>
        <button class="btn sm" data-act="edit" data-table="payments" data-id="${esc(p.id)}">Edit</button>
        <button class="btn sm danger" data-act="del" data-table="payments" data-id="${esc(p.id)}">✕</button>
      </div></td>
    </tr>`;
  }).join('');

  return `
  <div class="page-head">
    <h1>Payments</h1>
    <button class="btn primary" data-act="add" data-table="payments">+ Record Payment</button>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="lbl">Collected — ${monthLabel(state.month)}</div>
      <div class="val text-green">${peso(totalThis)}</div>
      <div class="sub">${all.filter(p=>p.month===state.month).length} transaction(s)</div></div>
    <div class="kpi"><div class="lbl">All-time Collected</div>
      <div class="val">${peso(totalAll)}</div>
      <div class="sub">${all.length} receipt(s) issued</div></div>
  </div>
  <div class="searchbar">
    <input type="search" id="searchBox" placeholder="Search receipt #, name, ref, method…" value="${esc(state.search)}">
  </div>
  <div class="card">
    ${rows.length ? `<div class="tw"><table>
      <thead><tr><th>Receipt #</th><th>Date</th><th>Client</th><th>Month</th><th class="right">Amount</th><th>Method</th><th>Reference</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>` : `<div class="empty"><div class="big">💵</div>No payments recorded yet.</div>`}
  </div>
  `;
}

/* ------------------------------ complaints ------------------------------ */
function pageComplaints(){
  const rows = [...DB.complaints].sort((a,b)=>b.date.localeCompare(a.date));
  const body = rows.map(t=>{
    const c = DB.clients.find(x=>x.id===t.clientId);
    const stCls = t.status==='Resolved'||t.status==='Closed' ? 'b-green'
      : t.status==='In Progress' ? 'b-amber' : 'b-red';
    return `<tr>
      <td><strong>${esc(t.id)}</strong></td>
      <td>${esc(dateLabel(t.date))}</td>
      <td>${esc(c?c.name:t.clientId)}</td>
      <td>${esc(t.category||'')}<div class="tiny muted wrap">${esc(t.description||'')}</div></td>
      <td>${esc(t.tech||'—')}</td>
      <td><span class="badge ${stCls}">${esc(t.status)}</span></td>
      <td>${esc(dateLabel(t.fixedDate))}</td>
      <td class="right"><div class="row-actions">
        <button class="btn sm" data-act="edit" data-table="complaints" data-id="${esc(t.id)}">Edit</button>
        <button class="btn sm danger" data-act="del" data-table="complaints" data-id="${esc(t.id)}">✕</button>
      </div></td>
    </tr>`;
  }).join('');

  return `
  <div class="page-head">
    <h1>Complaints / Repair Log</h1>
    <button class="btn primary" data-act="add" data-table="complaints">+ New Ticket</button>
  </div>
  <div class="card">
    ${rows.length ? `<div class="tw"><table>
      <thead><tr><th>Ticket</th><th>Reported</th><th>Client</th><th>Issue</th><th>Tech</th><th>Status</th><th>Fixed</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>` : `<div class="empty"><div class="big">🛠</div>No tickets yet.</div>`}
  </div>
  `;
}

/* ------------------------------ installs ------------------------------ */
function pageInstalls(){
  const rows = [...DB.installs].sort((a,b)=>b.date.localeCompare(a.date));
  const body = rows.map(r=>{
    const stCls = r.status==='Completed' ? 'b-green'
      : r.status==='Scheduled' ? 'b-blue'
      : r.status==='Cancelled' ? 'b-gray' : 'b-amber';
    return `<tr>
      <td><strong>${esc(r.id)}</strong></td>
      <td>${esc(dateLabel(r.date))}</td>
      <td><span class="badge b-gray">${esc(r.type)}</span></td>
      <td class="wrap">${esc(r.name)}<div class="tiny muted">${esc(r.contact||'')}</div></td>
      <td class="wrap">${esc(r.address||'')}</td>
      <td>${esc(r.plan||'—')}</td>
      <td>${esc(r.napId||'—')}</td>
      <td><span class="badge ${stCls}">${esc(r.status)}</span></td>
      <td>${esc(dateLabel(r.schedule))}</td>
      <td class="right"><div class="row-actions">
        <button class="btn sm" data-act="edit" data-table="installs" data-id="${esc(r.id)}">Edit</button>
        <button class="btn sm danger" data-act="del" data-table="installs" data-id="${esc(r.id)}">✕</button>
      </div></td>
    </tr>`;
  }).join('');

  return `
  <div class="page-head">
    <h1>Install / Disconnection Requests</h1>
    <button class="btn primary" data-act="add" data-table="installs">+ New Request</button>
  </div>
  <div class="card">
    ${rows.length ? `<div class="tw"><table>
      <thead><tr><th>ID</th><th>Date</th><th>Type</th><th>Name</th><th>Address</th><th>Plan</th><th>NAP</th><th>Status</th><th>Schedule</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>` : `<div class="empty"><div class="big">📥</div>No requests yet.</div>`}
  </div>
  `;
}

/* ------------------------------ inventory ------------------------------ */
function pageInventory(){
  const rows = [...DB.inventory].sort((a,b)=>String(a.category).localeCompare(String(b.category)));
  const body = rows.map(i=>{
    const c = DB.clients.find(x=>x.id===i.clientId);
    const low = num(i.qty) <= 5 && i.status==='In Stock';
    return `<tr>
      <td><strong>${esc(i.id)}</strong></td>
      <td><span class="badge b-gray">${esc(i.category)}</span></td>
      <td>${esc(i.model||'')}<div class="tiny muted">${esc(i.serial||'')}</div></td>
      <td class="right"><span class="${low?'badge b-red':''}">${num(i.qty)} ${esc(i.unit||'')}</span></td>
      <td>${esc(i.location||'')}</td>
      <td>${c?esc(c.name):'<span class="muted">—</span>'}</td>
      <td><span class="badge ${i.status==='In Stock'?'b-green':'b-blue'}">${esc(i.status)}</span></td>
      <td class="right"><div class="row-actions">
        <button class="btn sm" data-act="edit" data-table="inventory" data-id="${esc(i.id)}">Edit</button>
        <button class="btn sm danger" data-act="del" data-table="inventory" data-id="${esc(i.id)}">✕</button>
      </div></td>
    </tr>`;
  }).join('');

  return `
  <div class="page-head">
    <h1>Inventory</h1>
    <button class="btn primary" data-act="add" data-table="inventory">+ Add Item</button>
  </div>
  <div class="card">
    ${rows.length ? `<div class="tw"><table>
      <thead><tr><th>ID</th><th>Category</th><th>Model / Serial</th><th class="right">Qty</th><th>Location</th><th>Assigned To</th><th>Status</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>` : `<div class="empty"><div class="big">📦</div>No items yet.</div>`}
  </div>
  `;
}

/* ------------------------------ settings ------------------------------ */
function pageSettings(){
  const s = DB.settings;
  const hb = s.homeBase;
  const counts = [
    ['Clients', DB.clients.length],
    ['Invoices', DB.billing.length],
    ['Payments', DB.payments.length],
    ['Receipts issued', DB.payments.filter(p=>p.receiptNo).length],
    ['NAP Boxes', DB.napBoxes.length],
    ['NAP Ports', DB.napPorts.length],
    ['Tickets', DB.complaints.length],
    ['Requests', DB.installs.length],
    ['Inventory', DB.inventory.length],
  ];

  return `
  <div class="page-head"><h1>Settings</h1></div>

  <div class="card">
    <div class="card-head"><h2>Business Info (for receipts)</h2></div>
    <label class="field"><span>Business Name</span>
      <input id="setBusiness" value="${esc(s.business||'')}" placeholder="My ISP"></label>
    <label class="field"><span>Tagline</span>
      <input id="setTagline" value="${esc(s.tagline||'')}" placeholder="Fiber Internet Service Provider"></label>
    <label class="field"><span>Address</span>
      <input id="setAddress" value="${esc(s.address||'')}" placeholder="Brgy. San Isidro, Calamba, Laguna"></label>
    <label class="field"><span>Contact (phone · email)</span>
      <input id="setContact" value="${esc(s.contact||'')}" placeholder="0917-000-0000 · myisp@example.com"></label>
    <label class="field"><span>TIN (optional)</span>
      <input id="setTin" value="${esc(s.tin||'')}" placeholder="000-000-000-000"></label>
  </div>

  <div class="card">
    <div class="card-head"><h2>Plans & Billing</h2></div>
    <div class="grid2">
      ${tagEditorMarkup('plans','Plans',s.plans||[])}
      ${tagEditorMarkup('methods','Payment Methods',s.methods||[])}
    </div>
    <label class="field"><span>Due Day of Month</span>
      <input id="setDueDay" type="number" min="1" max="28" value="${esc(s.dueDay||5)}"></label>
    <button class="btn primary block" data-act="saveSettings">Save Settings</button>
  </div>

  <div class="card">
    <div class="card-head"><h2>Daily Late Payment Notifications</h2></div>
    <div class="note mb-12" id="pushNotificationStatus">
      Checking notification support…
    </div>
    <button class="btn primary block" data-act="enablePushNotifications">Enable on this device</button>
    <button class="btn block mt-8" data-act="disablePushNotifications" hidden>Turn off on this device</button>
    <button class="btn block mt-8" data-act="testBrowserNotification">Test notification now</button>
    <div class="tiny muted mt-10">
      Sends a daily reminder at 8:00 AM Asia/Manila when unpaid invoices are overdue. The alert includes client names and balances, which may be visible on your lock screen. Requires browser notification permission and HTTPS (localhost is supported). The test button sends an immediate browser notification to this device.
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>Home Base / OLT</h2></div>
    <div class="note mb-12">
      This is the marker on the map that NAP boxes connect to by default. Drag it on the map to reposition.
    </div>
    <label class="field"><span>Name</span>
      <input id="setHomeName" value="${esc(hb.name||'')}"></label>
    <div class="grid2">
      <label class="field"><span>Latitude</span>
        <input id="setHomeLat" type="number" step="any" value="${esc(hb.lat)}"></label>
      <label class="field"><span>Longitude</span>
        <input id="setHomeLng" type="number" step="any" value="${esc(hb.lng)}"></label>
    </div>
    <button class="btn primary block" data-act="saveHome">Save Home Base</button>
  </div>

  <div class="card">
    <div class="card-head"><h2>Backup & Restore</h2></div>
    <div class="note mb-12">
      Changes are saved to PostgreSQL on the server and shared by every signed-in device. If the server
      is unreachable, changes are kept on this device and uploaded on the next save. Download a backup
      regularly and keep it somewhere safe.
    </div>
    <button class="btn primary block mb-8" id="btnBackup2">⬇ Download Backup (JSON)</button>
    <button class="btn block mb-8" id="btnRestore2">⬆ Restore from Backup</button>
    <button class="btn block mb-8" id="btnCsv">📄 Export Clients as CSV</button>
    <hr>
    <button class="btn danger block" data-act="wipe">🗑 Erase Everything</button>
  </div>

  <div class="card">
    <div class="card-head"><h2>Records</h2></div>
    <div class="tw"><table>
      <tbody>${counts.map(([k,v])=>`<tr><td>${k}</td><td class="right"><strong>${v}</strong></td></tr>`).join('')}</tbody>
    </table></div>
  </div>

  <div class="card">
    <div class="card-head"><h2>Privacy Reminders</h2></div>
    <div class="note">
      • Client data is sensitive under RA 10173 (Data Privacy Act).<br>
      • Use a dedicated device or browser profile for this app.<br>
      • Only share backups with staff who need them.<br>
      • Password-protect backup files before storing in the cloud.<br>
      • Delete client records you no longer need.
    </div>
  </div>
  `;
}

function tagEditorMarkup(key, label, values){
  const chips = values.map(value=>`
    <span class="tag-chip" data-tag-value="${esc(value)}">
      <span>${esc(value)}</span>
      <button class="tag-remove" type="button" data-tag-remove aria-label="Remove ${esc(value)}">×</button>
    </span>`).join('');
  return `<label class="field"><span>${esc(label)}</span>
    <div class="tag-editor" data-tag-editor="${esc(key)}">
      ${chips}
      <input type="text" data-tag-input="${esc(key)}" placeholder="Add ${esc(label.toLowerCase())}" autocomplete="off">
      <button class="btn tag-add" type="button" data-tag-add="${esc(key)}" title="Add ${esc(label.toLowerCase())}" aria-label="Add ${esc(label.toLowerCase())}">+</button>
    </div>
  </label>`;
}

function addEditorTag(input){
  const value = input.value.trim();
  if(!value) return;
  const editor = input.closest('[data-tag-editor]');
  const duplicate = [...editor.querySelectorAll('[data-tag-value]')]
    .some(chip=>chip.dataset.tagValue.toLowerCase()===value.toLowerCase());
  input.value = '';
  if(duplicate) return;

  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  chip.dataset.tagValue = value;
  const text = document.createElement('span');
  text.textContent = value;
  const remove = document.createElement('button');
  remove.className = 'tag-remove';
  remove.type = 'button';
  remove.dataset.tagRemove = '';
  remove.setAttribute('aria-label', `Remove ${value}`);
  remove.textContent = '×';
  chip.append(text, remove);
  editor.insertBefore(chip, input);
}

function readEditorTags(key){
  const editor = document.querySelector(`[data-tag-editor="${key}"]`);
  const input = editor.querySelector('[data-tag-input]');
  addEditorTag(input);
  return [...editor.querySelectorAll('[data-tag-value]')].map(chip=>chip.dataset.tagValue);
}

/* ------------------------------ month options ------------------------------ */
function monthOptions(){
  const set = new Set(DB.billing.map(b=>b.month));
  set.add(ym(new Date()));
  for(let i=-6;i<=6;i++){
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth()+i);
    set.add(ym(d));
  }
  return [...set].filter(Boolean).sort().reverse();
}
