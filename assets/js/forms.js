/* =========================================================================
   FORMS
   ========================================================================= */
const SCHEMAS = {
  clients: {
    title:'Client',
    fields:[
      {k:'id',   l:'Client ID', t:'text', req:true, def:()=>nextId('C', DB.clients)},
      {k:'name', l:'Full Name', t:'text', req:true},
      {k:'barangay', l:'Address / Barangay', t:'text'},
      {k:'lat', l:'House GPS Latitude', t:'number', step:'any'},
      {k:'lng', l:'House GPS Longitude', t:'number', step:'any'},
      {k:'city', l:'City / Municipality', t:'text'},
      {k:'province', l:'Province', t:'text'},
      {k:'contact', l:'Contact Number', t:'tel'},
      {k:'plan', l:'Plan / Speed', t:'select', opts:()=>DB.settings.plans||[]},
      {k:'rate', l:'Monthly Rate (₱)', t:'number', req:true,
        hint:'Defaults to the plan price. Edit this amount for a customer discount.'},
      {k:'installed', l:'Installation Date', t:'date'},
      {k:'napId', l:'NAP Box', t:'select', opts:()=>DB.napBoxes.map(b=>b.id)},
      {k:'port', l:'NAP Port No.', t:'number'},
      {k:'onu', l:'ONU / Router Serial', t:'text'},
      {k:'mac', l:'MAC Address', t:'text'},
      {k:'pppoe', l:'PPPoE / Account Username', t:'text'},
      {k:'service', l:'Service', t:'select', opts:()=>['pppoe'], def:()=>'pppoe'},
      {k:'remoteIpv6Prefix', l:'Remote IPv6 Prefix', t:'text'},
      {k:'status', l:'Status', t:'select', opts:()=>['Active','Suspended','Disconnected'], def:()=>'Active'},
      {k:'notes', l:'Notes', t:'textarea'},
    ]
  },
  billing: {
    title:'Invoice',
    fields:[
      {k:'id', l:'Invoice ID', t:'text', req:true, def:()=>`INV-${state.month}-${uid()}`},
      {k:'month', l:'Billing Month', t:'month', req:true, pattern:'\\d{4}-\\d{2}', placeholder:'YYYY-MM', def:()=>state.month},
      {k:'clientId', l:'Client', t:'client', req:true},
      {k:'dueDate', l:'Due Date', t:'date', req:true, def:()=>`${state.month}-${pad(DB.settings.dueDay||5)}`},
      {k:'amountDue', l:'Amount Due (₱)', t:'number', req:true, min:'0', step:'0.01'},
      {k:'remarks', l:'Remarks', t:'text'},
    ]
  },
  payments: {
    title:'Payment',
    fields:[
      {k:'id', l:'Payment ID', t:'text', req:true, def:()=>nextId('P', DB.payments)},
      {k:'receiptNo', l:'Receipt No.', t:'text', def:()=>nextReceiptNo()},
      {k:'date', l:'Date Paid', t:'date', req:true, def:()=>todayISO()},
      {k:'clientId', l:'Client', t:'client', req:true},
      {k:'month', l:'Billing Month', t:'month', req:true, pattern:'\\d{4}-\\d{2}', placeholder:'YYYY-MM', def:()=>state.month,
        hint:'The payment is applied to this client\'s invoice for this month.'},
      {k:'amount', l:'Amount Paid (₱)', t:'number', req:true, min:'0.01', step:'0.01'},
      {k:'method', l:'Payment Method', t:'select', opts:()=>DB.settings.methods||[], def:()=>'Cash'},
      {k:'ref', l:'Reference Number', t:'text'},
      {k:'receivedBy', l:'Received By', t:'text', req:true, def:()=>lastReceivedBy()},
      {k:'notes', l:'Notes', t:'text'},
    ]
  },
  napBoxes: {
    title:'NAP Box',
    fields:[
      {k:'id', l:'NAP Box ID', t:'text', req:true, def:()=>nextId('NAP', DB.napBoxes)},
      {k:'label', l:'Label / Name', t:'text'},
      {k:'address', l:'Location / Address', t:'text'},
      {k:'landmark', l:'Landmark', t:'text'},
      {k:'lat', l:'GPS Latitude', t:'number', step:'any'},
      {k:'lng', l:'GPS Longitude', t:'number', step:'any'},
      {k:'uplinkId', l:'Uplink (NAP Box)', t:'select', opts:()=>DB.napBoxes.map(b=>b.id)},
      {k:'upstream', l:'Upstream Type', t:'select', opts:()=>['Splitter','OLT','Main Line','Other'], def:()=>'Splitter'},
      {k:'upstreamId', l:'Upstream Device / ID', t:'text'},
      {k:'splitter', l:'Total Ports', t:'select', req:true, opts:()=>['8','16','2:8','2:16'], def:()=>'8'},
      {k:'route', l:'Fiber Route / Cable Notes', t:'textarea'},
      {k:'installed', l:'Installation Date', t:'date'},
      {k:'lastMaint', l:'Last Maintenance Date', t:'date'},
      {k:'color', l:'Map Pin Color', t:'color', def:()=>'#3b82f6'},
      {k:'status', l:'Status', t:'select', opts:()=>['Active','Under Repair','Planned','Decommissioned'], def:()=>'Active'},
    ]
  },
  complaints: {
    title:'Ticket',
    fields:[
      {k:'id', l:'Ticket ID', t:'text', req:true, def:()=>nextId('T', DB.complaints)},
      {k:'date', l:'Date Reported', t:'date', req:true, def:()=>todayISO()},
      {k:'clientId', l:'Client', t:'client', req:true},
      {k:'category', l:'Issue Category', t:'select',
        opts:()=>['No Internet','Slow speed','Intermittent','Cable cut','ONU faulty','Billing','Relocation','Other']},
      {k:'description', l:'Description', t:'textarea'},
      {k:'tech', l:'Technician', t:'text'},
      {k:'status', l:'Status', t:'select', opts:()=>['Open','In Progress','Resolved','Closed'], def:()=>'Open'},
      {k:'fixedDate', l:'Date Fixed', t:'date'},
      {k:'resolution', l:'Resolution Notes', t:'textarea'},
      {k:'cost', l:'Cost (₱)', t:'number', min:'0', step:'0.01', def:()=>0},
    ]
  },
  installs: {
    title:'Request',
    fields:[
      {k:'id', l:'Request ID', t:'text', req:true, def:()=>nextId('R', DB.installs)},
      {k:'date', l:'Date Requested', t:'date', req:true, def:()=>todayISO()},
      {k:'type', l:'Type', t:'select', opts:()=>['New Install','Disconnection','Relocation','Upgrade','Repair'], def:()=>'New Install'},
      {k:'name', l:'Client / Prospect Name', t:'text', req:true},
      {k:'contact', l:'Contact', t:'text'},
      {k:'address', l:'Address / Barangay', t:'text'},
      {k:'plan', l:'Plan', t:'select', opts:()=>DB.settings.plans||[]},
      {k:'napId', l:'NAP Box', t:'select', opts:()=>DB.napBoxes.map(b=>b.id)},
      {k:'status', l:'Status', t:'select', opts:()=>['Pending','Scheduled','In Progress','Completed','Cancelled'], def:()=>'Pending'},
      {k:'schedule', l:'Scheduled Date', t:'date'},
      {k:'tech', l:'Technician', t:'text'},
      {k:'notes', l:'Notes', t:'textarea'},
    ]
  },
  inventory: {
    title:'Inventory Item',
    fields:[
      {k:'id', l:'Item ID', t:'text', req:true, def:()=>nextId('IT', DB.inventory)},
      {k:'category', l:'Category', t:'select',
        opts:()=>['ONU','Router','Fiber Cable','Connectors','Splitter','Tools','Other'], def:()=>'ONU'},
      {k:'model', l:'Brand / Model', t:'text'},
      {k:'serial', l:'Serial / MAC', t:'text'},
      {k:'qty', l:'Quantity', t:'number', req:true, min:'0', step:'any', def:()=>1},
      {k:'unit', l:'Unit', t:'select', opts:()=>['pcs','m','roll','box','set'], def:()=>'pcs'},
      {k:'location', l:'Location / Stockroom', t:'text', def:()=>'Main stock'},
      {k:'clientId', l:'Assigned to Client', t:'client'},
      {k:'status', l:'Status', t:'select', opts:()=>['In Stock','Installed','Damaged','Lost'], def:()=>'In Stock'},
      {k:'dateAdded', l:'Date Added', t:'date', def:()=>todayISO()},
      {k:'notes', l:'Notes', t:'textarea'},
    ]
  },
};

