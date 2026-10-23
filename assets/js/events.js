/* =========================================================================
   EVENTS
   ========================================================================= */
window.addEventListener('storage', e=>{
  if(!DB) return;
  if(e.key===SERVER_VERSION_KEY){
    const version = Number(e.newValue);
    serverVersion = Number.isSafeInteger(version) && version>0 ? version : null;
    return;
  }
  if(e.key!==KEY || !e.newValue) return;
  try{
    const updated = JSON.parse(e.newValue);
    if(!updated || !Array.isArray(updated.clients) || !updated.settings){
      console.warn('Ignored an invalid cross-tab data update');
      return;
    }
    DB = normalizeState(updated);
    document.getElementById('subBrand').textContent = DB.settings.business;
    // Avoid wiping out a form the user is filling in; the page refreshes when it closes.
    if(!topmostDialog()) render();
  }catch(error){
    console.warn('Could not apply a cross-tab data update', error);
  }
});

document.addEventListener('click', async e=>{
  const tableScrollButton = e.target.closest('[data-table-scroll]');
  if(tableScrollButton){
    const controls = tableScrollButton.closest('.table-scroll-controls');
    const wrapper = controls && controls.previousElementSibling;
    if(wrapper && wrapper.classList.contains('tw')){
      wrapper.scrollBy({
        left:Number(tableScrollButton.dataset.tableScroll)*Math.max(160,wrapper.clientWidth*0.75),
        behavior:'smooth'
      });
    }
    return;
  }

  const menuToggle = e.target.closest('#btnMenu');
  if(menuToggle){
    if(menuToggle._suppressClick){
      menuToggle._suppressClick = false;
      clearTimeout(menuToggle._suppressClickTimer);
      return;
    }
    if(menuToggle.classList.contains('menu-docked')){
      menuToggle.classList.remove('menu-docked');
      menuToggle.setAttribute('aria-label','Open menu');
      menuToggle.title='Open menu';
      return;
    }
    const menu = document.getElementById('tabs');
    const isOpen = menu.classList.toggle('mobile-open');
    menuToggle.textContent = isOpen ? '×' : '☰';
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    menuToggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    return;
  }

  const mobileMenu = document.getElementById('tabs');
  if(e.target===mobileMenu && mobileMenu.classList.contains('mobile-open')){
    mobileMenu.classList.remove('mobile-open');
    const menuToggleButton = document.getElementById('btnMenu');
    menuToggleButton.textContent = '☰';
    menuToggleButton.setAttribute('aria-expanded','false');
    menuToggleButton.setAttribute('aria-label','Open menu');
    return;
  }

  if(e.target.closest('[data-mobile-logout]')){
    document.getElementById('btnLogout').click();
    return;
  }

  const removeTag = e.target.closest('[data-tag-remove]');
  if(removeTag){ removeTag.closest('[data-tag-value]').remove(); return; }

  const addTag = e.target.closest('[data-tag-add]');
  if(addTag){
    const input = document.querySelector(`[data-tag-input="${addTag.dataset.tagAdd}"]`);
    addEditorTag(input);
    input.focus();
    return;
  }

  const tabBtn = e.target.closest('[data-tab]');
  if(tabBtn){
    document.getElementById('tabs').classList.remove('mobile-open');
    const menuToggleButton = document.getElementById('btnMenu');
    menuToggleButton.textContent = '☰';
    menuToggleButton.setAttribute('aria-expanded','false');
    menuToggleButton.setAttribute('aria-label','Open menu');
    state.mapPlaceClient=false; state.mapPlaceNap=false; state.tab = tabBtn.dataset.tab; state.search=''; render(); return;
  }

  const napViewBtn = e.target.closest('[data-napview]');
  if(napViewBtn){
    state.mapPlaceClient = false;
    state.mapPlaceNap = false;
    state.napView = napViewBtn.dataset.napview;
    render();
    return;
  }

  const splitterBtn = e.target.closest('[data-act="viewSplitter"]');
  if(splitterBtn){
    state.napView = 'splitter';
    state.selectedNapId = splitterBtn.dataset.id;
    render();
    return;
  }

  const portCell = e.target.closest('[data-act="openPort"]');
  if(portCell){
    openPortModal(portCell.dataset.napid, Number(portCell.dataset.port));
    return;
  }

  const act = e.target.closest('[data-act]');
  if(!act) return;
  const a = act.dataset.act;

  if(a==='connectClient'){
    openClientPortModal(act.dataset.id);
    return;
  }
  if(a==='goNaps'){
    closeModal();
    state.tab = 'naps';
    state.search = '';
    render();
    return;
  }
  if(a==='continueHouse'){
    const clientId = document.getElementById('houseClientPicker').value;
    const coordinates = state.pendingClientHouse;
    state.pendingClientHouse = null;
    if(coordinates) openForm('clients', clientId, coordinates);
    return;
  }
  if(a==='newHouseClient'){
    const coordinates = state.pendingClientHouse;
    state.pendingClientHouse = null;
    if(coordinates) openForm('clients', null, coordinates);
    return;
  }
  if(a==='placeNapCenter'){
    if(!mapInstance){ toast('Map is not ready yet'); return; }
    state.mapPlaceNap = true;
    const pin = document.getElementById('mapCenterPin');
    const controls = document.getElementById('mapCenterConfirm');
    if(pin) pin.hidden = false;
    if(controls) controls.hidden = false;
    toast('Pan the map beneath the pin, then tap Place here');
    return;
  }
  if(a==='searchMap'){
    searchMapLocation();
    return;
  }
  if(a==='pasteNapCoordinates'){
    const input = document.getElementById('napCoordinatesInput');
    if(!navigator.clipboard?.readText){
      input?.focus();
      toast('Clipboard access unavailable. Paste coordinates into the field manually.');
      return;
    }
    try{
      const text = await navigator.clipboard.readText();
      if(!text.trim()){
        toast('Clipboard is empty');
        return;
      }
      input.value = text.trim();
      input.focus();
      toast('Coordinates pasted. Tap “Use pasted location” to continue.');
    }catch(error){
      console.error('Could not read coordinates from clipboard', error);
      input?.focus();
      toast('Could not read clipboard. Paste coordinates into the field manually.');
    }
    return;
  }
  if(a==='placeNapCoordinates'){
    const coordinates = parseCoordinates(document.getElementById('napCoordinatesInput')?.value);
    if(!coordinates){
      toast('Paste valid latitude, longitude coordinates (for example: 14.998828, 120.891659)');
      return;
    }
    state.mapPlaceNap = false;
    openForm('napBoxes', null, coordinates);
    return;
  }
  if(a==='cancelNapCenter'){
    state.mapPlaceNap = false;
    const pin = document.getElementById('mapCenterPin');
    const controls = document.getElementById('mapCenterConfirm');
    if(pin) pin.hidden = true;
    if(controls) controls.hidden = true;
    return;
  }
  if(a==='confirmNapCenter'){
    if(!mapInstance){ toast('Map is not ready yet'); return; }
    const center = mapInstance.getCenter();
    state.mapPlaceNap = false;
    const pin = document.getElementById('mapCenterPin');
    const controls = document.getElementById('mapCenterConfirm');
    if(pin) pin.hidden = true;
    if(controls) controls.hidden = true;
    openForm('napBoxes', null, {
      lat:Number(center.lat).toFixed(6),
      lng:Number(center.lng).toFixed(6)
    });

    return;
  }
  if(a==='placeNapBoxAtMap' || a==='placeClientAtMap'){
    const coordinates = state.mapContextLocation;
    const menu = document.getElementById('mapContextMenu');
    if(menu) menu.hidden = true;
    state.mapContextLocation = null;
    if(!coordinates) return;
    state.mapPlaceNap = false;
    if(a==='placeNapBoxAtMap') openForm('napBoxes', null, coordinates);
    else openClientHouseForm(coordinates.lat, coordinates.lng);
    return;
  }
  if(a==='deleteMapTarget'){
    const target = state.mapContextTarget;
    hideMapContextMenuGlobal();
    if(target && ['clients','napBoxes'].includes(target.table)){
      deleteRecord(target.table, target.id);
    }
    return;
  }
  if(a==='focusNapMap'){
    focusNapBoxOnMap(act.dataset.id);
    return;
  }
  if(a==='addClientHouse'){
    state.mapPlaceNap = false;
    state.mapPlaceClient = true;
    state.napView = 'map';
    render();
    toast('Tap the map to place the house');
    return;
  }
  if(a==='add'){ openForm(act.dataset.table); return; }
  if(a==='edit'){ openForm(act.dataset.table, act.dataset.id); return; }
  if(a==='payInvoice'){ openInvoicePayment(act.dataset.id); return; }
  if(a==='closeModal'){ closeModal(); return; }
  if(a==='closeReceipt'){ closeReceipt(); return; }
  if(a==='generate'){ generateInvoices(state.month); return; }
  if(a==='receipt'){ openReceipt(act.dataset.id); return; }

  if(a==='del'){
    deleteRecord(act.dataset.table, act.dataset.id);
    return;
  }

  if(a==='saveSettings'){
    const plans = readEditorTags('plans');
    const methods = readEditorTags('methods');
    if(!plans.length || !methods.length){ toast('Add at least one plan and payment method'); return; }
    const dueDay = Number(document.getElementById('setDueDay').value);
    if(!Number.isInteger(dueDay) || dueDay<1 || dueDay>28){ toast('Default due day must be from 1 to 28'); return; }
    const settings = {
      business: document.getElementById('setBusiness').value.trim() || 'My ISP',
      tagline: document.getElementById('setTagline').value.trim(),
      address: document.getElementById('setAddress').value.trim(),
      contact: document.getElementById('setContact').value.trim(),
      tin: document.getElementById('setTin').value.trim(),
      plans, methods, dueDay
    };
    if(!await commit(()=>{ Object.assign(DB.settings, settings); })) return;
    document.getElementById('subBrand').textContent = DB.settings.business;
    toast('Settings saved'); render();
    return;
  }
  if(a==='enablePushNotifications'){
    await enablePushNotifications();
    return;
  }
  if(a==='testBrowserNotification'){
    await testBrowserNotification();
    return;
  }
  if(a==='disablePushNotifications'){
    await disablePushNotifications();
    return;
  }

  if(a==='saveHome'){
    const latText = document.getElementById('setHomeLat').value.trim();
    const lngText = document.getElementById('setHomeLng').value.trim();
    const lat = Number(latText), lng = Number(lngText);
    if(!latText || !lngText || !Number.isFinite(lat) || !Number.isFinite(lng) ||
       lat<-90 || lat>90 || lng<-180 || lng>180){
      toast('Enter a valid latitude (-90 to 90) and longitude (-180 to 180)');
      return;
    }
    const name = document.getElementById('setHomeName').value.trim() || 'Home Base / OLT';
    if(!await commit(()=>{ DB.settings.homeBase = {...DB.settings.homeBase, name, lat, lng}; })) return;
    toast('Home Base saved'); render();
    return;
  }

  if(a==='wipe'){
    const confirmed = await confirmAction({
      title:'Erase ALL data?',
      message:'Every client, invoice, payment, NAP box, ticket and inventory item will be deleted for all devices. A backup will be downloaded first.',
      confirmLabel:'Download backup and erase', danger:true
    });
    if(!confirmed) return;
    const reallySure = await confirmAction({
      title:'Are you absolutely sure?',
      message:'This cannot be undone except by restoring the backup file.',
      confirmLabel:'Erase everything', danger:true
    });
    if(!reallySure) return;
    doBackup('isp-backup-before-erase');
    if(!await commit(()=>{ DB = emptyState(); })) return;
    document.getElementById('subBrand').textContent = DB.settings.business;
    render(); toast('All data erased');
    return;
  }
});

