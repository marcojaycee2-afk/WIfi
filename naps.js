/* ==========================================================================
   NAP Boxes — module extracted from index.html
   --------------------------------------------------------------------------
   Usage from the host page:
     NAP.init({ getDB, save, render, toast, esc, num, billingRows,
                openForm, closeModal, setTab });
     NAP.page()          -> HTML string for the NAP Boxes tab
     NAP.initMap()       -> call after the map tab is mounted
     NAP.onClick(e)      -> returns true if the event was a NAP action
     NAP.onChange(e)     -> returns true if the event was a NAP change
     NAP.stats(box)      -> { used, free, faulty, reserved, total, ports }
     NAP.resetState()    -> reset internal state (wipe / demo reset)
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- Internal map + view state ---------- */
  let mapInstance = null;
  let mapEngine = null;                 // 'leaflet' | 'mapbox' | null
  let leafletMapOverlays = null;
  let mapMarkers = {};
  let mapLines = [];
  let mapLineEvents = [];
  let mapHoverPopup = null;

  const state = {
    view: 'grid',                       // 'grid' | 'map' | 'splitter'
    selectedNapId: null,
    map3d: false,
    mapPlaceClient: false,
    mapContextLocation: null,
    mapFocus: null,
    pendingClientHouse: null,
  };

  /* ---------- Deps (set by host via NAP.init) ---------- */
  let deps = null;
  const DB          = () => deps.getDB();
  const save        = (...a) => deps.save(...a);
  const render      = (...a) => deps.render(...a);
  const toast       = (...a) => deps.toast(...a);
  const esc         = (...a) => deps.esc(...a);
  const num         = (...a) => deps.num(...a);
  const billingRows = () => deps.billingRows();
  const openForm    = (...a) => deps.openForm(...a);
  const closeModal  = (...a) => deps.closeModal(...a);
  const setTab      = (...a) => deps.setTab(...a);

  /* ---------- Local utilities ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => { const x = new Date(d);
    return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`; };
  const todayISO = () => iso(new Date());

  function haversine(a, b) {
    const R = 6371008.8;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
              Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function getDistanceStr(lat1, lng1, lat2, lng2) {
    const m = haversine({ lat: Number(lat1), lng: Number(lng1) },
                        { lat: Number(lat2), lng: Number(lng2) });
    return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2) + ' km';
  }

  /* =========================================================================
     DATA HELPERS
     ========================================================================= */

  function napStats(box) {
    const ports = DB().napPorts
      .filter((p) => p.napId === box.id)
      .sort((a, b) => a.port - b.port);
    const used     = ports.filter((p) => p.status === 'Used').length;
    const faulty   = ports.filter((p) => p.status === 'Faulty').length;
    const reserved = ports.filter((p) => p.status === 'Reserved').length;
    const total    = num(box.totalPorts) || ports.length;
    const free     = Math.max(0, total - used - faulty - reserved);
    return { used, free, faulty, reserved, total, ports };
  }

  function ensurePorts(box) {
    for (let i = 1; i <= num(box.totalPorts); i++) {
      if (!DB().napPorts.find((p) => p.napId === box.id && Number(p.port) === i)) {
        DB().napPorts.push({
          id: `NP-${box.id}-${i}`, napId: box.id, port: i,
          clientId: '', status: 'Free', notes: '',
        });
      }
    }
    DB().napPorts = DB().napPorts
      .filter((p) => p.napId !== box.id || Number(p.port) <= num(box.totalPorts));
  }

  function syncClientPort(client, old) {
    if (old && (old.napId !== client.napId || String(old.port) !== String(client.port))) {
      const oldPort = DB().napPorts.find((p) =>
        p.napId === old.napId && String(p.port) === String(old.port) &&
        p.clientId === client.id);
      if (oldPort) { oldPort.clientId = ''; oldPort.status = 'Free'; }
    }
    if (client.napId && client.port) {
      let target = DB().napPorts.find((p) =>
        p.napId === client.napId && Number(p.port) === Number(client.port));
      if (!target) {
        target = { id: `NP-${client.napId}-${client.port}`, napId: client.napId,
                   port: Number(client.port), clientId: '', status: 'Free', notes: '' };
        DB().napPorts.push(target);
      }
      target.clientId = client.id;
      target.status = 'Used';
    }
  }

  function clientPortError(client, excludeClientId) {
    if (!client.napId && !client.port) return '';
    if (!client.napId || !client.port) return 'Choose both a NAP box and port, or leave both empty';
    const box = DB().napBoxes.find((b) => b.id === client.napId);
    const port = Number(client.port);
    if (!box || !Number.isInteger(port) || port < 1 || port > num(box.totalPorts)) {
      return 'Choose a valid port on the selected NAP box';
    }
    const other = DB().clients.find((c) =>
      c.id !== excludeClientId && c.napId === client.napId && Number(c.port) === port);
    if (other) return `Port ${port} is already assigned to ${other.name}`;
    const rec = DB().napPorts.find((p) =>
      p.napId === client.napId && Number(p.port) === port &&
      p.clientId && p.clientId !== excludeClientId);
    if (rec) {
      const owner = DB().clients.find((c) => c.id === rec.clientId);
      return `Port ${port} is already assigned${owner ? ` to ${owner.name}` : ''}`;
    }
    const status = DB().napPorts.find((p) =>
      p.napId === client.napId && Number(p.port) === port);
    if (status && status.clientId !== excludeClientId && status.status !== 'Free') {
      return `Port ${port} is ${status.status.toLowerCase()} and cannot be assigned`;
    }
    return '';
  }

  /* =========================================================================
     VIEWS
     ========================================================================= */

  function pageNaps() {
    const nav = `
      <div class="subtabs">
        <button class="subtab ${state.view === 'grid' ? 'active' : ''}" data-napview="grid">📋 Grid</button>
        <button class="subtab ${state.view === 'map'  ? 'active' : ''}" data-napview="map">🗺 Map</button>
        <button class="subtab ${state.view === 'splitter' ? 'active' : ''}" data-napview="splitter">🔌 Splitter</button>
      </div>`;

    let body = '';
    if (state.view === 'grid')      body = napGridView();
    else if (state.view === 'map')  body = napMapView();
    else                            body = napSplitterView();

    return `
    <div class="page-head">
      <h1>NAP Boxes <span class="muted small">(${DB().napBoxes.length})</span></h1>
      <button class="btn" data-act="addClientHouse">🏠 Add Client House</button>
      <button class="btn primary" data-act="add" data-table="napBoxes">+ Add NAP Box</button>
    </div>
    ${nav}
    ${body}
    `;
  }

  function napGridView() {
    const boxes = DB().napBoxes;
    const cards = boxes.map((b) => {
      const s = napStats(b);
      const pct = s.total ? Math.round((s.used / s.total) * 100) : 0;
      const cls = s.free <= 2 ? 'full' : s.free <= 4 ? 'warn' : 'ok';
      const hasCoords = b.lat !== '' && b.lat != null &&
                        b.lng !== '' && b.lng != null &&
                        Number.isFinite(Number(b.lat)) &&
                        Number.isFinite(Number(b.lng));

      const portChips = s.ports.map((p) => {
        const c = DB().clients.find((x) => x.id === p.clientId);
        const label = p.status === 'Used' && c ? c.name.split(' ')[0] : p.status;
        return `<div class="port ${p.status.toLowerCase()}"
                     title="Port ${p.port} — ${esc(label)}">
          <span class="n">${p.port}</span>${esc(label)}
        </div>`;
      }).join('');

      return `
      <div class="card">
        <div class="card-head">
          <h2>${esc(b.id)} <span class="muted small">${esc(b.label || '')}</span></h2>
          <span class="badge ${s.free <= 2 ? 'b-red' : s.free <= 4 ? 'b-amber' : 'b-green'}">${s.free} free</span>
        </div>
        <div class="small muted" style="margin-bottom:8px">
          📍 ${esc(b.address || '')}${b.landmark ? ` · ${esc(b.landmark)}` : ''}
          ${hasCoords ? ` · ${b.lat}, ${b.lng} ·
            <button class="map-link" type="button" data-act="focusNapMap" data-id="${esc(b.id)}">map</button>` : ''}
        </div>
        <div class="bar ${cls}"><span style="width:${pct}%"></span></div>
        <div class="flex small muted" style="margin-top:6px">
          <span>${s.used}/${s.total} used</span><span>·</span>
          <span>${s.free} free</span>
          ${s.faulty ? `<span>· <span style="color:var(--red)">${s.faulty} faulty</span></span>` : ''}
          <span class="spacer"></span>
          <span>${esc(b.splitter || '')} · ${esc(b.upstreamId || b.upstream || '')}</span>
        </div>
        <div class="ports">${portChips}</div>
        <div class="flex" style="margin-top:12px">
          <button class="btn sm" data-act="edit" data-table="napBoxes" data-id="${esc(b.id)}">Edit Box</button>
          <button class="btn sm" data-act="viewSplitter" data-id="${esc(b.id)}">View Splitter</button>
          <span class="spacer"></span>
          <button class="btn sm danger" data-act="del" data-table="napBoxes" data-id="${esc(b.id)}">✕</button>
        </div>
        ${b.route ? `<div class="note" style="margin-top:10px">🔧 ${esc(b.route)}</div>` : ''}
      </div>`;
    }).join('');

    return cards || `<div class="card"><div class="empty"><div class="big">🔌</div>No NAP boxes yet.</div></div>`;
  }

  function napMapView() {
    return `
    <div id="mapWrap">
      <div id="map"></div>
      <div class="map-status" id="mapStatus" role="status" aria-live="polite" hidden></div>
      <div class="map-context-menu" id="mapContextMenu" role="menu" hidden>
        <button class="btn sm" type="button" data-act="placeNapBoxAtMap">＋ Add NAP Box here</button>
        <button class="btn sm" type="button" data-act="placeClientAtMap">⌂ Add Client here</button>
      </div>
      <div class="map-help">
        <b>Map</b><br>
        Right-click to add a NAP box or client at that location. Drag markers to reposition;
        select a NAP box to open its splitter.
        <div style="margin-top:8px"><button class="btn sm" id="map3dToggle" type="button">Enable 3D</button></div>
      </div>
      <div class="map-overlay">
        <b>Legend</b>
        <div class="row"><span class="home-marker" style="width:18px;height:18px;font-size:10px">🏠</span> Home Base / OLT</div>
        <div class="row"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#3b82f6;border:2px solid #fff"></span> NAP box</div>
        <div class="row"><span style="display:inline-block;width:22px;border-top:2px dashed #3b82f6"></span> Uplink</div>
        <div class="row"><span class="client-house-marker" style="width:18px;height:18px;font-size:10px">⌂</span> Client house</div>
        <div class="row"><span style="display:inline-block;width:22px;border-top:2px dashed #22c55e"></span> Client drop</div>
      </div>
    </div>`;
  }

  function napSplitterView() {
    if (!DB().napBoxes.length) {
      return `<div class="card"><div class="empty"><div class="big">🔌</div>No NAP boxes yet.</div></div>`;
    }
    if (!state.selectedNapId || !DB().napBoxes.find((b) => b.id === state.selectedNapId)) {
      state.selectedNapId = DB().napBoxes[0].id;
    }
    const box = DB().napBoxes.find((b) => b.id === state.selectedNapId);
    const s = napStats(box);

    const selector = `
      <div class="card" style="margin-bottom:12px">
        <label class="field" style="margin-bottom:0">
          <span>Select NAP Box</span>
          <select id="napPicker">
            ${DB().napBoxes.map((b) =>
              `<option value="${esc(b.id)}" ${b.id === box.id ? 'selected' : ''}>${esc(b.id)} — ${esc(b.label || '')} (${napStats(b).used}/${napStats(b).total})</option>`
            ).join('')}
          </select>
        </label>
      </div>`;

    const cols = box.totalPorts <= 8 ? 4 : box.totalPorts <= 16 ? 8 : 12;

    const ports = s.ports.map((p) => {
      const c = DB().clients.find((x) => x.id === p.clientId);
      const status = p.status === 'Used'
        ? (c && c.status === 'Suspended' ? 'warning' : 'connected')
        : p.status === 'Faulty'   ? 'broken'
        : p.status === 'Reserved' ? 'warning'
        : 'available';
      const paid = c
        ? billingRows().filter((r) => r.clientId === c.id).every((r) => r.balance <= 0)
        : false;
      const tick = status === 'connected'
        ? `<span class="tick ${paid ? 'paid' : 'unpaid'}">${paid ? 'PAID' : 'UNPAID'}</span>` : '';
      const label = c ? esc(c.name)
        : p.status === 'Faulty' ? 'BROKEN'
        : p.status === 'Reserved' ? 'RESERVED'
        : 'AVAILABLE';
      return `
        <div class="port-cell ${status}"
             data-act="openPort" data-napid="${esc(box.id)}" data-port="${p.port}"
             title="Port ${p.port} — ${label}">
          <div class="num">${p.port}</div>
          <div class="connector"></div>
          <div class="body"></div>
          ${tick}
        </div>`;
    }).join('');

    const hasCoords = box.lat !== '' && box.lat != null &&
                      box.lng !== '' && box.lng != null &&
                      Number.isFinite(Number(box.lat)) &&
                      Number.isFinite(Number(box.lng));

    return `
    ${selector}
    <div class="card" style="padding:10px 14px">
      <div class="flex small muted">
        <strong style="color:var(--ink)">${esc(box.id)}</strong>
        <span>${esc(box.label || '')}</span>
        <span class="spacer"></span>
        <span>${s.used}/${s.total} used · ${s.free} free</span>
      </div>
      <div class="tiny muted" style="margin-top:4px">
        📍 ${esc(box.address || '')}${box.landmark ? ` · ${esc(box.landmark)}` : ''}
        ${hasCoords ? ` · <button class="map-link" type="button" data-act="focusNapMap" data-id="${esc(box.id)}">map</button>` : ''}
      </div>
    </div>
    <div class="splitter-wrap">
      <div class="splitter">
        <div class="hole left1"></div><div class="hole left2"></div>
        <div class="hole right1"></div><div class="hole right2"></div>
        <div class="splitter-label">FIBER PORTS · ${box.splitter || ''}</div>
        <div class="splitter-id">${esc(box.id)}</div>
        <div class="splitter-ports" style="grid-template-columns:repeat(${cols}, 1fr)">
          ${ports}
        </div>
        <div class="splitter-foot">
          <span><span class="dot" style="background:#168bff"></span>Available</span>
          <span><span class="dot" style="background:#22c55e"></span>Connected</span>
          <span><span class="dot" style="background:#facc15"></span>Suspended</span>
          <span><span class="dot" style="background:#9ca3af"></span>Broken</span>
        </div>
      </div>
    </div>`;
  }

  /* =========================================================================
     MAP
     ========================================================================= */

  async function initMap() {
    const el = document.getElementById('map');
    if (!el) return;
    const status = document.getElementById('mapStatus');

    const showStatus = (title, message) => {
      if (!status) return;
      status.innerHTML = `<strong>${esc(title)}</strong>${esc(message)}`;
      status.hidden = false;
    };
    const hideStatus = () => { if (status) status.hidden = true; };

    const showContextMenu = (point, lat, lng) => {
      const menu = document.getElementById('mapContextMenu');
      const wrap = document.getElementById('mapWrap');
      if (!menu || !wrap) return;
      state.mapContextLocation = {
        lat: Number(lat).toFixed(6),
        lng: Number(lng).toFixed(6),
      };
      menu.hidden = false;
      const maxLeft = Math.max(0, wrap.clientWidth  - menu.offsetWidth  - 8);
      const maxTop  = Math.max(0, wrap.clientHeight - menu.offsetHeight - 8);
      menu.style.left = `${Math.min(Math.max(point.x, 8), maxLeft)}px`;
      menu.style.top  = `${Math.min(Math.max(point.y, 8), maxTop)}px`;
    };
    const hideContextMenu = () => {
      const menu = document.getElementById('mapContextMenu');
      if (menu) menu.hidden = true;
      state.mapContextLocation = null;
    };

    const hb = DB().settings.homeBase;
    let mapCenter = [Number(hb.lat), Number(hb.lng)];
    let mapZoom = 15;

    // Always tear down the previous instance so we re-center on Home Base.
    if (mapInstance) { mapInstance.remove(); mapInstance = null; }

    if (state.mapFocus) {
      mapCenter = [Number(state.mapFocus.lat), Number(state.mapFocus.lng)];
      mapZoom = 18;
    }

    mapEngine = null;
    leafletMapOverlays = null;

    showStatus('Loading map…', 'Connecting to the map service.');

    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('Could not load map configuration');
      const { mapboxAccessToken } = await response.json();

      if (!mapboxAccessToken) {
        if (typeof L === 'undefined') {
          showStatus('Map library unavailable',
            'Allow network access to unpkg.com and reload the page.');
          return;
        }
        mapEngine = 'leaflet';
        mapInstance = L.map(el, { zoomControl: false }).setView(mapCenter, mapZoom);
        state.mapFocus = null;

        const tiles = L.tileLayer(
          'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }
        ).addTo(mapInstance);

        let tilesLoaded = false;
        tiles.on('tileload',  () => { tilesLoaded = true; hideStatus(); });
        tiles.on('tileerror', () => {
          if (!tilesLoaded) showStatus('Map tiles unavailable',
            'Check your internet connection and allow tile.openstreetmap.org.');
        });

        L.control.zoom({ position: 'topright' }).addTo(mapInstance);
        leafletMapOverlays = L.layerGroup().addTo(mapInstance);

        mapInstance.on('contextmenu', (event) => {
          event.originalEvent.preventDefault();
          showContextMenu(event.containerPoint, event.latlng.lat, event.latlng.lng);
        });
        mapInstance.on('click', hideContextMenu);

        const btn3d = document.getElementById('map3dToggle');
        if (btn3d) btn3d.hidden = true;

        renderLeafletMapMarkers();

        if (state.mapPlaceClient) {
          mapInstance.once('click', (event) => {
            state.mapPlaceClient = false;
            openClientHouseForm(event.latlng.lat, event.latlng.lng);
          });
        }
        if (!tilesLoaded) showStatus('Loading map…', 'Loading OpenStreetMap tiles.');
        mapInstance.invalidateSize();
        return;
      }

      if (typeof mapboxgl === 'undefined') {
        showStatus('Map library unavailable',
          'Allow network access to api.mapbox.com and reload the page.');
        return;
      }
      mapEngine = 'mapbox';
      mapboxgl.accessToken = mapboxAccessToken;

      mapInstance = new mapboxgl.Map({
        container: el,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [mapCenter[1], mapCenter[0]],
        zoom: mapZoom,
        pitch: state.map3d ? 55 : 0,
        antialias: true,
      });
      state.mapFocus = null;

      let mapLoaded = false;
      mapInstance.on('error', (event) => {
        if (mapLoaded) return;
        const error = event.error || {};
        const code = Number(error.status);
        if (code === 401 || code === 403) {
          showStatus('Mapbox rejected the token',
            'Check that MAPBOX_ACCESS_TOKEN is valid, is a public pk. token, and allows this site’s domain.');
        } else {
          showStatus('Map could not load',
            'Check the public token, its allowed URL restrictions, and the connection to Mapbox.');
        }
        console.error('Mapbox map error', error);
      });

      mapInstance.addControl(
        new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
      mapHoverPopup = new mapboxgl.Popup({
        closeButton: false, closeOnClick: false, offset: 8,
      });

      mapInstance.on('contextmenu', (event) => {
        event.originalEvent.preventDefault();
        showContextMenu(event.point, event.lngLat.lat, event.lngLat.lng);
      });
      mapInstance.on('click', hideContextMenu);

      mapInstance.on('load', () => {
        mapLoaded = true;
        hideStatus();
        addMapBuildings();
        renderMapMarkers();
        setMap3dMode(state.map3d, false);

        if (state.mapPlaceClient) {
          mapInstance.once('click', (event) => {
            state.mapPlaceClient = false;
            openClientHouseForm(event.lngLat.lat, event.lngLat.lng);
          });
        }
        document.getElementById('map3dToggle')
          ?.addEventListener('click', () => setMap3dMode(!state.map3d));
        mapInstance.resize();
      });
    } catch (error) {
      console.error('Mapbox failed to load', error);
      showStatus('Map could not start',
        'Check MAPBOX_ACCESS_TOKEN and allow this site’s domain in your Mapbox token settings.');
    }
  }

  function renderLeafletMapMarkers() {
    if (mapEngine !== 'leaflet' || !mapInstance || !leafletMapOverlays) return;
    leafletMapOverlays.clearLayers();
    mapMarkers = {};

    const hb = DB().settings.homeBase;
    const addLine = (start, end, color, dashed, tooltip) => {
      L.polyline([start, end], {
        color, weight: dashed ? 2 : 3, opacity: 0.8,
        dashArray: dashed ? '6 6' : null,
      }).bindTooltip(esc(tooltip)).addTo(leafletMapOverlays);
    };

    const makeMarker = (key, element, lat, lng, popup, onDrag) => {
      const marker = L.marker([Number(lat), Number(lng)], {
        draggable: true,
        icon: L.divIcon({
          className: '', html: element.outerHTML, iconSize: null, iconAnchor: [16, 16],
        }),
      }).addTo(leafletMapOverlays);
      marker.bindPopup(popup);
      marker.on('dragend', () => onDrag(marker.getLatLng()));
      mapMarkers[key] = marker;
      return marker;
    };

    const homeEl = document.createElement('div');
    homeEl.className = 'home-marker';
    homeEl.textContent = '🏠';
    makeMarker('home', homeEl, hb.lat, hb.lng,
      `<b>${esc(hb.name)}</b><br><span class="small muted">Drag to reposition</span>`,
      (point) => {
        DB().settings.homeBase.lat = point.lat;
        DB().settings.homeBase.lng = point.lng;
        save(); renderLeafletMapMarkers();
      });

    DB().napBoxes.forEach((box) => {
      if (box.lat === '' || box.lng === '' ||
          !Number.isFinite(Number(box.lat)) || !Number.isFinite(Number(box.lng))) return;

      let sLat = hb.lat, sLng = hb.lng, uplinkName = hb.name;
      if (box.uplinkId) {
        const parent = DB().napBoxes.find((item) => item.id === box.uplinkId);
        if (parent && parent.lat !== '' && parent.lng !== '') {
          sLat = parent.lat; sLng = parent.lng;
          uplinkName = parent.label || parent.id;
        }
      }
      const distance = getDistanceStr(sLat, sLng, box.lat, box.lng);
      addLine([Number(sLat), Number(sLng)], [Number(box.lat), Number(box.lng)],
        box.color || '#3b82f6', Boolean(box.uplinkId), distance);

      const element = document.createElement('div');
      element.className = 'name-badge-marker';
      element.style.background = box.color || '#3b82f6';
      element.textContent = box.id;

      const popup = `
        <b>${esc(box.id)}</b><br>
        <span style="font-size:11px;color:#94a3b8">${esc(box.label || '')}</span><br>
        <span style="font-size:11px;color:#94a3b8">Uplink: ${esc(uplinkName)} · ${esc(distance)}</span><br><br>
        <button onclick="openSplitterFromMap('${esc(box.id)}')"
          style="background:#3b82f6;color:#fff;border:none;padding:6px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">
          Open Splitter
        </button>`;

      makeMarker(box.id, element, box.lat, box.lng, popup, (point) => {
        const current = DB().napBoxes.find((item) => item.id === box.id);
        if (current) { current.lat = point.lat; current.lng = point.lng; save(); renderLeafletMapMarkers(); }
      });
    });

    DB().clients.forEach((client) => {
      if (client.lat === '' || client.lng === '' ||
          client.lat == null || client.lng == null ||
          !Number.isFinite(Number(client.lat)) || !Number.isFinite(Number(client.lng))) return;

      const lat = Number(client.lat), lng = Number(client.lng);
      const nap = DB().napBoxes.find((box) => box.id === client.napId);

      if (nap && nap.lat !== '' && nap.lng !== '' &&
          Number.isFinite(Number(nap.lat)) && Number.isFinite(Number(nap.lng))) {
        addLine([Number(nap.lat), Number(nap.lng)], [lat, lng], '#22c55e', true,
          `Client drop · ${getDistanceStr(nap.lat, nap.lng, lat, lng)}`);
      }

      const element = document.createElement('div');
      element.className = 'client-house-marker';
      element.textContent = '⌂';

      const connection = nap
        ? `${esc(nap.id)} · port ${esc(client.port || '—')}`
        : 'Not connected to a NAP';

      const popup = `
        <b>${esc(client.name)}</b><br>
        <span style="font-size:11px;color:#94a3b8">${esc(client.plan || '')}</span><br>
        <span style="font-size:11px;color:#94a3b8">${connection}</span><br><br>
        <button onclick="openClientFromMap(${esc(JSON.stringify(client.id))})"
          style="background:#3b82f6;color:#fff;border:none;padding:6px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">
          Edit Client
        </button>`;

      makeMarker(`client:${client.id}`, element, lat, lng, popup, (point) => {
        client.lat = point.lat;
        client.lng = point.lng;
        save(); renderLeafletMapMarkers();
      });
    });
  }

  function addMapBuildings() {
    if (mapInstance.getLayer('napbox-3d-buildings')) return;
    mapInstance.addLayer({
      id: 'napbox-3d-buildings',
      source: 'composite',
      'source-layer': 'building',
      filter: ['==', ['get', 'extrude'], 'true'],
      minzoom: 15,
      type: 'fill-extrusion',
      paint: {
        'fill-extrusion-color': '#94a3b8',
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15, 0, ['get', 'height']],
        'fill-extrusion-base':   ['interpolate', ['linear'], ['zoom'], 15, 0, ['get', 'min_height']],
        'fill-extrusion-opacity': 0.72,
      },
    });
  }

  function setMap3dMode(enabled, animate = true) {
    if (!mapInstance) return;
    state.map3d = enabled;
    mapInstance.easeTo({ pitch: enabled ? 55 : 0, duration: animate ? 500 : 0 });
    if (mapInstance.getLayer('napbox-3d-buildings')) {
      mapInstance.setLayoutProperty(
        'napbox-3d-buildings', 'visibility', enabled ? 'visible' : 'none');
    }
    const btn = document.getElementById('map3dToggle');
    if (btn) btn.textContent = enabled ? 'Enable 2D' : 'Enable 3D';
  }

  function addMapLine(coordinates, color, dashed, tooltip) {
    const id = `napbox-line-${mapLines.length}`;
    const layerId = `${id}-layer`;
    mapInstance.addSource(id, {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} },
    });
    mapInstance.addLayer({
      id: layerId, type: 'line', source: id,
      paint: {
        'line-color': color,
        'line-width': dashed ? 2 : 3,
        'line-opacity': 0.8,
        ...(dashed ? { 'line-dasharray': [2, 2] } : {}),
      },
    });
    const onEnter = (event) => {
      mapInstance.getCanvas().style.cursor = 'pointer';
      mapHoverPopup.setLngLat(event.lngLat)
        .setHTML(`<span class="small">${esc(tooltip)}</span>`)
        .addTo(mapInstance);
    };
    const onLeave = () => {
      mapInstance.getCanvas().style.cursor = '';
      mapHoverPopup.remove();
    };
    mapInstance.on('mouseenter', layerId, onEnter);
    mapInstance.on('mouseleave', layerId, onLeave);
    mapLineEvents.push({ layerId, onEnter, onLeave });
    mapLines.push(id);
  }

  function renderMapMarkers() {
    if (!mapInstance) return;
    if (mapEngine === 'leaflet') { renderLeafletMapMarkers(); return; }

    Object.values(mapMarkers).forEach((m) => m.remove());
    mapLineEvents.forEach(({ layerId, onEnter, onLeave }) => {
      mapInstance.off('mouseenter', layerId, onEnter);
      mapInstance.off('mouseleave', layerId, onLeave);
    });
    mapLines.forEach((id) => {
      mapInstance.removeLayer(`${id}-layer`);
      mapInstance.removeSource(id);
    });
    mapMarkers = {}; mapLines = []; mapLineEvents = [];

    const hb = DB().settings.homeBase;
    const homeEl = document.createElement('div');
    homeEl.className = 'home-marker';
    homeEl.textContent = '🏠';
    const homeMarker = new mapboxgl.Marker({ element: homeEl, draggable: true, anchor: 'center' })
      .setLngLat([Number(hb.lng), Number(hb.lat)])
      .setPopup(new mapboxgl.Popup({ offset: 20 })
        .setHTML(`<b>${esc(hb.name)}</b><br><span class="small muted">Drag to reposition</span>`))
      .addTo(mapInstance);
    homeMarker.on('dragend', () => {
      const p = homeMarker.getLngLat();
      DB().settings.homeBase.lat = p.lat;
      DB().settings.homeBase.lng = p.lng;
      save(); renderMapMarkers();
    });
    mapMarkers['home'] = homeMarker;

    DB().napBoxes.forEach((box) => {
      if (box.lat === '' || box.lng === '' ||
          !Number.isFinite(Number(box.lat)) || !Number.isFinite(Number(box.lng))) return;

      let sLat = hb.lat, sLng = hb.lng, uplinkName = hb.name;
      if (box.uplinkId) {
        const p = DB().napBoxes.find((b) => b.id === box.uplinkId);
        if (p && p.lat && p.lng) { sLat = p.lat; sLng = p.lng; uplinkName = p.name || p.label; }
      }
      const dist = getDistanceStr(sLat, sLng, box.lat, box.lng);
      addMapLine([[Number(sLng), Number(sLat)], [Number(box.lng), Number(box.lat)]],
        box.color || '#3b82f6', Boolean(box.uplinkId), dist);

      const element = document.createElement('div');
      element.className = 'name-badge-marker';
      element.style.background = box.color || '#3b82f6';
      element.textContent = box.id;

      const m = new mapboxgl.Marker({ element, draggable: true, anchor: 'center' })
        .setLngLat([Number(box.lng), Number(box.lat)])
        .addTo(mapInstance);
      m.on('dragend', () => {
        const p = m.getLngLat();
        const b = DB().napBoxes.find((x) => x.id === box.id);
        if (b) { b.lat = p.lat; b.lng = p.lng; save(); renderMapMarkers(); }
      });
      m.setPopup(new mapboxgl.Popup({ offset: 20 }).setHTML(`
        <b>${esc(box.id)}</b><br>
        <span style="font-size:11px;color:#94a3b8">${esc(box.label || '')}</span><br>
        <span style="font-size:11px;color:#94a3b8">Uplink: ${esc(uplinkName)} · ${esc(dist)}</span><br><br>
        <button onclick="openSplitterFromMap('${esc(box.id)}')"
          style="background:#3b82f6;color:#fff;border:none;padding:6px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">
          Open Splitter
        </button>`));
      mapMarkers[box.id] = m;
    });

    DB().clients.forEach((client) => {
      if (client.lat === '' || client.lng === '' ||
          client.lat == null || client.lng == null ||
          !Number.isFinite(Number(client.lat)) || !Number.isFinite(Number(client.lng))) return;

      const lat = Number(client.lat), lng = Number(client.lng);
      const nap = DB().napBoxes.find((box) => box.id === client.napId);
      if (nap && nap.lat !== '' && nap.lng !== '' &&
          Number.isFinite(Number(nap.lat)) && Number.isFinite(Number(nap.lng))) {
        addMapLine([[Number(nap.lng), Number(nap.lat)], [lng, lat]], '#22c55e', true,
          `Client drop · ${getDistanceStr(nap.lat, nap.lng, lat, lng)}`);
      }

      const element = document.createElement('div');
      element.className = 'client-house-marker';
      element.textContent = '⌂';

      const marker = new mapboxgl.Marker({ element, draggable: true, anchor: 'center' })
        .setLngLat([lng, lat]).addTo(mapInstance);
      marker.on('dragend', () => {
        const point = marker.getLngLat();
        client.lat = point.lat;
        client.lng = point.lng;
        save(); renderMapMarkers();
      });
      const connection = nap
        ? `${esc(nap.id)} · port ${esc(client.port || '—')}`
        : 'Not connected to a NAP';
      marker.setPopup(new mapboxgl.Popup({ offset: 20 }).setHTML(`
        <b>${esc(client.name)}</b><br>
        <span style="font-size:11px;color:#94a3b8">${esc(client.plan || '')}</span><br>
        <span style="font-size:11px;color:#94a3b8">${connection}</span><br><br>
        <button onclick="openClientFromMap(${esc(JSON.stringify(client.id))})"
          style="background:#3b82f6;color:#fff;border:none;padding:6px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">
          Edit Client
        </button>`));
      mapMarkers[`client:${client.id}`] = marker;
    });
  }

  /* =========================================================================
     NAVIGATION FROM MAP
     ========================================================================= */

  function openSplitterFromMap(id) {
    state.view = 'splitter';
    state.selectedNapId = id;
    render();
  }
  window.openSplitterFromMap = openSplitterFromMap;

  function openClientFromMap(id) {
    setTab('clients');
    openForm('clients', id);
  }
  window.openClientFromMap = openClientFromMap;

  function focusNapBoxOnMap(id) {
    const box = DB().napBoxes.find((item) => String(item.id) === String(id));
    if (!box || box.lat === '' || box.lat == null ||
        box.lng === '' || box.lng == null ||
        !Number.isFinite(Number(box.lat)) || !Number.isFinite(Number(box.lng))) {
      toast('This NAP box has no valid map coordinates');
      return;
    }
    state.view = 'map';
    state.mapFocus = { lat: Number(box.lat), lng: Number(box.lng) };
    setTab('naps');
  }

  /* =========================================================================
     MODALS
     ========================================================================= */

  function openClientHouseForm(lat, lng) {
    const coordinates = {
      lat: Number(lat).toFixed(6),
      lng: Number(lng).toFixed(6),
    };
    if (!DB().clients.length) {
      openForm('clients', null, coordinates);
      return;
    }
    state.pendingClientHouse = coordinates;
    document.getElementById('modal').innerHTML = `
      <div class="modal-head">
        <h2>Place Client House</h2>
        <button class="btn sm" data-act="closeModal">✕</button>
      </div>
      <label class="field"><span>Choose Client</span>
        <select id="houseClientPicker">
          ${DB().clients.map((c) =>
            `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.pppoe || c.id)}</option>`
          ).join('')}
        </select>
      </label>
      <div class="note">The map location will be saved on this client. Assign a NAP box and port in the next form to connect it.</div>
      <div class="modal-actions">
        <button type="button" class="btn" data-act="closeModal">Cancel</button>
        <button type="button" class="btn" data-act="newHouseClient">New Client</button>
        <button type="button" class="btn primary" data-act="continueHouse">Continue</button>
      </div>`;
    document.getElementById('backdrop').classList.add('open');
  }

  function openPortModal(napId, port) {
    const box = DB().napBoxes.find((b) => b.id === napId);
    if (!box) return;
    const p = DB().napPorts.find((x) =>
      x.napId === napId && Number(x.port) === Number(port));
    const curClient = p && p.clientId
      ? DB().clients.find((c) => c.id === p.clientId) : null;
    const status = p ? p.status : 'Free';
    const clientOptions = DB().clients.map((c) =>
      `<option value="${esc(c.id)}" ${curClient && curClient.id === c.id ? 'selected' : ''}>${esc(c.id)} — ${esc(c.name)}</option>`
    ).join('');

    document.getElementById('modal').innerHTML = `
      <div class="modal-head">
        <h2>${esc(box.id)} · Port ${port}</h2>
        <button class="btn sm" data-act="closeModal">✕</button>
      </div>
      <form id="portForm">
        <input type="hidden" name="napId" value="${esc(napId)}">
        <input type="hidden" name="port" value="${port}">
        <label class="field"><span>Port Status</span>
          <select name="status">
            <option value="Free"     ${status === 'Free'     ? 'selected' : ''}>Free / Available</option>
            <option value="Used"     ${status === 'Used'     ? 'selected' : ''}>Used / Connected</option>
            <option value="Reserved" ${status === 'Reserved' ? 'selected' : ''}>Reserved</option>
            <option value="Faulty"   ${status === 'Faulty'   ? 'selected' : ''}>Faulty / Broken</option>
          </select>
        </label>
        <label class="field"><span>Assign Client (optional)</span>
          <select name="clientId">
            <option value="">— none —</option>
            ${clientOptions}
          </select>
        </label>
        <label class="field"><span>Notes</span>
          <input name="notes" value="${esc(p ? p.notes : '')}">
        </label>
        <div class="modal-actions">
          <button type="button" class="btn" data-act="closeModal">Cancel</button>
          <button type="submit" class="btn primary">Save Port</button>
        </div>
      </form>`;

    document.getElementById('backdrop').classList.add('open');

    document.getElementById('portForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const napId = fd.get('napId');
      const portNum = Number(fd.get('port'));
      const newStatus = fd.get('status');
      const selectedClientId = fd.get('clientId');
      const clientId = newStatus === 'Used' ? selectedClientId : '';
      const notes = fd.get('notes');

      if (newStatus === 'Used' && !clientId) { toast('Choose a client for a used port'); return; }
      if (clientId) {
        const err = clientPortError({ napId, port: portNum }, clientId);
        if (err) { toast(err); return; }
      }

      let rec = DB().napPorts.find((x) =>
        x.napId === napId && Number(x.port) === portNum);
      const oldClientId = rec ? rec.clientId : '';
      if (!rec) {
        rec = { id: `NP-${napId}-${portNum}`, napId, port: portNum,
                clientId: '', status: 'Free', notes: '' };
        DB().napPorts.push(rec);
      }
      if (newStatus === 'Used' && clientId) {
        DB().clients.forEach((c) => {
          if (c.id === clientId) {
            if (c.napId && Number(c.port) &&
                (c.napId !== napId || Number(c.port) !== portNum)) {
              const old = DB().napPorts.find((x) =>
                x.napId === c.napId && Number(x.port) === Number(c.port));
              if (old) { old.clientId = ''; old.status = 'Free'; }
            }
            c.napId = napId; c.port = portNum;
          }
        });
      }
      if (oldClientId && oldClientId !== clientId) {
        const oldC = DB().clients.find((c) => c.id === oldClientId);
        if (oldC && oldC.napId === napId && Number(oldC.port) === portNum) {
          oldC.napId = ''; oldC.port = '';
        }
      }
      if (clientId) {
        const newC = DB().clients.find((c) => c.id === clientId);
        if (newC) { newC.napId = napId; newC.port = portNum; }
      }
      rec.clientId = (newStatus === 'Used' && clientId) ? clientId : '';
      rec.status = newStatus === 'Used' && !clientId ? 'Free' : newStatus;
      rec.notes = notes;

      save(); closeModal(); render();
      toast('Port updated');
    });
  }

  function openClientPortModal(clientId) {
    const client = DB().clients.find((c) => c.id === clientId);
    if (!client) return;

    if (!DB().napBoxes.length) {
      document.getElementById('modal').innerHTML = `
        <div class="modal-head">
          <h2>Connect ${esc(client.name)}</h2>
          <button class="btn sm" data-act="closeModal">✕</button>
        </div>
        <p class="muted">Add a NAP box and its port count before connecting a customer.</p>
        <div class="modal-actions">
          <button type="button" class="btn" data-act="closeModal">Cancel</button>
          <button type="button" class="btn primary" data-act="goNaps">Go to NAP Boxes</button>
        </div>`;
      document.getElementById('backdrop').classList.add('open');
      return;
    }

    const getAvailablePorts = (napId) => {
      const box = DB().napBoxes.find((item) => item.id === napId);
      if (!box) return [];
      return Array.from({ length: num(box.totalPorts) }, (_, i) => i + 1).filter((port) => {
        const other = DB().clients.find((c) =>
          c.id !== client.id && c.napId === napId && Number(c.port) === port);
        if (other) return false;
        const rec = DB().napPorts.find((x) =>
          x.napId === napId && Number(x.port) === port);
        if (rec && rec.clientId && rec.clientId !== client.id) return false;
        if (rec && rec.clientId !== client.id && rec.status !== 'Free') return false;
        return true;
      });
    };

    const boxOptions = DB().napBoxes.map((box) =>
      `<option value="${esc(box.id)}" ${box.id === client.napId ? 'selected' : ''}>${esc(box.id)}${box.label ? ` · ${esc(box.label)}` : ''}</option>`
    ).join('');

    document.getElementById('modal').innerHTML = `
      <div class="modal-head">
        <h2>Connect ${esc(client.name)}</h2>
        <button class="btn sm" data-act="closeModal">✕</button>
      </div>
      <form id="clientPortForm">
        <label class="field"><span>NAP Box</span>
          <select name="napId" required>${boxOptions}</select>
        </label>
        <label class="field"><span>Available Port</span>
          <select name="port" required></select>
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

    const updatePorts = () => {
      const available = getAvailablePorts(napSelect.value);
      const currentPort = client.napId === napSelect.value ? Number(client.port) : 0;
      portSelect.innerHTML = available.length
        ? `<option value="">— choose available port —</option>${available.map((port) =>
            `<option value="${port}" ${port === currentPort ? 'selected' : ''}>Port ${port}${port === currentPort ? ' · current' : ''}</option>`
          ).join('')}`
        : '<option value="">No available ports</option>';
      portSelect.disabled = available.length === 0;
      help.textContent = available.length
        ? `${available.length} available port${available.length === 1 ? '' : 's'} on this box.`
        : 'This NAP box has no available ports.';
    };
    napSelect.addEventListener('change', updatePorts);
    updatePorts();
    document.getElementById('backdrop').classList.add('open');

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const napId = napSelect.value;
      const port = Number(portSelect.value);
      const err = clientPortError({ napId, port }, client.id);
      if (err) { toast(err); return; }

      const old = { ...client };
      client.napId = napId;
      client.port = port;
      syncClientPort(client, old);
      save(); closeModal(); render();
      toast(`Connected to ${napId} · port ${port}`);
    });
  }

  /* =========================================================================
     EVENT ROUTER
     ========================================================================= */

  function onClick(e) {
    // Subtab: Grid / Map / Splitter
    const napViewBtn = e.target.closest('[data-napview]');
    if (napViewBtn) {
      state.mapPlaceClient = false;
      state.view = napViewBtn.dataset.napview;
      render();
      return true;
    }

    // Splitter open button on a grid card
    const splitterBtn = e.target.closest('[data-act="viewSplitter"]');
    if (splitterBtn) {
      state.view = 'splitter';
      state.selectedNapId = splitterBtn.dataset.id;
      render();
      return true;
    }

    // Port cell in the splitter
    const portCell = e.target.closest('[data-act="openPort"]');
    if (portCell) {
      openPortModal(portCell.dataset.napid, Number(portCell.dataset.port));
      return true;
    }

    const act = e.target.closest('[data-act]');
    if (!act) return false;

    switch (act.dataset.act) {
      case 'connectClient':
        openClientPortModal(act.dataset.id);
        return true;

      case 'goNaps':
        closeModal();
        setTab('naps');
        return true;

      case 'continueHouse': {
        const clientId = document.getElementById('houseClientPicker').value;
        const coordinates = state.pendingClientHouse;
        state.pendingClientHouse = null;
        if (coordinates) openForm('clients', clientId, coordinates);
        return true;
      }

      case 'newHouseClient': {
        const coordinates = state.pendingClientHouse;
        state.pendingClientHouse = null;
        if (coordinates) openForm('clients', null, coordinates);
        return true;
      }

      case 'placeNapBoxAtMap':
      case 'placeClientAtMap': {
        const coordinates = state.mapContextLocation;
        const menu = document.getElementById('mapContextMenu');
        if (menu) menu.hidden = true;
        state.mapContextLocation = null;
        if (!coordinates) return true;
        if (act.dataset.act === 'placeNapBoxAtMap') {
          openForm('napBoxes', null, coordinates);
        } else {
          openClientHouseForm(coordinates.lat, coordinates.lng);
        }
        return true;
      }

      case 'focusNapMap':
        focusNapBoxOnMap(act.dataset.id);
        return true;

      case 'addClientHouse':
        state.mapPlaceClient = true;
        state.view = 'map';
        setTab('naps');
        toast('Tap the map to place the house');
        return true;
    }
    return false;
  }

  function onChange(e) {
    if (e.target.id === 'napPicker') {
      state.selectedNapId = e.target.value;
      render();
      return true;
    }
    return false;
  }

  function resetState() {
    state.view = 'grid';
    state.selectedNapId = null;
    state.mapFocus = null;
    state.mapPlaceClient = false;
    state.mapContextLocation = null;
    state.pendingClientHouse = null;
    if (mapInstance) { try { mapInstance.remove(); } catch (_) {} }
    mapInstance = null;
    mapEngine = null;
    leafletMapOverlays = null;
    mapMarkers = {}; mapLines = []; mapLineEvents = [];
    mapHoverPopup = null;
  }

  /* =========================================================================
     PUBLIC API
     ========================================================================= */

  window.NAP = {
    state,
    init(d)          { deps = d; },
    page:            pageNaps,
    initMap,
    onClick,
    onChange,
    stats:           napStats,
    ensurePorts,
    syncClientPort,
    clientPortError,
    openPortModal,
    openClientPortModal,
    resetState,
  };
})();
