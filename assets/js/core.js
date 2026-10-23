/* =========================================================================
   ISP MANAGER — dark mode + upgraded physical NAP box visualizer + receipts
   ========================================================================= */

const KEY = 'isp-manager-v3';
const TABS = [
  {id:'dashboard', label:'Dashboard',  icon:'📊'},
  {id:'clients',   label:'Clients',    icon:'👥'},
  {id:'billing',   label:'Billing',    icon:'🧾'},
  {id:'payments',  label:'Payments',   icon:'💵'},
  {id:'naps',      label:'NAP Boxes',  icon:'🔌'},
  {id:'complaints',label:'Complaints', icon:'🛠'},
  {id:'installs',  label:'Installs',   icon:'📥'},
  {id:'inventory', label:'Inventory',  icon:'📦'},
  {id:'settings',  label:'Settings',   icon:'⚙️'},
];

let DB = null;
let mapInstance = null;
let mapEngine = null;
let mapboxAccessToken = null;
let leafletMapOverlays = null;
let mapMarkers = {};
let mapLines = [];
let mapLineEvents = [];
let mapHoverPopup = null;
let mapInitToken = 0;
let mapViewport = null;
const state = {
  tab:'dashboard',
  month:null,
  search:'',
  napView:'grid',
  map3d:false,
  selectedNapId:null,
  mapPlaceNap:false,
  mapPlaceClient:false,
  mapContextLocation:null,
  mapContextTarget:null,
  mapFocus:null,
  pendingClientHouse:null,
  currentReceiptId:null,
};

const NAPBOX_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" role="img" aria-label="NAP box">
  <rect x="110" y="180" width="40" height="30" rx="15" fill="#3A4656"/>
  <rect x="110" y="290" width="40" height="30" rx="15" fill="#3A4656"/>
  <rect x="350" y="180" width="40" height="30" rx="15" fill="#3A4656"/>
  <rect x="350" y="290" width="40" height="30" rx="15" fill="#3A4656"/>
  <circle cx="130" cy="195" r="8" fill="#1D2430"/>
  <circle cx="130" cy="305" r="8" fill="#1D2430"/>
  <circle cx="370" cy="195" r="8" fill="#1D2430"/>
  <circle cx="370" cy="305" r="8" fill="#1D2430"/>
  <rect x="230" y="120" width="40" height="30" fill="#3A4656"/>
  <rect x="220" y="105" width="60" height="30" rx="8" fill="#4B5B6E"/>
  <rect x="195" y="340" width="30" height="25" fill="#3A4656"/>
  <rect x="185" y="355" width="50" height="35" rx="8" fill="#4B5B6E"/>
  <rect x="275" y="340" width="30" height="25" fill="#3A4656"/>
  <rect x="265" y="355" width="50" height="35" rx="8" fill="#4B5B6E"/>
  <rect x="150" y="150" width="200" height="200" rx="20" fill="#3A4656"/>
  <path d="M155 330V180q0-25 25-25h140q20 0 20 20v155q0 10-10 10H165q-10 0-10-10Z" fill="#2C3645"/>
  <rect x="210" y="175" width="80" height="20" rx="10" fill="#2C3645"/>