const floatingMenuButton = document.getElementById('btnMenu');
let menuHoldTimer = null;
let menuHoldTriggered = false;
floatingMenuButton.addEventListener('pointerdown', event=>{
  if(event.pointerType==='mouse' && event.button!==0) return;
  clearTimeout(menuHoldTimer);
  menuHoldTriggered = false;
  menuHoldTimer = setTimeout(()=>{
    if(floatingMenuButton.getAttribute('aria-expanded')==='true') return;
    menuHoldTriggered = true;
    floatingMenuButton.classList.toggle('menu-docked');
    const docked = floatingMenuButton.classList.contains('menu-docked');
    floatingMenuButton.setAttribute('aria-label',docked?'Show menu button':'Open menu');
    floatingMenuButton.title = docked ? 'Tap to show menu button' : 'Open menu';
  },550);
});
const finishMenuHold = ()=>{
  clearTimeout(menuHoldTimer);
  menuHoldTimer = null;
  if(menuHoldTriggered){
    floatingMenuButton._suppressClick = true;
    clearTimeout(floatingMenuButton._suppressClickTimer);
    floatingMenuButton._suppressClickTimer = setTimeout(()=>{
      floatingMenuButton._suppressClick = false;
    },300);
    menuHoldTriggered = false;
  }
};
floatingMenuButton.addEventListener('pointerup',finishMenuHold);
floatingMenuButton.addEventListener('pointercancel',finishMenuHold);
floatingMenuButton.addEventListener('pointerleave',finishMenuHold);