function openForm(table, id, initialValues={}){
  const schema = SCHEMAS[table];
  const isNew = !id;
  const row = isNew ? {} : DB[table].find(r=>String(r.id)===String(id));
  if(!isNew && !row){ toast('Record not found'); return; }

  const data = isNew ? initialValues : {...row, ...initialValues};

  const fieldsHtml = schema.fields.map(f=>{
    let val = data[f.k];
    if((val===undefined || val==='') && isNew && f.def) val = f.def();
    if(val===undefined || val===null) val = '';

    let input;
    if(f.t==='select'){
      const opts = f.opts ? f.opts() : [];
      if(table==='napBoxes' && f.k==='splitter'){
        val = normalizeSplitterChoice(val, data.totalPorts);
        return `<fieldset class="field">
          <legend class="field-legend">${esc(f.l)}${f.req?' *':''}</legend>
          <div class="splitter-choice-group" role="radiogroup" aria-label="Total ports">
            ${opts.map((option,index)=>`<label class="splitter-choice">
              <input type="radio" name="${f.k}" value="${esc(option)}" ${String(val)===String(option)?'checked':''} ${f.req&&index===0?'required':''}>
              <span>${esc(option)}</span>
            </label>`).join('')}
          </div>
        </fieldset>`;
      }
      if(f.k==='plan'){
        const customPlanValue = '__custom_plan__';
        const configuredPlans = opts.filter(o=>String(o).toLowerCase()!=='custom');
        const planOptions = [...new Set(['25 Mbps','50 Mbps',...configuredPlans])];
        const hasPlanOption = planOptions.some(o=>String(o)===String(val));
        const selectedPlan = hasPlanOption ? val : (val ? customPlanValue : '');
        const customSpeed = !hasPlanOption && val
          ? (String(val).match(/^(\d+(?:\.\d+)?)\s*mbps$/i)||[])[1] || ''
          : '';
        const planChoices = `<div class="plan-choice-group" role="radiogroup" aria-label="${esc(f.l)}">
          ${planOptions.map(option=>`<label class="plan-choice">
            <input type="radio" name="${f.k}" value="${esc(option)}" ${String(selectedPlan)===String(option)?'checked':''} ${f.req?'required':''}>
            <span>${esc(option)}</span>
          </label>`).join('')}
          <label class="plan-choice">
            <input type="radio" name="${f.k}" value="${customPlanValue}" ${selectedPlan===customPlanValue?'checked':''} ${f.req?'required':''}>
            <span>Custom</span>
            <span class="plan-custom-entry" data-custom-speed-field>
              <input name="customMbps" type="number" min="0.01" step="any" inputmode="decimal"
                aria-label="Custom speed in Mbps" placeholder="Enter Mbps"
                value="${esc(customSpeed)}" ${selectedPlan===customPlanValue?'required':''}>
            </span>
          </label>
        </div>
        `;
        return `<div class="field"><span>${esc(f.l)}${f.req?' *':''}</span>
          ${planChoices}
          ${f.hint?`<small class="field-hint">${esc(f.hint)}</small>`:''}</div>`;
      }
      input = `<select name="${f.k}" ${f.req?'required':''}>
        <option value="">— select —</option>
        ${opts.map(o=>`<option value="${esc(o)}" ${String(val)===String(o)?'selected':''}>${esc(o)}</option>`).join('')}
      </select>`;
    } else if(f.t==='client'){
      input = `<select name="${f.k}" ${f.req?'required':''}>
        <option value="">— select client —</option>
        ${DB.clients.map(c=>`<option value="${esc(c.id)}" ${String(val)===String(c.id)?'selected':''}>${esc(c.id)} — ${esc(c.name)}</option>`).join('')}
      </select>`;
    } else if(f.t==='textarea'){
      input = `<textarea name="${f.k}" rows="2">${esc(val)}</textarea>`;
    } else if(f.t==='color'){
      input = `<input name="${f.k}" type="color" value="${esc(val)||'#3b82f6'}">`;
    } else {
      input = `<input name="${f.k}" type="${f.t}" value="${esc(val)}"
        ${f.req?'required':''} ${f.step?`step="${esc(f.step)}"`:''} ${f.min!==undefined?`min="${esc(f.min)}"`:''}
        ${f.pattern?`pattern="${esc(f.pattern)}"`:''} ${f.placeholder?`placeholder="${esc(f.placeholder)}"`:''}>`;
    }
    return `<label class="field"><span>${esc(f.l)}${f.req?' *':''}</span>${input}${f.hint?`<small class="field-hint">${esc(f.hint)}</small>`:''}</label>`;
  }).join('');

  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <div class="modal-head">
      <h2 id="modalTitle">${isNew?'Add':'Edit'} ${esc(schema.title)}</h2>
      <button class="btn sm" type="button" data-act="closeModal" aria-label="Close">✕</button>
    </div>
    <form id="modalForm" aria-labelledby="modalTitle">${fieldsHtml}
      <div class="modal-actions">
        <button type="button" class="btn" data-act="closeModal">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>`;

  activateDialog('backdrop');

  document.getElementById('modalForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const obj = {};
    schema.fields.forEach(f=>{
      let v = fd.get(f.k);
      if(v===null) v = '';
      if(f.t==='number' && v!=='') v = Number(v);
      obj[f.k] = v;
    });

    if(table==='napBoxes'){
      obj.splitter = normalizeSplitterChoice(obj.splitter, obj.totalPorts);
      obj.totalPorts = splitterPortCount(obj.splitter);
    }

    if(schema.fields.some(f=>f.k==='plan')){
      const plan = e.target.elements.namedItem('plan');
      if(plan && plan.value==='__custom_plan__'){
        const customMbps = Number(e.target.elements.namedItem('customMbps').value);
        if(!Number.isFinite(customMbps) || customMbps<=0){
          toast('Enter a valid custom speed in Mbps'); return;
        }
        obj.plan = `${customMbps} Mbps`;
      }
    }

    const old = isNew ? null : {...row};
    if(!isNew && DB[table].some(record=>
      String(record.id)===String(obj.id) && String(record.id)!==String(id))){
      toast('ID already exists'); return;
    }
    if(table==='napBoxes' && old && obj.totalPorts<Number(old.totalPorts)){
      const occupiedPort = DB.napPorts.find(port=>
        port.napId===old.id && Number(port.port)>obj.totalPorts &&
        (port.clientId || port.status!=='Free')
      );
      const assignedClient = DB.clients.find(client=>
        client.napId===old.id && Number(client.port)>obj.totalPorts
      );
      const portToKeep = occupiedPort?.port || assignedClient?.port;
      if(portToKeep){
        toast(`Cannot reduce ports while port ${portToKeep} is assigned or in use`);
        return;
      }
    }
    if(table==='payments'){
      const paymentError = preparePayment(obj, isNew ? null : row);
      if(paymentError){ toast(paymentError); return; }
    }
    if(table==='billing'){
      const invoiceError = validateInvoice(obj);
      if(invoiceError){ toast(invoiceError); return; }
    }

    if(table==='clients'){
      if(obj.lat!=='' || obj.lng!==''){
        const lat = Number(obj.lat), lng = Number(obj.lng);
        if(obj.lat==='' || obj.lng==='' || !Number.isFinite(lat) || !Number.isFinite(lng) ||
           lat < -90 || lat > 90 || lng < -180 || lng > 180){
          toast('Enter valid latitude and longitude for the house'); return;
        }
      }
      const portError = clientPortError(obj, old ? old.id : obj.id);
      if(portError){ toast(portError); return; }
      if(obj.napId && obj.port){
        const targetPort = DB.napPorts.find(p=>p.napId===obj.napId && Number(p.port)===Number(obj.port));
        if(targetPort && ['Faulty','Reserved'].includes(targetPort.status)){
          toast('Choose a free NAP port'); return;
        }
      }
    }

    if(isNew && DB[table].some(r=>String(r.id)===String(obj.id))){
      toast('ID already exists'); return;
    }

    const persisted = await commit(()=>{
      if(isNew){
        // stamp createdAt for receipts
        if(table==='payments'){
          obj.createdAt = new Date().toISOString();
          if(!obj.receiptNo) obj.receiptNo = nextReceiptNo();
        }
        DB[table].push(obj);
      } else {
        const idx = DB[table].findIndex(r=>String(r.id)===String(id));
        if(idx<0){ toast('This record no longer exists'); return false; }
        const current = DB[table][idx];
        // preserve createdAt
        if(table==='payments' && current.createdAt && !obj.createdAt) obj.createdAt = current.createdAt;
        DB[table][idx] = {...current, ...obj};
      }

      if(table==='clients'){
        if(old) NapboxBilling.renameClientReferences(DB, old.id, obj.id);
        syncClientPort(obj, old);
      }
      if(table==='billing' && old){
        NapboxBilling.renameInvoiceReferences(DB, old.id, obj.id);
        DB.payments.forEach(payment=>{
          if(payment.invoiceId===obj.id){ payment.clientId = obj.clientId; payment.month = obj.month; }
        });
      }
      if(table==='napBoxes') ensurePorts(obj);
    }, 'Could not save this record. Please check your connection and try again.');
    if(!persisted) return;
    if(table==='payments') rememberReceivedBy(obj.receivedBy);
    closeModal(); render();
    toast(isNew ? 'Added' : 'Updated');

    // offer to open receipt if new payment
    if(isNew && table==='payments'){
      setTimeout(()=>openReceipt(obj.id), 200);
    }
  });
}

const isValidISODate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value||'')) &&
  iso(new Date(`${value}T00:00:00`))===value;
const isValidMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value||''));

function validateInvoice(invoice){
  if(!DB.clients.some(client=>client.id===invoice.clientId)) return 'Choose a client';
  if(!isValidMonth(invoice.month)) return 'Enter the billing month as YYYY-MM';
  if(!isValidISODate(invoice.dueDate)) return 'Choose a valid due date';
  const amount = Number(invoice.amountDue);
  if(!Number.isFinite(amount) || amount<0) return 'Enter a valid amount due';
  invoice.amountDue = Math.round(amount*100)/100;
  return '';
}

// Validates a payment from the generic form and links it to an invoice. Returns an error message or ''.
function preparePayment(payment, existing){
  if(!DB.clients.some(client=>client.id===payment.clientId)) return 'Choose a client';
  if(!isValidISODate(payment.date)) return 'Choose a valid payment date';
  if(!isValidMonth(payment.month)) return 'Enter the billing month as YYYY-MM';
  const amount = Math.round(Number(payment.amount)*100)/100;
  if(!Number.isFinite(amount) || amount<=0) return 'Enter an amount greater than ₱0.00';
  payment.amount = amount;
  payment.receivedBy = String(payment.receivedBy||'').trim();
  if(!payment.receivedBy) return 'Enter who received the payment';

  const invoices = DB.billing.filter(invoice=>
    invoice.clientId===payment.clientId && invoice.month===payment.month);
  if(!invoices.length){
    return `No invoice exists for this client in ${monthLabel(payment.month)}. Create or generate the invoice first.`;
  }
  const excludeId = existing ? existing.id : null;
  const balanceOf = invoice => NapboxBilling.invoiceBalance(DB, invoice, excludeId);
  const invoice = invoices.find(row=>existing && row.id===existing.invoiceId) ||
    [...invoices].sort((a,b)=>balanceOf(b)-balanceOf(a))[0];
  const balance = Math.round(balanceOf(invoice)*100)/100;
  if(amount>balance+0.001){
    return balance>0
      ? `Amount is more than the invoice balance of ${peso(balance)}`
      : 'This invoice is already fully paid';
  }
  payment.invoiceId = invoice.id;
  return '';
}

function closeModal(){
  deactivateDialog('backdrop');
  document.getElementById('modal').innerHTML = '';
  state.pendingClientHouse = null;
}

/* ------------------------------ port modal ------------------------------ */
function openPortModal(napId, port){
  const box = DB.napBoxes.find(b=>b.id===napId);
  if(!box) return;
  const p = DB.napPorts.find(x=>x.napId===napId && Number(x.port)===Number(port));
  const curClient = p && p.clientId ? DB.clients.find(c=>c.id===p.clientId) : null;
  const status = p ? p.status : 'Free';
  const currentFiberColor = p?.fiberColor || '';
  const standardColor = FIBER_COLOR_MAP[String(currentFiberColor).toLowerCase()] ? currentFiberColor : '';
  const customColor = standardColor ? '#94a3b8' : fiberColorHex(currentFiberColor);
  const clientOptions = DB.clients.map(c=>
    `<option value="${esc(c.id)}" ${curClient && curClient.id===c.id?'selected':''}>${esc(c.id)} — ${esc(c.name)}</option>`
  ).join('');

  document.getElementById('modal').innerHTML = `
    <div class="modal-head">
      <h2>${esc(box.id)} · Port ${port}</h2>
      <button class="btn sm" type="button" data-act="closeModal" aria-label="Close">✕</button>
    </div>
    <form id="portForm">
      <input type="hidden" name="napId" value="${esc(napId)}">
      <input type="hidden" name="port" value="${port}">
      <label class="field"><span>Port Status</span>
        <select name="status">
          <option value="Free" ${status==='Free'?'selected':''}>Free / Available</option>
          <option value="Used" ${status==='Used'?'selected':''}>Used / Connected</option>
          <option value="Reserved" ${status==='Reserved'?'selected':''}>Reserved</option>
          <option value="Faulty" ${status==='Faulty'?'selected':''}>Faulty / Broken</option>
        </select>
      </label>
      <label class="field"><span>Assign Client (optional)</span>
        <select name="clientId">
          <option value="">— none —</option>
          ${clientOptions}
        </select>
      </label>
      <div class="field fiber-color-field">
        <label>
          <span class="field-label">Fiber Cable Color</span>
          <select name="fiberColor" id="portFiberColor">
            ${fiberColorOptions(standardColor || (currentFiberColor ? '__custom__' : ''))}
          </select>
          <small class="field-hint">Record the actual cable color used on this connected port.</small>
        </label>
        <div class="fiber-color-preview" title="Selected fiber cable color">
          <span class="swatch" id="portFiberSwatch" style="background:${escStyleHex(currentFiberColor || '#94a3b8')}"></span>
        </div>
      </div>
      <label class="field" id="customFiberColorWrap" style="display:${currentFiberColor && !standardColor?'block':'none'}">
        <span>Custom Fiber Color</span>
        <input type="color" name="customFiberColor" id="customFiberColor" value="${escStyleHex(customColor)}">
      </label>
      <label class="field"><span>Notes</span>
        <input name="notes" value="${esc(p?p.notes:'')}">
      </label>
      <div class="modal-actions">
        <button type="button" class="btn" data-act="closeModal">Cancel</button>
        <button type="submit" class="btn primary">Save Port</button>
      </div>
    </form>`;

  activateDialog('backdrop');

  const fiberSelect = document.getElementById('portFiberColor');
  const customWrap = document.getElementById('customFiberColorWrap');
  const customInput = document.getElementById('customFiberColor');
  const preview = document.getElementById('portFiberSwatch');
  const updateFiberPreview = ()=>{
    const isCustom = fiberSelect.value==='__custom__';
    customWrap.style.display = isCustom ? 'block' : 'none';
    const color = isCustom ? customInput.value : fiberSelect.value;
    preview.style.background = color || '#94a3b8';
  };
  fiberSelect.addEventListener('change', updateFiberPreview);
  customInput.addEventListener('input', updateFiberPreview);
  updateFiberPreview();

  document.getElementById('portForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const napId = fd.get('napId');
    const portNum = Number(fd.get('port'));
    const newStatus = fd.get('status');
    const selectedClientId = fd.get('clientId');
    const clientId = newStatus==='Used' ? selectedClientId : '';
    const notes = fd.get('notes');
    const selectedFiber = fd.get('fiberColor');
    const fiberColor = selectedFiber==='__custom__' ? fd.get('customFiberColor') : selectedFiber;

    if(newStatus==='Used' && !clientId){
      toast('Choose a client for a used port'); return;
    }
    if(newStatus==='Used' && !fiberColor){
      toast('Choose the fiber cable color for this connection'); return;
    }
    if(clientId){
      const portError = clientPortError({napId, port:portNum}, clientId);
      if(portError){ toast(portError); return; }
    }

    const saved = await commit(()=>{
      let p = DB.napPorts.find(x=>x.napId===napId && Number(x.port)===portNum);
      const oldClientId = p ? p.clientId : '';
      const oldFiberColor = p ? p.fiberColor || '' : '';
      if(!p){
        p = {id:`NP-${napId}-${portNum}`, napId, port:portNum, clientId:'', status:'Free', notes:'', fiberColor:''};
        DB.napPorts.push(p);
      }
      if(newStatus==='Used' && clientId){
        DB.clients.forEach(c=>{
          if(c.id===clientId){
            if(c.napId && Number(c.port) && (c.napId!==napId || Number(c.port)!==portNum)){
              const old = DB.napPorts.find(x=>x.napId===c.napId && Number(x.port)===Number(c.port));
              if(old){ old.clientId=''; old.status='Free'; old.fiberColor=''; }
            }
            c.napId = napId; c.port = portNum;
          }
        });
      }
      if(oldClientId && oldClientId!==clientId){
        const oldC = DB.clients.find(c=>c.id===oldClientId);
        if(oldC && oldC.napId===napId && Number(oldC.port)===portNum){
          oldC.napId = ''; oldC.port = '';
        }
      }
      if(clientId){
        const newC = DB.clients.find(c=>c.id===clientId);
        if(newC){ newC.napId = napId; newC.port = portNum; }
      }
      p.clientId = (newStatus==='Used' && clientId) ? clientId : '';
      p.status = newStatus==='Used' && !clientId ? 'Free' : newStatus;
      p.notes = notes;
      p.fiberColor = newStatus==='Free' ? '' : (fiberColor || oldFiberColor || '');
    }, 'Could not save this port. Please check your connection and try again.');
    if(!saved) return;

    closeModal(); render();
    toast('Port updated');
  });
}

function openClientPortModal(clientId){
  const client = DB.clients.find(c=>c.id===clientId);
  if(!client) return;
  if(!DB.napBoxes.length){
    document.getElementById('modal').innerHTML = `
      <div class="modal-head">
        <h2>Connect ${esc(client.name)}</h2>
        <button class="btn sm" type="button" data-act="closeModal" aria-label="Close">✕</button>
      </div>
      <p class="muted">Add a NAP box and its port count before connecting a customer.</p>
      <div class="modal-actions">
        <button type="button" class="btn" data-act="closeModal">Cancel</button>
        <button type="button" class="btn primary" data-act="goNaps">Go to NAP Boxes</button>
      </div>`;
    activateDialog('backdrop');
    return;
  }

  const getAvailablePorts = napId=>{
    const box = DB.napBoxes.find(item=>item.id===napId);
    if(!box) return [];
    return Array.from({length:num(box.totalPorts)},(_,index)=>index+1).filter(port=>{
      const otherClient = DB.clients.find(item=>
        item.id!==client.id && item.napId===napId && Number(item.port)===port
      );
      if(otherClient) return false;
      const record = DB.napPorts.find(item=>item.napId===napId && Number(item.port)===port);
      if(record && record.clientId && record.clientId!==client.id) return false;
      if(record && record.clientId!==client.id && record.status!=='Free') return false;
      return true;
    });
  };
  const currentPortRecord = client.napId && client.port
    ? DB.napPorts.find(p=>p.napId===client.napId && Number(p.port)===Number(client.port))
    : null;
  const currentFiberColor = currentPortRecord?.fiberColor || '';

  const boxOptions = DB.napBoxes.map(box=>
    `<option value="${esc(box.id)}" ${box.id===client.napId?'selected':''}>${esc(box.id)}${box.label?` · ${esc(box.label)}`:''}</option>`
  ).join('');

  document.getElementById('modal').innerHTML = `
    <div class="modal-head">
      <h2>Connect ${esc(client.name)}</h2>
      <button class="btn sm" type="button" data-act="closeModal" aria-label="Close">✕</button>
    </div>
    <form id="clientPortForm">
      <label class="field"><span>NAP Box</span>
        <select name="napId" required>${boxOptions}</select>
      </label>
      <label class="field"><span>Available Port</span>
        <select name="port" required></select>
      </label>
      <div class="field fiber-color-field">
        <label>
          <span class="field-label">Fiber Cable Color</span>
          <select name="fiberColor" id="clientFiberColor">${fiberColorOptions(currentFiberColor)}</select>
          <small class="field-hint">Record the physical cable color connected to this port.</small>
        </label>
        <div class="fiber-color-preview"><span class="swatch" id="clientFiberSwatch" style="background:${escStyleHex(currentFiberColor||'#94a3b8')}"></span></div>
      </div>
      <label class="field" id="clientCustomFiberWrap" style="display:none">
        <span>Custom Fiber Color</span>
        <input type="color" name="customFiberColor" id="clientCustomFiberColor" value="#94a3b8">
      </label>
      <p class="small muted" id="clientPortHelp"></p>
      <div class="modal-actions">
        <button type="button" class="btn" data-act="closeModal">Cancel</button>
        <button type="submit" class="btn primary">Save Connection</button>
      </div>
    </form>`;

  const form = document.getElementById('clientPortForm');
  const napSelect = form.elements.namedItem('napId');
  const portSelect = form.elements.namedItem('port');
  const help = document.getElementById('clientPortHelp');
  const fiberSelect = document.getElementById('clientFiberColor');
  const customWrap = document.getElementById('clientCustomFiberWrap');
  const customInput = document.getElementById('clientCustomFiberColor');
  const fiberPreview = document.getElementById('clientFiberSwatch');
  const updateFiber = ()=>{
    const isCustom = fiberSelect.value==='__custom__';
    customWrap.style.display = isCustom ? 'block' : 'none';
    fiberPreview.style.background = isCustom ? customInput.value : (fiberSelect.value || '#94a3b8');
  };
  fiberSelect.addEventListener('change', updateFiber);
  customInput.addEventListener('input', updateFiber);
  updateFiber();
  const updatePorts = ()=>{
    const available = getAvailablePorts(napSelect.value);
    const currentPort = client.napId===napSelect.value ? Number(client.port) : 0;
    portSelect.innerHTML = available.length
      ? `<option value="">— choose available port —</option>${available.map(port=>
        `<option value="${port}" ${port===currentPort?'selected':''}>Port ${port}${port===currentPort?' · current':''}</option>`
      ).join('')}`
      : '<option value="">No available ports</option>';
    portSelect.disabled = available.length===0;
    help.textContent = available.length
      ? `${available.length} available port${available.length===1?'':'s'} on this box.`
      : 'This NAP box has no available ports.';
  };
  napSelect.addEventListener('change', updatePorts);
  updatePorts();
  activateDialog('backdrop');

  form.addEventListener('submit', async event=>{
    event.preventDefault();
    const napId = napSelect.value;
    const port = Number(portSelect.value);
    const error = clientPortError({napId, port}, client.id);
    if(error){ toast(error); return; }

    const selectedFiber = fiberSelect.value;
    const fiberColor = selectedFiber==='__custom__' ? customInput.value : selectedFiber;
    if(!fiberColor){ toast('Choose the fiber cable color for this connection'); return; }

    const saved = await commit(()=>{
      const target = DB.clients.find(c=>c.id===client.id);
      if(!target){ toast('Client not found'); return false; }
      const old = {...target};
      target.napId = napId;
      target.port = port;
      syncClientPort(target, old);
      const targetPort = DB.napPorts.find(p=>p.napId===napId && Number(p.port)===port);
      if(targetPort){ targetPort.fiberColor = fiberColor; }
    }, 'Could not connect this client. Please check your connection and try again.');
    if(!saved) return;
    closeModal();
    render();
    toast(`Connected to ${napId} · port ${port}`);
  });
}

/* ------------------------------ side effects ------------------------------ */
function syncClientPort(client, old){
  if(old && (old.napId!==client.napId || String(old.port)!==String(client.port))){
    const oldPort = DB.napPorts.find(p=>
      p.napId===old.napId && String(p.port)===String(old.port) && p.clientId===client.id
    );
    if(oldPort){ oldPort.clientId=''; oldPort.status='Free'; }
  }
  if(client.napId && client.port){
    let targetPort = DB.napPorts.find(p=>
      p.napId===client.napId && Number(p.port)===Number(client.port)
    );
    if(!targetPort){
      targetPort = {id:`NP-${client.napId}-${client.port}`, napId:client.napId,
        port:Number(client.port), clientId:'', status:'Free', notes:'', fiberColor:''};
      DB.napPorts.push(targetPort);
    }
    targetPort.clientId=client.id; targetPort.status='Used';
  }
}

function clientPortError(client, excludeClientId){
  if(!client.napId && !client.port) return '';
  if(!client.napId || !client.port) return 'Choose both a NAP box and port, or leave both empty';
  const box = DB.napBoxes.find(b=>b.id===client.napId);
  const port = Number(client.port);
  if(!box || !Number.isInteger(port) || port<1 || port>num(box.totalPorts)){
    return 'Choose a valid port on the selected NAP box';
  }
  const otherClient = DB.clients.find(c=>c.id!==excludeClientId && c.napId===client.napId && Number(c.port)===port);
  if(otherClient) return `Port ${port} is already assigned to ${otherClient.name}`;
  const portRecord = DB.napPorts.find(p=>p.napId===client.napId && Number(p.port)===port && p.clientId && p.clientId!==excludeClientId);
  if(portRecord){
    const owner = DB.clients.find(c=>c.id===portRecord.clientId);
    return `Port ${port} is already assigned${owner?` to ${owner.name}`:''}`;
  }
  const portStatus = DB.napPorts.find(p=>p.napId===client.napId && Number(p.port)===port);
  if(portStatus && portStatus.clientId!==excludeClientId && portStatus.status!=='Free'){
    return `Port ${port} is ${portStatus.status.toLowerCase()} and cannot be assigned`;
  }
  return '';
}

function ensurePorts(box){
  for(let i=1;i<=num(box.totalPorts);i++){
    if(!DB.napPorts.find(p=>p.napId===box.id && Number(p.port)===i)){
      DB.napPorts.push({id:`NP-${box.id}-${i}`, napId:box.id, port:i, clientId:'', status:'Free', notes:'', fiberColor:''});
    }
  }
  DB.napPorts = DB.napPorts.filter(p=>p.napId!==box.id || Number(p.port)<=num(box.totalPorts));
}

function generatedInvoiceDueDate(client, month){
  const match = String(month||'').match(/^(\d{4})-(\d{2})$/);
  if(!match) return null;
  const billingYear = Number(match[1]);
  const billingMonth = Number(match[2]);
  if(billingMonth<1 || billingMonth>12) return null;

  const installed = String(client.installed||'');
  const installationMatch = installed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const hasValidInstallationDate = installationMatch &&
    iso(new Date(`${installed}T00:00:00`))===installed;
  const invoiceDueDay = hasValidInstallationDate
    ? Number(installationMatch[3])
    : Number(DB.settings.dueDay)||5;
  const lastDayOfMonth = new Date(billingYear, billingMonth, 0).getDate();
  let dueDate = iso(new Date(
    billingYear, billingMonth-1, Math.min(invoiceDueDay, lastDayOfMonth)
  ));
  if(hasValidInstallationDate && dueDate<=installed){
    const dayAfterInstallation = new Date(`${installed}T00:00:00`);
    dayAfterInstallation.setDate(dayAfterInstallation.getDate()+1);
    dueDate = iso(dayAfterInstallation);
  }
  return dueDate;
}

function updateCurrentGeneratedInvoiceDueDates(){
  const month = ym(new Date());
  let updated = 0;
  (DB.billing||[]).forEach(invoice=>{
    if(invoice.month!==month || invoice.id!==`INV-${month}-${invoice.clientId}` ||
       invoice.recurringDueDay) return;
    const client = (DB.clients||[]).find(item=>item.id===invoice.clientId);
    if(!client) return;
    const dueDate = generatedInvoiceDueDate(client, month);
    if(dueDate && invoice.dueDate!==dueDate){
      invoice.dueDate = dueDate;
      updated++;
    }
  });
  return updated;
}

async function generateInvoices(month){
  if(!/^\d{4}-\d{2}$/.test(String(month||'')) ||
     !generatedInvoiceDueDate({}, month)){
    toast('Choose a valid billing month');
    return;
  }
  let added = 0;
  let updated = 0;
  const saved = await commit(()=>{
    DB.clients.filter(c=>c.status!=='Disconnected').forEach(c=>{
      const dueDate = generatedInvoiceDueDate(c, month);
      if(!dueDate) return;
      const invoiceId = `INV-${month}-${c.id}`;
      const existing = DB.billing.find(b=>b.clientId===c.id && b.month===month);
      if(existing){
        if(existing.id===invoiceId && !existing.recurringDueDay && existing.dueDate!==dueDate){
          existing.dueDate = dueDate;
          updated++;
        }
      }else{
        DB.billing.push({
          id:invoiceId, month, clientId:c.id,
          dueDate, amountDue:num(c.rate), remarks:''
        });
        added++;
      }
    });
    if(!added && !updated) return false;
  }, 'Could not save the generated invoices. Please check your connection and try again.');
  if(!saved && (added || updated)) return;
  toast(added || updated
    ? `Generated ${added} invoice(s)${updated?` · updated ${updated} due date(s)`:''}`
    : 'All invoices already exist');
  render();
}

async function deleteRecord(table, id){
  const record = DB[table] && DB[table].find(row=>String(row.id)===String(id));
  if(!record){
    toast('Record not found');
    return;
  }
  let details = '';
  if(table==='billing'){
    const linkedPayments = DB.payments.filter(payment=>NapboxBilling.paymentAppliesTo(payment, record));
    if(linkedPayments.length){
      await showDialog({
        title:'Invoice has payments',
        message:`${id} has ${linkedPayments.length} payment(s) recorded against it. Delete those payments first so the receipts stay consistent.`,
        alertOnly:true
      });
      return;
    }
  }
  if(table==='clients'){
    const invoices = DB.billing.filter(invoice=>invoice.clientId===id).length;
    const payments = DB.payments.filter(payment=>payment.clientId===id).length;
    if(invoices || payments){
      details = `Their ${invoices} invoice(s) and ${payments} payment(s) stay in the billing history.`;
    }
  }
  const confirmed = await confirmAction({
    title:`Delete ${id}?`,
    message:'This cannot be undone. Download a backup first if you might need it later.',
    details, confirmLabel:'Delete', danger:true
  });
  if(!confirmed) return;
  const saved = await commit(()=>{
    if(!DB[table].some(row=>String(row.id)===String(id))){ toast('Record not found'); return false; }
    if(table==='billing'){
      DB.billingExclusions = DB.billingExclusions || [];
      if(!DB.billingExclusions.some(row=>
        row.clientId===record.clientId && row.month===record.month)){
        DB.billingExclusions.push({clientId:record.clientId,month:record.month});
      }
    }
    DB[table] = DB[table].filter(row=>String(row.id)!==String(id));
    if(table==='clients'){
      DB.napPorts.forEach(port=>{
        if(port.clientId===id){ port.clientId=''; port.status='Free'; }
      });
    }
    if(table==='napBoxes'){
      DB.napPorts = DB.napPorts.filter(port=>port.napId!==id);
      DB.clients.forEach(client=>{
        if(client.napId===id){ client.napId=''; client.port=''; }
      });
      DB.napBoxes.forEach(box=>{ if(box.uplinkId===id) box.uplinkId=''; });
    }
  }, 'Could not delete. Please check your connection and try again.');
  if(!saved) return;
  render(); toast('Deleted');
}