</svg>`;

function napBoxMarkerMarkup(id){
  return `<div class="napbox-map-marker"><span class="napbox-map-icon">${NAPBOX_ICON_SVG}</span><span class="napbox-map-label">${esc(id)}</span></div>`;
}

function hasMapCoordinates(point){
  if(point.lat==='' || point.lat==null || point.lng==='' || point.lng==null) return false;
  const lat = Number(point.lat), lng = Number(point.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat>=-90 && lat<=90 && lng>=-180 && lng<=180;
}

function getDistanceStr(lat1, lng1, lat2, lng2){
  const toRadians = degrees=>Number(degrees)*Math.PI/180;
  const dLat = toRadians(lat2)-toRadians(lat1);
  const dLng = toRadians(lng2)-toRadians(lng1);
  const a = Math.sin(dLat/2)**2 +
    Math.cos(toRadians(lat1))*Math.cos(toRadians(lat2))*Math.sin(dLng/2)**2;
  const distanceMeters = 2*6371000*Math.asin(Math.sqrt(Math.min(1,a)));
  return distanceMeters>=1000
    ? `${(distanceMeters/1000).toFixed(2)} km`
    : `${Math.round(distanceMeters)} m`;
}

function parseCoordinates(value){
  const match = String(value||'').trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if(!match) return null;
  const lat = Number(match[1]), lng = Number(match[2]);
  if(!Number.isFinite(lat) || !Number.isFinite(lng) ||
     lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {lat:lat.toFixed(6), lng:lng.toFixed(6)};
}

function normalizeSplitterChoice(value, totalPorts){
  const legacyChoices = {'1:8':'8','1:16':'16','2:32':'2:16'};
  const choice = legacyChoices[String(value)] || String(value||'');
  if(['8','16','2:8','2:16'].includes(choice)) return choice;
  return Number(totalPorts)>=32 ? '2:16' :
    Number(totalPorts)>=16 ? '16' : '8';
}

function splitterPortCount(choice){
  return ({'8':8,'16':16,'2:8':16,'2:16':32})[choice] || 0;
}

/* ------------------------------ helpers ------------------------------ */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const FIBER_COLORS = [
  ['#0072bc','Blue'],
  ['#f58220','Orange'],
  ['#2e8b57','Green'],
  ['#8b5a2b','Brown'],
  ['#7b8190','Slate'],
  ['#f5f5f5','White'],
  ['#e53935','Red'],
  ['#111827','Black'],
  ['#f4c430','Yellow'],
  ['#7c3aed','Violet'],
  ['#f472b6','Rose'],
  ['#14b8a6','Aqua']
];
const FIBER_COLOR_MAP = Object.fromEntries(FIBER_COLORS.map(([hex,name])=>[hex.toLowerCase(),name]));
const fiberColorName = value => FIBER_COLOR_MAP[String(value||'').toLowerCase()] || (value ? 'Custom' : 'Not recorded');
const fiberColorOptions = (current='') => {
  const normalized = String(current||'').toLowerCase();
  return `<option value="">— Not recorded —</option>${FIBER_COLORS.map(([hex,name])=>
    `<option value="${hex}" ${normalized===hex?'selected':''}>${name}</option>`
  ).join('')}<option value="__custom__" ${normalized && !FIBER_COLOR_MAP[normalized]?'selected':''}>Custom color</option>`;
};
const fiberColorHex = value => /^#[0-9a-f]{6}$/i.test(String(value||'')) ? String(value) : '#94a3b8';
const escStyleHex = value => fiberColorHex(value).replace(/[^#0-9a-f]/gi,'');
const peso = n => '₱' + Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2, maximumFractionDigits:2});
const num  = n => Number(n||0);
const pad  = n => String(n).padStart(2,'0');
const iso  = d => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`; };
const ym   = d => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth()+1)}`; };
const todayISO = () => iso(new Date());
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const monthLabel = m => {
  if(!m) return '—';
  const [y,mo] = m.split('-');
  return new Date(y, mo-1, 1).toLocaleDateString('en-PH',{month:'long', year:'numeric'});
};
function dateLabel(value){
  const match = String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match) return value || '—';
  const [year,month,day] = match.slice(1).map(Number);
  const date = new Date(year,month-1,day);
  if(date.getFullYear()!==year || date.getMonth()!==month-1 || date.getDate()!==day) return value;
  return date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}
const daysAgo = (a,b) => Math.floor((new Date(b) - new Date(a)) / 86400000);
function isAtLeastMonthsOverdue(dueDate, months, referenceDate=todayISO()){
  const match = String(dueDate||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match || !Number.isInteger(months) || months<0) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const due = new Date(year, month-1, day);
  if(iso(due)!==dueDate) return false;
  due.setDate(1);
  due.setMonth(due.getMonth()+months);
  due.setDate(Math.min(day, new Date(due.getFullYear(), due.getMonth()+1, 0).getDate()));
  return iso(due)<=referenceDate;
}
const uid = () => Math.random().toString(36).slice(2,9);
const PLAN_LABELS = {
  '10mbps':'10 Mbps', '15mbps':'30 Mbps', '20mbps':'20 Mbps',
  '25mbps':'25 Mbps', '30mbps':'30 Mbps', '50mbps':'50 Mbps'
};

function planKey(plan){
  return String(plan||'').toLowerCase().replace(/\s+/g,'');
}

function normalizePlanLabel(plan){
  return PLAN_LABELS[planKey(plan)] || plan;
}

function pushErrorMessage(response, data){
  return data?.error || `Notification request failed (${response.status})`;
}

async function notificationRequest(url, options={}){
  const response = await fetch(url, {
    ...options,
    headers:{'Content-Type':'application/json',...(options.headers||{})}
  });
  const data = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(pushErrorMessage(response,data));
  return data;
}

function pushButtonState(enabled){
  const enable = document.querySelector('[data-act="enablePushNotifications"]');
  const disable = document.querySelector('[data-act="disablePushNotifications"]');
  if(enable) enable.hidden = enabled;
  if(disable) disable.hidden = !enabled;
}

async function updatePushNotificationStatus(){
  const status = document.getElementById('pushNotificationStatus');
  if(!status) return;
  try{
    const config = await notificationRequest('/api/notifications/config');
    if(!config.enabled){
      status.textContent = 'Notifications are not configured on the server yet. Ask the administrator to add VAPID keys.';
      pushButtonState(false);
      return;
    }
    if(!('Notification' in window) || !('serviceWorker' in navigator)){
      status.textContent = 'This browser does not support web push notifications.';
      pushButtonState(false);
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = registration && await registration.pushManager.getSubscription();
    const active = Notification.permission==='granted' && Boolean(subscription);
    status.textContent = active
      ? 'Daily notifications are enabled on this device.'
      : Notification.permission==='denied'
        ? 'Notifications are blocked by this browser. Allow them in site settings to enable reminders.'
        : 'Notifications are currently off on this device.';
    pushButtonState(active);
  }catch(error){
    console.error('Could not check notification status',error);
    status.textContent = `Could not check notification status: ${error.message}`;
  }
}

function decodeVapidKey(value){
  const padding='='.repeat((4-value.length%4)%4);
  const base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(base64),character=>character.charCodeAt(0));
}

async function enablePushNotifications(){
  try{
    if(!window.isSecureContext){
      throw new Error('Notifications require HTTPS (or localhost).');
    }
    if(!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)){
      throw new Error('This browser does not support web push notifications.');
    }
    const config=await notificationRequest('/api/notifications/config');
    if(!config.enabled || !config.publicKey){
      throw new Error('Notifications are not configured on the server yet. Ask the administrator to add VAPID keys.');
    }
    const permission=await Notification.requestPermission();
    if(permission!=='granted') throw new Error('Browser notification permission was not granted.');
    const registration=await navigator.serviceWorker.register('/service-worker.js',{scope:'/'});
    const ready=await navigator.serviceWorker.ready;
    let subscription=await ready.pushManager.getSubscription();
    if(!subscription){
      subscription=await registration.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:decodeVapidKey(config.publicKey)
      });
    }
    await notificationRequest('/api/notifications/subscribe',{
      method:'POST',
      body:JSON.stringify(subscription)
    });
    toast('Daily overdue notifications enabled on this device');
    await updatePushNotificationStatus();
  }catch(error){
    console.error('Could not enable notifications',error);
    toast(error.message);
  }
}

async function testBrowserNotification(){
  try{
    if(!('Notification' in window)){
      throw new Error('This browser does not support notifications.');
    }
    if(!window.isSecureContext){
      throw new Error('Notifications require HTTPS (or localhost).');
    }
    let permission=Notification.permission;
    if(permission==='default') permission=await Notification.requestPermission();
    if(permission!=='granted'){
      throw new Error('Notification permission is blocked. Allow notifications for this site in your browser settings.');
    }
    const notification=new Notification('NAPBOX notification test',{
      body:'Notifications are working on this device. Click here to return to NAPBOX.',
      tag:'napbox-notification-test'
    });
    notification.onclick=()=>{
      window.focus();
      notification.close();
    };
    toast('Test notification sent');
  }catch(error){
    console.error('Could not show test notification',error);
    toast(error.message);
  }
}

async function disablePushNotifications(){
  try{
    const registration=await navigator.serviceWorker.getRegistration('/');
    const subscription=registration && await registration.pushManager.getSubscription();
    if(subscription){
      await notificationRequest('/api/notifications/subscribe',{
        method:'DELETE',
        body:JSON.stringify({endpoint:subscription.endpoint})
      });
      await subscription.unsubscribe();
    }
    toast('Daily notifications turned off on this device');
    await updatePushNotificationStatus();
  }catch(error){
    console.error('Could not disable notifications',error);
    toast(error.message);
  }
}

function migratePlanPricing(){
  let changed = false;
  const plans = DB.settings.plans || [];
  DB.settings.plans = [...new Set(plans.map(normalizePlanLabel))];
  if(JSON.stringify(plans)!==JSON.stringify(DB.settings.plans)) changed = true;

  (DB.clients||[]).forEach(client=>{
    const label = normalizePlanLabel(client.plan);
    if(label!==client.plan){ client.plan = label; changed = true; }
  });
  (DB.installs||[]).forEach(install=>{
    const label = normalizePlanLabel(install.plan);
    if(label!==install.plan){ install.plan = label; changed = true; }
  });
  return changed;
}

function standardPlanRate(plan){
  const key = planKey(plan);
  if(key==='25mbps') return 800;
  if(key==='50mbps') return 1000;
  return null;
}

function planForRate(rate){
  if(rate===800) return '25 Mbps';
  if(rate===1000) return '50 Mbps';
  return 'Unspecified';
}

function addDefaultPricingPlans(){
  if(DB.settings.pricingDefaultsVersion===1) return false;
  if(!DB.settings.plans.some(plan=>planKey(plan)==='25mbps')){
    DB.settings.plans.push('25 Mbps');
  }
  DB.settings.pricingDefaultsVersion = 1;
  return true;
}

function correctLegacy600Pricing(){
  if(DB.settings.legacyPricingCorrectionVersion===1) return false;
  (DB.clients||[]).forEach(client=>{
    if(num(client.rate)===600){
      client.rate = 800;
      client.plan = '25 Mbps';
    }
  });
  (DB.billing||[]).forEach(invoice=>{
    if(num(invoice.amountDue)===600) invoice.amountDue = 800;
  });
  DB.settings.legacyPricingCorrectionVersion = 1;
  return true;
}

function nextId(prefix, arr){
  let max = 0;
  arr.forEach(r=>{
    const m = String(r.id||'').match(/(\d+)\s*$/);
    if(m) max = Math.max(max, +m[1]);
  });
  return `${prefix}-${String(max+1).padStart(4,'0')}`;
}

function nextReceiptNo(){
  const y = new Date().getFullYear();
  const prefix = `RCP-${y}-`;
  let max = 0;
  (DB.payments||[]).forEach(p=>{
    if(p.receiptNo && p.receiptNo.startsWith(prefix)){
      const n = parseInt(p.receiptNo.slice(prefix.length), 10) || 0;
      max = Math.max(max, n);
    }
  });
  return prefix + String(max+1).padStart(4,'0');
}

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(()=>t.classList.remove('show'), 2200);
}

/* ------------------------------ storage ------------------------------ */
const DATABASE_NAME = 'isp-manager-database';
const DATABASE_STORE = 'records';
const PENDING_SAVE_KEY = `${KEY}-pending-save`;
const SERVER_VERSION_KEY = `${KEY}-server-version`;
const UNSAVED_COPY_KEY = `${KEY}-unsaved-copy`;
let databasePromise = null;
let saveRevision = 0;
let saveQueue = Promise.resolve();
// Server version the current DB is based on; sent with every save so stale writes are rejected.
let serverVersion = null;
// Bumped when a conflict replaces DB, so saves queued from the stale data are dropped.
let saveEpoch = 0;

const clone = value => JSON.parse(JSON.stringify(value));

function canonicalJSON(value){
  if(Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if(value && typeof value==='object'){
    return `{${Object.keys(value).sort().filter(key=>value[key]!==undefined)
      .map(key=>`${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function setSaveStatus(message, status='saved'){
  const el = document.getElementById('saveStatus');
  if(!el) return;
  el.textContent = message;
  el.dataset.state = status;
}

function setServerVersion(version){
  serverVersion = Number.isSafeInteger(version) ? version : null;
  try{
    if(serverVersion===null) localStorage.removeItem(SERVER_VERSION_KEY);
    else localStorage.setItem(SERVER_VERSION_KEY, String(serverVersion));
  }catch(error){ console.warn('Could not store the server version', error); }
}

function readStoredServerVersion(){
  try{
    const version = Number(localStorage.getItem(SERVER_VERSION_KEY));
    return Number.isSafeInteger(version) && version>0 ? version : null;
  }catch(error){ return null; }
}

function setPendingMarker(baseVersion){
  try{ localStorage.setItem(PENDING_SAVE_KEY, JSON.stringify({baseVersion})); }
  catch(error){ console.warn('Could not mark local changes as pending', error); }
}

function clearPendingMarker(){
  try{ localStorage.removeItem(PENDING_SAVE_KEY); }
  catch(error){ console.warn('Could not clear local pending-save marker', error); }
}

// Returns null (nothing pending), or {baseVersion}; legacy '1' markers have an unknown base.
function readPendingMarker(){
  try{
    const raw = localStorage.getItem(PENDING_SAVE_KEY);
    if(!raw) return null;
    if(raw==='1') return {baseVersion:undefined};
    const marker = JSON.parse(raw);
    return {baseVersion:Number.isSafeInteger(marker?.baseVersion) ? marker.baseVersion : null};
  }catch(error){ return {baseVersion:undefined}; }
}

function readLocalSnapshot(){
  try{
    const raw = localStorage.getItem(KEY) || localStorage.getItem('isp-manager-v2');
    return raw ? JSON.parse(raw) : null;
  }catch(error){
    console.warn('Local copy could not be read', error);
    return null;
  }
}

function stashUnsavedCopy(snapshot){
  try{
    localStorage.setItem(UNSAVED_COPY_KEY, JSON.stringify({savedAt:new Date().toISOString(), state:snapshot}));
    return true;
  }catch(error){
    console.warn('Could not keep a copy of the unsaved changes', error);
    return false;
  }
}

function downloadUnsavedCopy(){
  try{
    const raw = localStorage.getItem(UNSAVED_COPY_KEY);
    if(!raw){ toast('No unsaved copy found'); return; }
    const {savedAt, state:snapshot} = JSON.parse(raw);
    download(`isp-unsaved-copy-${String(savedAt||todayISO()).slice(0,10)}.json`, JSON.stringify(snapshot, null, 2));
  }catch(error){
    console.error(error);
    toast('Could not read the unsaved copy');
  }
}

function openDatabase(){
  if(!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable'));
  if(!databasePromise){
    databasePromise = new Promise((resolve,reject)=>{
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = ()=>{
        if(!request.result.objectStoreNames.contains(DATABASE_STORE)){
          request.result.createObjectStore(DATABASE_STORE);
        }
      };
      request.onsuccess = ()=>resolve(request.result);
      request.onerror = ()=>reject(request.error || new Error('Could not open database'));
    }).catch(error=>{
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

function writeLocalCopies(snapshot){
  let localSaved = false;
  try{
    localStorage.setItem(KEY, JSON.stringify(snapshot));
    localSaved = true;
  }catch(error){ console.warn('Local backup could not be updated', error); }
  openDatabase().then(database=>new Promise((resolve,reject)=>{
    const transaction = database.transaction(DATABASE_STORE, 'readwrite');
    transaction.objectStore(DATABASE_STORE).put(snapshot, 'current');
    transaction.oncomplete = resolve;
    transaction.onerror = ()=>reject(transaction.error || new Error('Database write failed'));
    transaction.onabort = ()=>reject(transaction.error || new Error('Database write aborted'));
  })).catch(error=>console.warn('Local database backup failed', error));
  return localSaved;
}

/*
 * Persists DB. Resolves to:
 *   'saved'    ? stored in PostgreSQL
 *   'local'    ? server unreachable, kept on this device and retried on the next save/reload
 *   'conflict' ? another device saved first; DB was replaced with the server's data
 *   'failed'   ? nothing could be stored
 */
function save(){
  NapboxBilling.synchronizeInvoices(DB, todayISO());
  const revision = ++saveRevision;
  const epoch = saveEpoch;
  const snapshot = clone(DB);
  const localSaved = writeLocalCopies(snapshot);
  if(localSaved && !readPendingMarker()) setPendingMarker(serverVersion);
  setSaveStatus('Saving…', 'saving');

  const offline = ()=>{
    if(revision===saveRevision){
      setSaveStatus(localSaved ? 'Server unavailable · saved on this device' : 'Save failed', localSaved ? 'warning' : 'error');
    }
    return localSaved ? 'local' : 'failed';
  };

  saveQueue = saveQueue.catch(()=>{}).then(async ()=>{
    if(epoch!==saveEpoch) return 'conflict';
    let response;
    try{
      response = await fetch('/api/state',{
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({state:snapshot, baseVersion:serverVersion})
      });
    }catch(error){
      console.warn('PostgreSQL save failed', error);
      return offline();
    }
    if(response.status===401){
      window.location.replace('/login');
      return offline();
    }
    if(response.status===409){
      const payload = await response.json().catch(()=>({}));
      return handleSaveConflict(snapshot, payload);
    }
    if(!response.ok){
      console.warn(`PostgreSQL save failed (${response.status})`);
      return offline();
    }
    const payload = await response.json().catch(()=>({}));
    setServerVersion(Number(payload.version));
    if(revision===saveRevision){
      clearPendingMarker();
      setSaveStatus('Saved to PostgreSQL');
    }else{
      setPendingMarker(serverVersion);
    }
    return 'saved';
  });
  return saveQueue;
}

function handleSaveConflict(rejectedSnapshot, payload){
  if(!payload.state){
    // The server has no data (e.g. it was reset). Queued saves continue and the next one
    // creates the first version; schedule one in case nothing else is queued.
    setServerVersion(null);
    setTimeout(save, 0);
    return 'local';
  }
  saveEpoch++;
  // DB is a superset of rejectedSnapshot: it also holds edits whose queued saves are now dropped.
  stashUnsavedCopy(clone(DB));
  DB = normalizeState(payload.state);
  applyMigrations();
  setServerVersion(Number(payload.version));
  writeLocalCopies(clone(DB));
  clearPendingMarker();
  setSaveStatus('Loaded the latest data from PostgreSQL');
  closeModal();
  document.getElementById('subBrand').textContent = DB.settings.business;
  render();
  showConflictNotice();
  return 'conflict';
}

function showConflictNotice(){
  showDialog({
    title:'Data was changed on another device',
    message:'The latest data has been loaded. Your most recent change was not saved — please check it and enter it again. A copy of your unsaved data has been kept on this device.',
    confirmLabel:'OK',
    cancelLabel:'Download unsaved copy'
  }).then(ok=>{ if(!ok) downloadUnsavedCopy(); });
}

/*
 * Saves after mutate() runs. On a failed save DB is rolled back; on a conflict DB has
 * already been replaced with the server copy. Returns true if the change was kept.
 */
async function commit(mutate, failureMessage='Could not save. Check your connection and try again.'){
  const previous = clone(DB);
  if(mutate && mutate()===false) return false;
  const pending = save();
  const revision = saveRevision;
  const outcome = await pending;
  if(outcome==='saved' || outcome==='local') return true;
  if(outcome==='failed'){
    // A newer save already includes this change; rolling back would also erase that newer edit.
    // Keep it in memory and let the newer save (and the status bar) report the result.
    if(revision!==saveRevision) return true;
    DB = previous;
    toast(failureMessage);
    render();
  }
  return false;
}

async function fetchServerState(){
  const response = await fetch('/api/state', {cache:'no-store'});
  if(response.status===401){
    window.location.replace('/login');
    return {redirecting:true};
  }
  if(!response.ok) throw new Error(`PostgreSQL load failed (${response.status})`);
  const payload = await response.json();
  return {state:payload.state || null, version:Number.isSafeInteger(payload.version) ? payload.version : null};
}

async function readIndexedDbSnapshot(){
  const database = await openDatabase();
  return new Promise((resolve,reject)=>{
    const transaction = database.transaction(DATABASE_STORE, 'readonly');
    const request = transaction.objectStore(DATABASE_STORE).get('current');
    request.onsuccess = ()=>resolve(request.result || null);
    request.onerror = ()=>reject(request.error || new Error('Database read failed'));
  });
}

// Returns {state, serverReachable, needsUpload, conflict, redirecting}.
async function load(){
  const pending = readPendingMarker();
  const pendingCopy = pending ? readLocalSnapshot() : null;
  let server = null;
  try{
    server = await fetchServerState();
    if(server.redirecting) return {redirecting:true};
  }catch(error){ console.warn('PostgreSQL unavailable; checking local copies', error); }

  if(server){
    setServerVersion(server.version);
    if(pendingCopy){
      const sameBase = pending.baseVersion!==undefined && pending.baseVersion===server.version;
      if(sameBase || !server.state) return {state:pendingCopy, serverReachable:true, needsUpload:true};
      clearPendingMarker();
      if(canonicalJSON(pendingCopy)===canonicalJSON(server.state)){
        return {state:server.state, serverReachable:true};
      }
      stashUnsavedCopy(pendingCopy);
      return {state:server.state, serverReachable:true, conflict:true};
    }
    if(server.state) return {state:server.state, serverReachable:true};
  }else{
    setServerVersion(pending ? pending.baseVersion ?? null : readStoredServerVersion());
    if(pendingCopy) return {state:pendingCopy, serverReachable:false, needsUpload:true};
  }

  // Server unreachable, or reachable but empty: fall back to this device's copies.
  // An empty server needs the local copy (or a fresh empty state) uploaded.
  const needsUpload = Boolean(server);
  try{
    const stored = await readIndexedDbSnapshot();
    if(stored) return {state:stored, serverReachable:Boolean(server), needsUpload};
  }catch(error){ console.warn('Database unavailable; checking local backup', error); }
  return {state:readLocalSnapshot(), serverReachable:Boolean(server), needsUpload};
}

/* ------------------------------ dialogs ------------------------------ */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const dialogReturnFocus = new Map();

function activateDialog(backdropId){
  const backdrop = document.getElementById(backdropId);
  if(!backdrop) return;
  if(!dialogReturnFocus.has(backdropId)) dialogReturnFocus.set(backdropId, document.activeElement);
  const dialog = backdrop.querySelector('[role="dialog"],[role="alertdialog"]');
  const heading = backdrop.querySelector('h2');
  if(dialog && heading && !dialog.hasAttribute('aria-label')){
    if(!heading.id) heading.id = `${backdropId}Heading`;
    dialog.setAttribute('aria-labelledby', heading.id);
  }
  backdrop.classList.add('open');
  requestAnimationFrame(()=>{
    const target = backdrop.querySelector('[autofocus]') || backdrop.querySelector(FOCUSABLE);
    if(target) target.focus({preventScroll:true});
  });
}

function deactivateDialog(backdropId){
  const backdrop = document.getElementById(backdropId);
  if(backdrop) backdrop.classList.remove('open');
  const previous = dialogReturnFocus.get(backdropId);
  dialogReturnFocus.delete(backdropId);
  if(previous && document.contains(previous) && typeof previous.focus==='function'){
    previous.focus({preventScroll:true});
  }
}

function topmostDialog(){
  return ['dialogBackdrop','receiptBackdrop','backdrop']
    .map(id=>document.getElementById(id))
    .find(element=>element && element.classList.contains('open')) || null;
}

function trapDialogFocus(event){
  if(event.key!=='Tab') return;
  const dialog = topmostDialog();
  if(!dialog) return;
  const focusable = [...dialog.querySelectorAll(FOCUSABLE)].filter(element=>element.offsetParent!==null);
  if(!focusable.length){ event.preventDefault(); return; }
  const first = focusable[0], last = focusable[focusable.length-1];
  if(!dialog.contains(document.activeElement)){
    event.preventDefault();
    first.focus();
  }else if(event.shiftKey && document.activeElement===first){
    event.preventDefault();
    last.focus();
  }else if(!event.shiftKey && document.activeElement===last){
    event.preventDefault();
    first.focus();
  }
}

let dialogResolve = null;

// Styled replacement for confirm()/alert(). Resolves true for confirm, false for cancel/Escape.
function showDialog({title, message, confirmLabel='OK', cancelLabel='Cancel', danger=false, alertOnly=false, details=''}){
  if(dialogResolve) dialogResolve(false);
  const dialog = document.getElementById('dialog');
  dialog.innerHTML = `
    <h2 id="dialogTitle">${esc(title)}</h2>
    <p id="dialogMessage" class="dialog-message">${esc(message)}</p>
    ${details ? `<p class="small muted">${esc(details)}</p>` : ''}
    <div class="modal-actions">
      ${alertOnly ? '' : `<button type="button" class="btn" data-dialog-result="cancel">${esc(cancelLabel)}</button>`}
      <button type="button" class="btn ${danger?'danger-solid':'primary'}" data-dialog-result="ok" autofocus>${esc(confirmLabel)}</button>
    </div>`;
  activateDialog('dialogBackdrop');
  return new Promise(resolve=>{ dialogResolve = resolve; });
}

function closeDialog(result){
  if(!dialogResolve) return;
  const resolve = dialogResolve;
  dialogResolve = null;
  deactivateDialog('dialogBackdrop');
  document.getElementById('dialog').innerHTML = '';
  resolve(result);
}

function confirmAction(options){
  return showDialog({confirmLabel:'Continue', ...options});
}

/* ------------------------------ empty state ------------------------------ */
const COLLECTIONS = ['clients','billing','payments','napBoxes','napPorts','complaints','installs','inventory'];
const DEFAULT_PLANS = ['25 Mbps','50 Mbps','Unspecified'];
const DEFAULT_METHODS = ['Cash','GCash','Maya','Bank Transfer'];
const DEFAULT_HOME_BASE = { name:'Home Base / OLT', lat:14.1230, lng:121.1230 };

function emptyState(){
  return {
    clients:[], billing:[], payments:[], napBoxes:[], napPorts:[],
    complaints:[], installs:[], inventory:[], billingExclusions:[],
    settings:{
      business:'My ISP', tagline:'Fiber Internet Service Provider',
      address:'', contact:'', tin:'',
      plans:[...DEFAULT_PLANS], pricingDefaultsVersion:1, legacyPricingCorrectionVersion:1,
      methods:[...DEFAULT_METHODS], dueDay:5,
      homeBase:{...DEFAULT_HOME_BASE}, created:todayISO()
    }
  };
}

/* ------------------------------ init ------------------------------ */
// Fills in missing collections and settings so partial or older data never crashes a page.
function normalizeState(data){
  const base = emptyState();
  const source = data && typeof data==='object' && !Array.isArray(data) ? data : {};
  const result = {...source};
  [...COLLECTIONS, 'billingExclusions'].forEach(key=>{
    result[key] = Array.isArray(source[key])
      ? source[key].filter(record=>record && typeof record==='object' && !Array.isArray(record))
      : [];
  });
  const settings = source.settings && typeof source.settings==='object' && !Array.isArray(source.settings)
    ? source.settings : {};
  result.settings = {...settings};
  const text = (key, fallback='') => typeof settings[key]==='string' ? settings[key] : fallback;
  result.settings.business = text('business').trim() || base.settings.business;
  result.settings.tagline = text('tagline', base.settings.tagline);
  result.settings.address = text('address');
  result.settings.contact = text('contact');
  result.settings.tin = text('tin');
  const list = (value, fallback) => Array.isArray(value)
    ? value.filter(item=>typeof item==='string' && item.trim()) : [...fallback];
  result.settings.plans = list(settings.plans, DEFAULT_PLANS);
  if(!result.settings.plans.length) result.settings.plans = [...DEFAULT_PLANS];
  result.settings.methods = list(settings.methods, DEFAULT_METHODS);
  if(!result.settings.methods.length) result.settings.methods = [...DEFAULT_METHODS];
  const dueDay = Number(settings.dueDay);
  result.settings.dueDay = Number.isInteger(dueDay) && dueDay>=1 && dueDay<=28 ? dueDay : 5;
  const home = settings.homeBase && typeof settings.homeBase==='object' ? settings.homeBase : {};
  const lat = Number(home.lat), lng = Number(home.lng);
  result.settings.homeBase = {
    name: typeof home.name==='string' && home.name.trim() ? home.name : DEFAULT_HOME_BASE.name,
    lat: home.lat!=='' && home.lat!=null && Number.isFinite(lat) && lat>=-90 && lat<=90 ? lat : DEFAULT_HOME_BASE.lat,
    lng: home.lng!=='' && home.lng!=null && Number.isFinite(lng) && lng>=-180 && lng<=180 ? lng : DEFAULT_HOME_BASE.lng
  };
  return result;
}

// Returns an error message for anything that is not a usable ISP Manager backup.
function backupError(data){
  if(!data || typeof data!=='object' || Array.isArray(data)) return 'The file does not contain an ISP Manager backup.';
  if(!Array.isArray(data.clients)) return 'The backup has no client list.';
  for(const key of [...COLLECTIONS, 'billingExclusions']){
    if(data[key]===undefined) continue;
    if(!Array.isArray(data[key])) return `"${key}" in the backup is not a list.`;
    if(data[key].some(record=>!record || typeof record!=='object' || Array.isArray(record))){
      return `"${key}" in the backup contains invalid records.`;
    }
  }
  for(const key of COLLECTIONS){
    const ids = (data[key]||[]).map(record=>record.id);
    if(ids.some(id=>id===undefined || id===null || id==='')) return `Some "${key}" records have no ID.`;
    if(new Set(ids.map(String)).size!==ids.length) return `"${key}" contains duplicate IDs.`;
  }
  if(data.settings!==undefined && (typeof data.settings!=='object' || Array.isArray(data.settings) || !data.settings)){
    return 'The backup settings are invalid.';
  }
  return '';
}

// Idempotent data upgrades for older saves. Returns true if anything changed.
function applyMigrations(){
  let changed = false;
  changed = correctLegacy600Pricing() || changed;
  changed = migratePlanPricing() || changed;
  changed = addDefaultPricingPlans() || changed;
  DB.clients.forEach(client=>{
    if(client.pppoe && !client.service){ client.service = 'pppoe'; changed = true; }
  });
  DB.payments.forEach(payment=>{
    if(!payment.receiptNo){ payment.receiptNo = nextReceiptNo(); changed = true; }
  });
  DB.napPorts.forEach(port=>{
    if(typeof port.fiberColor!=='string'){ port.fiberColor = ''; changed = true; }
  });
  changed = NapboxBilling.linkPaymentsToInvoices(DB)>0 || changed;
  changed = updateCurrentGeneratedInvoiceDueDates()>0 || changed;
  return changed;
}

async function init(){
  const loaded = await load();
  if(loaded.redirecting) return;
  DB = normalizeState(loaded.state || emptyState());
  const migrated = applyMigrations();
  const synchronized = NapboxBilling.synchronizeInvoices(DB, todayISO())>0;
  state.month = state.month || ym(new Date());
  const openUnpaidReminders = window.location.hash==='#unpaid-reminders';
  if(openUnpaidReminders) state.tab='dashboard';
  document.getElementById('subBrand').textContent = DB.settings.business;
  if(loaded.needsUpload || migrated || synchronized){
    save();
  }else if(loaded.serverReachable || loaded.state){
    setSaveStatus(loaded.serverReachable ? 'Saved to PostgreSQL' : 'Server unavailable · showing the copy on this device',
      loaded.serverReachable ? 'saved' : 'warning');
  }else{
    setSaveStatus('Cannot reach the server and no local copy exists · changes will sync when it is back', 'error');
  }
  render();
  if(loaded.conflict) showConflictNotice();
  if(openUnpaidReminders){
    requestAnimationFrame(()=>{
      document.getElementById('overdueReminderList')?.scrollIntoView({behavior:'smooth',block:'start'});
    });
  }
}