document.addEventListener('change', e=>{
  if(e.target.id==='monthPick'){ state.month = e.target.value; render(); }
  if(e.target.id==='napPicker'){ state.selectedNapId = e.target.value; render(); }
  if(e.target.name==='plan' && e.target.form?.id==='modalForm'){
    const customSpeedField = e.target.form.querySelector('[data-custom-speed-field]');
    if(customSpeedField){
      const isCustom = e.target.value==='__custom_plan__';
      const speedInput = customSpeedField.querySelector('input');
      speedInput.required = isCustom;
      if(isCustom) speedInput.focus({preventScroll:false});
    }
  }
  if(e.target.name==='plan' && e.target.form?.id==='modalForm'){
    const rate = e.target.form.elements.namedItem('rate');
    const standardRate = standardPlanRate(e.target.value);
    if(rate && standardRate!==null) rate.value = standardRate;
  }
  if(e.target.name==='rate' && e.target.form?.id==='modalForm'){
    const matchingPlan = planForRate(Number(e.target.value));
    if(matchingPlan!=='Unspecified'){
      const plan = [...e.target.form.querySelectorAll('input[name="plan"]')]
        .find(option=>option.value===matchingPlan);
      if(plan) plan.checked = true;
    }
  }
});

let searchRenderTimer = null;
document.addEventListener('input', e=>{
  if(e.target.id==='searchBox'){
    state.search = e.target.value;
    clearTimeout(searchRenderTimer);
    searchRenderTimer = setTimeout(()=>{
      const current = document.getElementById('searchBox');
      const pos = current ? current.selectionStart : state.search.length;
      const hadFocus = document.activeElement===current;
      render();
      const box = document.getElementById('searchBox');
      if(box && hadFocus){ box.focus(); box.setSelectionRange(pos,pos); }
    }, 200);
  }
});

