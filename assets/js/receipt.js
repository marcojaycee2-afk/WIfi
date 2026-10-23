/* =========================================================================
   RECEIPT
   ========================================================================= */
function openReceipt(paymentId){
  const p = DB.payments.find(x=>String(x.id)===String(paymentId));
  if(!p){ toast('Payment not found'); return; }
  if(!p.receiptNo){ p.receiptNo = nextReceiptNo(); save(); }
  state.currentReceiptId = p.id;

  const c = DB.clients.find(x=>x.id===p.clientId) || {};
  const s = DB.settings;

  const initial = (s.business||'ISP').trim().charAt(0).toUpperCase();
  const dateStr = dateLabel(p.date);
  const timeStr = p.createdAt ? new Date(p.createdAt).toTimeString().slice(0,5) : nowTime();

  // amounts
  const amount = num(p.amount);
  const invoice = DB.billing.find(b=>b.clientId===p.clientId && b.month===p.month);
  const monthDue = invoice ? num(invoice.amountDue) : null;
  // sum all payments for this invoice
  const paidToInvoice = DB.payments
    .filter(x=>x.clientId===p.clientId && x.month===p.month)
    .reduce((s,x)=>s+num(x.amount),0);
  const monthBalance = monthDue!=null ? Math.max(0, monthDue - paidToInvoice) : null;

  const html = `
  <div class="receipt-paper" id="receiptPaper">
    <div class="rp-header">
      <div class="rp-logo">${esc(initial)}</div>
      <div class="rp-biz">${esc(s.business||'')}</div>
      ${s.tagline?`<div class="rp-tagline">${esc(s.tagline)}</div>`:''}
      ${s.address?`<div class="rp-addr">${esc(s.address)}</div>`:''}
      ${s.contact?`<div class="rp-contact">${esc(s.contact)}</div>`:''}
      ${s.tin?`<div class="rp-contact">TIN: ${esc(s.tin)}</div>`:''}
    </div>

    <div class="rp-divider solid">========================================</div>
    <div class="rp-title">OFFICIAL RECEIPT</div>
    <div class="rp-divider solid">========================================</div>

    <div class="rp-row"><span>Receipt No:</span><span>${esc(p.receiptNo)}</span></div>
    <div class="rp-row"><span>Date:</span><span>${esc(dateStr)}</span></div>
    <div class="rp-row"><span>Time:</span><span>${esc(timeStr)}</span></div>

    <div class="rp-divider">----------------------------------------</div>

    <div class="rp-label">RECEIVED FROM</div>
    <div class="rp-name">${esc(c.name||p.clientId)}</div>
    <div class="rp-row"><span>Client ID:</span><span>${esc(c.id||p.clientId)}</span></div>
    ${c.contact?`<div class="rp-row"><span>Contact:</span><span>${esc(c.contact)}</span></div>`:''}
    ${(c.barangay||c.city)?`<div class="rp-row"><span>Address:</span><span>${esc([c.barangay,c.city,c.province].filter(Boolean).join(', '))}</span></div>`:''}

    <div class="rp-divider">----------------------------------------</div>

    <div class="rp-label">FOR</div>
    <div class="rp-row"><span>Billing Month:</span><span>${esc(monthLabel(p.month))}</span></div>
    ${monthDue!=null?`<div class="rp-row"><span>Amount Due:</span><span>${peso(monthDue)}</span></div>`:''}

    <div class="rp-divider">----------------------------------------</div>

    <div class="rp-row big"><span>AMOUNT PAID:</span><span>${peso(amount)}</span></div>

    <div class="rp-row"><span>Method:</span><span>${esc(p.method||'—')}</span></div>
    ${p.ref?`<div class="rp-row"><span>Reference No:</span><span>${esc(p.ref)}</span></div>`:''}
    ${monthBalance!=null?`<div class="rp-row"><span>Invoice Balance:</span><span>${monthBalance>0?peso(monthBalance):'FULLY PAID'}</span></div>`:''}
    <div class="rp-row"><span>Received By:</span><span>${esc(p.receivedBy||'Admin')}</span></div>
    ${p.notes?`<div class="rp-row"><span>Notes:</span><span>${esc(p.notes)}</span></div>`:''}

    <div class="rp-divider solid">========================================</div>

    <div class="rp-thanks">THANK YOU!</div>
    <div class="rp-footer">Please keep this receipt for your records.</div>
    <div class="rp-footer">This serves as proof of payment.</div>

    <div class="rp-barcode">*${esc(p.receiptNo)}*</div>
  </div>`;

  document.getElementById('receiptPaperMount').innerHTML = html;
  activateDialog('receiptBackdrop');
  document.body.style.overflow = 'hidden';
}

function closeReceipt(){
  deactivateDialog('receiptBackdrop');
  document.getElementById('receiptPaperMount').innerHTML = '';
  document.body.style.overflow = '';
  state.currentReceiptId = null;
}

function receiptPlainText(){
  const p = DB.payments.find(x=>String(x.id)===String(state.currentReceiptId));
  if(!p) return '';
  const c = DB.clients.find(x=>x.id===p.clientId) || {};
  const s = DB.settings;
  const line = '----------------------------------------';
  const dline = '========================================';

  return [
    s.business,
    s.tagline||'',
    s.address||'',
    s.contact||'',
    dline,
    'OFFICIAL RECEIPT',
    dline,
    `Receipt No: ${p.receiptNo}`,
    `Date: ${dateLabel(p.date)}`,
    `Time: ${nowTime()}`,
    line,
    'RECEIVED FROM',
    c.name || p.clientId,
    `Client ID: ${c.id || p.clientId}`,
    c.contact?`Contact: ${c.contact}`:'',
    c.barangay?`Address: ${[c.barangay,c.city,c.province].filter(Boolean).join(', ')}`:'',
    line,
    'FOR',
    `Billing Month: ${monthLabel(p.month)}`,
    line,
    `AMOUNT PAID: ${peso(p.amount)}`,
    `Method: ${p.method||'—'}`,
    p.ref?`Reference: ${p.ref}`:'',
    `Received By: ${p.receivedBy||'Admin'}`,
    dline,
    'THANK YOU!',
    'Keep this receipt for your records.',
    dline
  ].filter(Boolean).join('\n');
}

async function copyReceiptText(){
  const txt = receiptPlainText();
  try{
    await navigator.clipboard.writeText(txt);
    toast('Receipt copied to clipboard');
  }catch(e){
    // fallback
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Receipt copied to clipboard');
  }
}

async function shareReceipt(){
  const p = DB.payments.find(x=>String(x.id)===String(state.currentReceiptId));
  if(!p) return;
  const c = DB.clients.find(x=>x.id===p.clientId) || {};
  const s = DB.settings;
  const text = `*${s.business}*\nOfficial Receipt ${p.receiptNo}\n\nReceived from: ${c.name||p.clientId}\nAmount: ${peso(p.amount)}\nFor: ${monthLabel(p.month)}\nMethod: ${p.method}\n${p.ref?'Ref: '+p.ref+'\n':''}Date: ${dateLabel(p.date)}\n\nThank you!`;

  if(navigator.share){
    try{
      await navigator.share({ title:`Receipt ${p.receiptNo}`, text });
      return;
    }catch(e){ /* fallthrough */ }
  }
  // fallback: copy
  try{
    await navigator.clipboard.writeText(text);
    toast('Receipt copied — paste to send');
  }catch(e){
    toast('Sharing not supported');
  }
}