document.getElementById('backdrop').addEventListener('click', e=>{
  if(e.target.id==='backdrop') closeModal();
});
document.getElementById('receiptBackdrop').addEventListener('click', e=>{
  if(e.target.id==='receiptBackdrop') closeReceipt();
});
document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){
    const menu = document.getElementById('tabs');
    if(menu.classList.contains('mobile-open')){
      menu.classList.remove('mobile-open');
      const menuToggleButton = document.getElementById('btnMenu');
      menuToggleButton.textContent = '☰';
      menuToggleButton.setAttribute('aria-expanded','false');
      menuToggleButton.setAttribute('aria-label','Open menu');
    }
  }
  if(e.key==='Enter' && e.target.id==='mapSearchInput'){
    e.preventDefault();
    searchMapLocation();
    return;
  }
  if(e.key==='Enter' && e.target.matches('[data-tag-input]')){
    e.preventDefault();
    addEditorTag(e.target);
    return;
  }
  if(e.key==='Escape'){
    const top = topmostDialog();
    if(top?.id==='dialogBackdrop') closeDialog(false);
    else if(top?.id==='receiptBackdrop') closeReceipt();
    else if(top?.id==='backdrop') closeModal();
  }
});
document.addEventListener('keydown', trapDialogFocus);

document.getElementById('dialogBackdrop').addEventListener('click', e=>{
  const button = e.target.closest('[data-dialog-result]');
  if(button) closeDialog(button.dataset.dialogResult==='ok');
  else if(e.target.id==='dialogBackdrop') closeDialog(false);
});

document.getElementById('btnPrintRcpt').onclick = ()=>window.print();
document.getElementById('btnCopyRcpt').onclick = copyReceiptText;
document.getElementById('btnShareRcpt').onclick = shareReceipt;

/* ------------------------------ backup / restore ------------------------------ */
function download(filename, text, type='application/json'){
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

function doBackup(prefix='isp-backup'){
  const stamp = new Date().toISOString().slice(0,19).replace(/[T:]/g,'-');
  download(`${prefix}-${stamp}.json`, JSON.stringify(DB, null, 2));
  toast('Backup downloaded');
}

function toCSV(rows, cols){
  const cell = NapboxBilling.csvCell;
  const head = cols.map(c=>cell(c.label)).join(',');
  const body = rows.map(r=>cols.map(c=>cell(r[c.key])).join(',')).join('\r\n');
  return '\ufeff' + head + '\r\n' + body;
}

document.getElementById('btnBackup').onclick = ()=>doBackup();
document.getElementById('btnRestore').onclick = ()=>document.getElementById('fileInput').click();
document.getElementById('btnLogout').onclick = async ()=>{
  try{
    const response = await fetch('/api/logout', {method:'POST'});
    if(!response.ok) throw new Error(`Sign out failed (${response.status})`);
    window.location.replace('/login');
  }catch(error){
    console.error(error);
    toast('Could not sign out. Please try again.');
  }
};

document.addEventListener('click', e=>{
  if(e.target.id==='btnBackup2') doBackup();
  if(e.target.id==='btnRestore2') document.getElementById('fileInput').click();
  if(e.target.id==='btnCsv'){
    const csv = toCSV(DB.clients, [
      {label:'Client ID', key:'id'},
      {label:'Full Name', key:'name'},
      {label:'Address/Barangay', key:'barangay'},
      {label:'City', key:'city'},
      {label:'Province', key:'province'},
      {label:'Contact', key:'contact'},
      {label:'Plan', key:'plan'},
      {label:'Monthly Rate', key:'rate'},
      {label:'Installation Date', key:'installed'},
      {label:'NAP Box', key:'napId'},
      {label:'NAP Port', key:'port'},
      {label:'ONU Serial', key:'onu'},
      {label:'MAC', key:'mac'},
      {label:'PPPoE', key:'pppoe'},
      {label:'Status', key:'status'},
      {label:'Notes', key:'notes'},
    ]);
    download(`clients-${todayISO()}.csv`, csv, 'text/csv;charset=utf-8');
    toast('CSV exported');
  }
});

document.getElementById('fileInput').addEventListener('change', e=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async ev=>{
    let data;
    try{
      data = JSON.parse(ev.target.result);
    }catch(err){
      await showDialog({title:'Could not read that file', message:'Make sure it is a valid ISP Manager backup (.json).', alertOnly:true});
      return;
    }
    const error = backupError(data);
    if(error){
      await showDialog({title:'This backup cannot be restored', message:error, alertOnly:true});
      return;
    }
    const confirmed = await confirmAction({
      title:'Replace all current data with this backup?',
      message:`The backup has ${data.clients.length} client(s), ${(data.billing||[]).length} invoice(s) and ${(data.payments||[]).length} payment(s). A backup of your current data will be downloaded first.`,
      confirmLabel:'Download current data and restore', danger:true
    });
    if(!confirmed) return;
    doBackup('isp-backup-before-restore');
    const saved = await commit(()=>{
      DB = normalizeState(data);
      applyMigrations();
    }, 'Could not save the restored data. Your previous data was kept.');
    if(!saved) return;
    document.getElementById('subBrand').textContent = DB.settings.business;
    render();
    toast('Backup restored');
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ------------------------------ go ------------------------------ */
init();
