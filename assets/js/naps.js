/* =========================================================
   NAP BOXES
   ========================================================= */
function pageNaps(){
  const nav = `
    <div class="subtabs">
      <button class="subtab ${state.napView==='grid'?'active':''}" data-napview="grid">📋 Grid</button>
      <button class="subtab ${state.napView==='map'?'active':''}" data-napview="map">🗺 Map</button>
      <button class="subtab ${state.napView==='splitter'?'active':''}" data-napview="splitter">🔌 Splitter</button>
    </div>`;

  let body = '';
  if(state.napView==='grid') body = napGridView();
  else if(state.napView==='map') body = napMapView();
  else body = napSplitterView();

  return `
  <div class="page-head">
    <h1>NAP Boxes <span class="muted small">(${DB.napBoxes.length})</span></h1>
    <button class="btn" data-act="addClientHouse">🏠 Add Client House</button>
    <button class="btn primary" data-act="add" data-table="napBoxes">+ Add NAP Box</button>
  </div>
  ${nav}
  ${body}
  `;
}

function napGridView(){
  const boxes = DB.napBoxes;
  const cards = boxes.map(b=>{
    const s = napStats(b);
    const pct = s.total ? Math.round(s.used/s.total*100) : 0;
    const cls = s.free<=2 ? 'full' : s.free<=4 ? 'warn' : 'ok';
    const hasCoordinates = b.lat!=='' && b.lat!=null && b.lng!=='' && b.lng!=null &&
      Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng));
    const portChips = s.ports.map(p=>{
      const c = DB.clients.find(x=>x.id===p.clientId);
      const label = p.status==='Used' && c ? c.name.split(' ')[0] : p.status;
      return `<div class="port ${p.status.toLowerCase()}" title="Port ${p.port} — ${esc(label)}">
        <span class="n">${p.port}</span>${esc(label)}
      </div>`;
    }).join('');

    return `
    <div class="card">
      <div class="card-head">
        <h2>${esc(b.id)} <span class="muted small">${esc(b.label||'')}</span></h2>
        <span class="badge ${s.free<=2?'b-red':s.free<=4?'b-amber':'b-green'}">${s.free} free</span>
      </div>
      <div class="small muted mb-8">
        📍 ${esc(b.address||'')}${b.landmark?` · ${esc(b.landmark)}`:''}
        ${hasCoordinates?` · ${b.lat}, ${b.lng} · <button class="map-link" type="button" data-act="focusNapMap" data-id="${esc(b.id)}">map</button>`:''}
      </div>
      <div class="bar ${cls}"><span style="width:${pct}%"></span></div>
      <div class="flex small muted mt-6">
        <span>${s.used}/${s.total} used</span><span>·</span>
        <span>${s.free} free</span>
        ${s.faulty?`<span>· <span class="text-red">${s.faulty} faulty</span></span>`:''}
        <span class="spacer"></span>
        <span>${esc(b.splitter||'')} · ${esc(b.upstreamId||b.upstream||'')}</span>
      </div>
      <div class="ports">${portChips}</div>
      <div class="flex mt-12">
        <button class="btn sm" data-act="edit" data-table="napBoxes" data-id="${esc(b.id)}">Edit Box</button>
        <button class="btn sm" data-act="viewSplitter" data-id="${esc(b.id)}">View Splitter</button>
        <span class="spacer"></span>
        <button class="btn sm danger" data-act="del" data-table="napBoxes" data-id="${esc(b.id)}">✕</button>
      </div>
      ${b.route?`<div class="note mt-10">🔧 ${esc(b.route)}</div>`:''}
    </div>`;
  }).join('');

  return cards || `<div class="card"><div class="empty"><div class="big">🔌</div>No NAP boxes yet.</div></div>`;
}

function napMapView(){
  return `
  <div class="map-bar">
    <input id="mapSearchInput" type="search" autocomplete="off"
      aria-label="Search map" placeholder="Search a place, client, NAP box, or coordinates">
    <button class="btn sm primary" type="button" data-act="searchMap">⌕ Search map</button>
  </div>
  <div class="map-bar">
    <button class="btn sm" type="button" data-act="placeNapCenter">＋ Place NAP Box at map center</button>
    <input id="napCoordinatesInput" type="text" inputmode="decimal" autocomplete="off"
      aria-label="Paste NAP box coordinates" placeholder="Paste coordinates: 14.998828, 120.891659"
      style="width:min(310px,100%)">
    <button class="btn sm" type="button" data-act="pasteNapCoordinates">📋 Paste</button>
    <button class="btn sm" type="button" data-act="placeNapCoordinates">＋ Use pasted location</button>
  </div>
  <div id="mapWrap">
    <div id="map"></div>
    <div class="map-status" id="mapStatus" role="status" aria-live="polite" hidden></div>
    <div class="map-cross" id="mapCenterPin" aria-hidden="true" ${state.mapPlaceNap?'':'hidden'}>📍</div>
    <div class="map-confirm" id="mapCenterConfirm" ${state.mapPlaceNap?'':'hidden'}>
      <button class="btn primary" type="button" data-act="confirmNapCenter">✓ Place here</button>
      <button class="btn" type="button" data-act="cancelNapCenter">Cancel</button>
    </div>
    <div class="map-context-menu" id="mapContextMenu" role="menu" hidden>
      <button class="btn sm" type="button" data-act="placeNapBoxAtMap">＋ Add NAP Box here</button>
      <button class="btn sm" type="button" data-act="placeClientAtMap">⌂ Add Client here</button>
      <button class="btn sm danger" type="button" data-act="deleteMapTarget" hidden>🗑 Delete</button>
    </div>
    <div class="map-help">
      <b>Map</b><br>
      Use the center-pin button to place a NAP box by panning the map beneath the pin. Right-click to add at a location. NAP markers remain attached to their GPS coordinates.
      <div class="mt-8"><button class="btn sm" id="map3dToggle" type="button">Enable 3D</button></div>
    </div>
    <div class="map-overlay">
      <b>Legend</b>
      <div class="row"><span class="home-marker" style="width:18px;height:18px;font-size:10px">🏠</span> Home Base / OLT</div>
      <div class="row"><span class="napbox-map-icon" style="width:22px;height:22px">${NAPBOX_ICON_SVG}</span> NAP box</div>
      <div class="row"><span style="display:inline-block;width:22px;border-top:2px dashed #3b82f6"></span> Uplink</div>
      <div class="row"><span class="client-house-marker" style="width:18px;height:18px;font-size:10px">⌂</span> Client house</div>
      <div class="row"><span style="display:inline-block;width:22px;border-top:2px dashed #22c55e"></span> Client drop
      </div>
    </div>
  </div>`;
}

function showMapContextMenuGlobal(point, lat, lng, target=null){
  const menu = document.getElementById('mapContextMenu');
  const wrap = document.getElementById('mapWrap');
  if(!menu || !wrap) return;
  state.mapContextLocation = {lat:Number(lat).toFixed(6), lng:Number(lng).toFixed(6)};
  state.mapContextTarget = target;
  const deleteAction = menu.querySelector('[data-act="deleteMapTarget"]');
  if(deleteAction) deleteAction.hidden = !target;
  menu.hidden = false;
  const maxLeft = Math.max(0, wrap.clientWidth-menu.offsetWidth-8);
  const maxTop = Math.max(0, wrap.clientHeight-menu.offsetHeight-8);
  menu.style.left = `${Math.min(Math.max(point.x,8),maxLeft)}px`;
  menu.style.top = `${Math.min(Math.max(point.y,8),maxTop)}px`;
}

function hideMapContextMenuGlobal(){
  const menu = document.getElementById('mapContextMenu');
  if(menu) menu.hidden = true;
  state.mapContextLocation = null;
  state.mapContextTarget = null;
}

const MAP_LIBRARIES = {
  leaflet:{
    global:'L',
    css:{href:'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
      integrity:'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H'},
    js:{src:'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
      integrity:'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH'}
  },
  mapbox:{
    global:'mapboxgl',
    css:{href:'https://api.mapbox.com/mapbox-gl-js/v3.12.0/mapbox-gl.css',
      integrity:'sha384-Sdx78Z6nqVgiCnAlgCe5s/P74CeyLMH/hI61WTXUO7kbN/HJ81e3MAkMTz1jxsm+'},
    js:{src:'https://api.mapbox.com/mapbox-gl-js/v3.12.0/mapbox-gl.js',
      integrity:'sha384-/TrjtPGu/gYA2W0pthEIcd2shlv/VWamCvc9tZ776cfv6X9dyG34BWLygYZeItjZ'}
  }
};
const mapLibraryPromises = {};

// Map libraries are large, so they are fetched (with integrity checks) only when the map is opened.
function loadMapLibrary(name){
  const library = MAP_LIBRARIES[name];
  if(window[library.global]) return Promise.resolve();
  if(mapLibraryPromises[name]) return mapLibraryPromises[name];
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = library.css.href;
  css.integrity = library.css.integrity;
  css.crossOrigin = 'anonymous';
  document.head.appendChild(css);
  mapLibraryPromises[name] = new Promise((resolve,reject)=>{
    const script = document.createElement('script');
    script.src = library.js.src;
    script.integrity = library.js.integrity;
    script.crossOrigin = 'anonymous';
    script.onload = ()=>resolve();
    script.onerror = ()=>{
      script.remove();
      delete mapLibraryPromises[name];
      reject(new Error(`Could not load ${name}`));
    };
    document.head.appendChild(script);
  });
  return mapLibraryPromises[name];
}

async function initMap(){
  const el = document.getElementById('map');
  if(!el) return;
  const initToken = ++mapInitToken;
  const status = document.getElementById('mapStatus');
  const showMapStatus = (title, message)=>{
    if(!status) return;
    status.innerHTML = `<strong>${esc(title)}</strong>${esc(message)}`;
    status.hidden = false;
  };
  const hideMapStatus = ()=>{
    if(status) status.hidden = true;
  };
  const hideMapContextMenu = ()=>{
    hideMapContextMenuGlobal();
  };
  const hb = DB.settings.homeBase;
  let mapCenter = mapViewport ? [mapViewport.lat, mapViewport.lng] : [Number(hb.lat), Number(hb.lng)];
  let mapZoom = mapViewport ? mapViewport.zoom : 15;
  if(mapInstance){
    mapInstance.remove();
    mapInstance = null;
  }
  mapMarkers = {};
  mapLines = [];
  mapLineEvents = [];
  mapHoverPopup = null;
  if(state.mapFocus){
    mapCenter = [Number(state.mapFocus.lat), Number(state.mapFocus.lng)];
    mapZoom = 18;
    mapViewport = null;
  }
  mapEngine = null;
  mapboxAccessToken = null;
  leafletMapOverlays = null;
  showMapStatus('Loading map…', 'Connecting to the map service.');
  try{
    const response = await fetch('/api/config');
    if(!response.ok) throw new Error('Could not load map configuration');
    const config = await response.json();
    mapboxAccessToken = config.mapboxAccessToken || null;
    if(initToken!==mapInitToken || document.getElementById('map')!==el) return;
    if(!mapboxAccessToken){
      await loadMapLibrary('leaflet').catch(error=>console.warn(error));
      if(initToken!==mapInitToken || document.getElementById('map')!==el) return;
      if(typeof L==='undefined'){
        showMapStatus('Map library unavailable', 'Allow network access to unpkg.com and reload the page.');
        return;
      }
      mapEngine = 'leaflet';
      mapInstance = L.map(el, {zoomControl:false}).setView(mapCenter, mapZoom);
      state.mapFocus = null;
      mapInstance.on('moveend', ()=>{
        const center = mapInstance.getCenter();
        mapViewport = {lat:center.lat, lng:center.lng, zoom:mapInstance.getZoom()};
      });
      const tiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom:19,
        attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      }).addTo(mapInstance);
      let tilesLoaded = false;
      tiles.on('tileload', ()=>{
        tilesLoaded = true;
        hideMapStatus();
      });
      tiles.on('tileerror', ()=>{
        if(!tilesLoaded) showMapStatus('Map tiles unavailable', 'Check your internet connection and allow basemaps.cartocdn.com.');
      });
      L.control.zoom({position:'topright'}).addTo(mapInstance);
      leafletMapOverlays = L.layerGroup().addTo(mapInstance);
      mapInstance.on('contextmenu', event=>{
        event.originalEvent.preventDefault();
        const marker = event.originalEvent.target.closest('.leaflet-marker-icon');
        const mapTarget = marker?.dataset.mapTable && marker?.dataset.mapId
          ? {table:marker.dataset.mapTable,id:marker.dataset.mapId}
          : null;
        showMapContextMenuGlobal(event.containerPoint, event.latlng.lat, event.latlng.lng, mapTarget);
      });
      mapInstance.on('click', hideMapContextMenu);
      const map3dButton = document.getElementById('map3dToggle');
      if(map3dButton) map3dButton.hidden = true;
      renderLeafletMapMarkers();
      if(state.mapPlaceClient){
        mapInstance.once('click', event=>{
          state.mapPlaceClient = false;
          openClientHouseForm(event.latlng.lat, event.latlng.lng);
        });
      }
      if(!tilesLoaded) showMapStatus('Loading map…', 'Loading dark map tiles.');
      mapInstance.invalidateSize();
      return;
    }
    await loadMapLibrary('mapbox').catch(error=>console.warn(error));
    if(initToken!==mapInitToken || document.getElementById('map')!==el) return;
    if(typeof mapboxgl==='undefined'){
      showMapStatus('Map library unavailable', 'Allow network access to api.mapbox.com and reload the page.');
      return;
    }
    mapEngine = 'mapbox';
    mapboxgl.accessToken = mapboxAccessToken;
    mapInstance = new mapboxgl.Map({
      container:el,
      style:'mapbox://styles/mapbox/dark-v11',
      center:[mapCenter[1], mapCenter[0]],
      zoom:mapZoom,
      pitch:state.map3d ? 55 : 0,
      antialias:true
    });
    state.mapFocus = null;
    mapInstance.on('moveend', ()=>{
      if(initToken!==mapInitToken || document.getElementById('map')!==el) return;
      const center = mapInstance.getCenter();
      mapViewport = {lat:center.lat, lng:center.lng, zoom:mapInstance.getZoom()};
    });
    let mapLoaded = false;
    mapInstance.on('error', event=>{
      if(initToken!==mapInitToken || mapLoaded || document.getElementById('map')!==el) return;
      const error = event.error || {};
      const statusCode = Number(error.status);
      if(statusCode===401 || statusCode===403){
        showMapStatus('Mapbox rejected the token', 'Check that MAPBOX_ACCESS_TOKEN is valid, is a public pk. token, and allows this site’s domain.');
      }else{
        showMapStatus('Map could not load', 'Check the public token, its allowed URL restrictions, and the connection to Mapbox.');
      }
      console.error('Mapbox map error', error);
    });
    mapInstance.addControl(new mapboxgl.NavigationControl({visualizePitch:true}), 'top-right');
    mapHoverPopup = new mapboxgl.Popup({closeButton:false, closeOnClick:false, offset:8});
    mapInstance.on('contextmenu', event=>{
      event.originalEvent.preventDefault();
      const marker = event.originalEvent.target.closest('.mapboxgl-marker');
      const mapTarget = marker?.dataset.mapTable && marker?.dataset.mapId
        ? {table:marker.dataset.mapTable,id:marker.dataset.mapId}
        : null;
      showMapContextMenuGlobal(event.point, event.lngLat.lat, event.lngLat.lng, mapTarget);
    });
    mapInstance.on('click', hideMapContextMenu);
    mapInstance.on('load', ()=>{
      if(initToken!==mapInitToken || document.getElementById('map')!==el) return;
      mapLoaded = true;
      hideMapStatus();
      try{ addMapBuildings(); }
      catch(error){ console.warn('3D buildings layer could not be added', error); }
      renderMapMarkers();
      setMap3dMode(state.map3d, false);
      if(state.mapPlaceClient){
        mapInstance.once('click', event=>{
          state.mapPlaceClient = false;
          openClientHouseForm(event.lngLat.lat, event.lngLat.lng);
        });
      }
      document.getElementById('map3dToggle')?.addEventListener('click', ()=>setMap3dMode(!state.map3d));
      mapInstance.resize();
    });
  }catch(error){
    console.error('Mapbox failed to load', error);
    showMapStatus('Map could not start', 'Check MAPBOX_ACCESS_TOKEN and allow this site’s domain in your Mapbox token settings.');
  }
}

function renderLeafletMapMarkers(){
  if(mapEngine!=='leaflet' || !mapInstance || !leafletMapOverlays) return;
  leafletMapOverlays.clearLayers();
  mapMarkers = {};
  const hb = DB.settings.homeBase;
  const addLine = (start, end, color, dashed, tooltip)=>{
    L.polyline([start,end], {
      color,
      weight:dashed ? 2 : 3,
      opacity:0.8,
      dashArray:dashed ? '6 6' : null
    }).bindTooltip(esc(tooltip)).addTo(leafletMapOverlays);
  };
  const makeMarker = (key, element, lat, lng, popup, onDrag)=>{
    const isNapBox = element.classList.contains('napbox-map-marker');
    const isClient = key.startsWith('client:');
    if(isNapBox || isClient){
      element.dataset.mapTable = isNapBox ? 'napBoxes' : 'clients';
      element.dataset.mapId = isNapBox ? key : key.slice('client:'.length);
    }
    const marker = L.marker([Number(lat),Number(lng)], {
      draggable:!isNapBox,
      icon:L.divIcon({
        className:'',
        html:element.outerHTML,
        iconSize:isNapBox ? [52,60] : null,
        iconAnchor:isNapBox ? [26,58] : [16,16]
      })
    }).addTo(leafletMapOverlays);
    marker.bindPopup(popup);
    if(isNapBox || isClient){
      marker.on('contextmenu', event=>{
        event.originalEvent.preventDefault();
        event.originalEvent.stopPropagation();
        showMapContextMenuGlobal(event.containerPoint, event.latlng.lat, event.latlng.lng, {
          table:isNapBox?'napBoxes':'clients',
          id:isNapBox?key:key.slice('client:'.length)
        });
      });
    }
    if(!isNapBox) marker.on('dragend', ()=>{
      const point = marker.getLatLng();
      onDrag(point);
    });
    mapMarkers[key] = marker;
    return marker;
  };

  const homeElement = document.createElement('div');
  homeElement.className = 'home-marker';
  homeElement.textContent = '🏠';
  makeMarker('home', homeElement, hb.lat, hb.lng,
    `<b>${esc(hb.name)}</b><br><span class="small muted">Drag to reposition</span>`,
    point=>{
      DB.settings.homeBase.lat = point.lat;
      DB.settings.homeBase.lng = point.lng;
      save(); renderLeafletMapMarkers();
    }
  );

  DB.napBoxes.forEach(box=>{
    if(!hasMapCoordinates(box)) return;
    let sourceLat = hb.lat, sourceLng = hb.lng, uplinkName = hb.name;
    if(box.uplinkId){
      const parent = DB.napBoxes.find(item=>item.id===box.uplinkId);
      if(parent && parent.lat!=='' && parent.lng!==''){
        sourceLat = parent.lat; sourceLng = parent.lng; uplinkName = parent.label || parent.id;
      }
    }
    const distance = getDistanceStr(sourceLat, sourceLng, box.lat, box.lng);
    addLine([Number(sourceLat),Number(sourceLng)], [Number(box.lat),Number(box.lng)],
      box.color || '#3b82f6', Boolean(box.uplinkId), distance);

    const element = document.createElement('div');
    element.innerHTML = napBoxMarkerMarkup(box.id);
    const napMarker = element.firstElementChild;
    const popup = `
      <b>${esc(box.id)}</b><br>
      <span class="popup-meta">${esc(box.label||'')}</span><br>
      <span class="popup-meta">Uplink: ${esc(uplinkName)} · ${esc(distance)}</span><br><br>
      <button class="popup-btn" onclick="openSplitterFromMap('${esc(box.id)}')">
        Open Splitter
      </button>`;
    makeMarker(box.id, napMarker, box.lat, box.lng, popup, point=>{
      const current = DB.napBoxes.find(item=>item.id===box.id);
      if(current){ current.lat = point.lat; current.lng = point.lng; save(); renderLeafletMapMarkers(); }
    });
  });

  DB.clients.forEach(client=>{
    if(client.lat==='' || client.lng==='' || client.lat==null || client.lng==null ||
       !Number.isFinite(Number(client.lat)) || !Number.isFinite(Number(client.lng))) return;
    const lat = Number(client.lat), lng = Number(client.lng);
    const nap = DB.napBoxes.find(box=>box.id===client.napId);
    if(nap && nap.lat!=='' && nap.lng!=='' && Number.isFinite(Number(nap.lat)) && Number.isFinite(Number(nap.lng))){
      addLine([Number(nap.lat),Number(nap.lng)], [lat,lng], '#22c55e', true,
        `Client drop · ${getDistanceStr(nap.lat,nap.lng,lat,lng)}`);
    }
    const element = document.createElement('div');
    element.className = 'client-house-marker';
    element.textContent = '⌂';
    const connection = nap ? `${esc(nap.id)} · port ${esc(client.port||'—')}` : 'Not connected to a NAP';
    const popup = `
      <b>${esc(client.name)}</b><br>
      <span class="popup-meta">${esc(client.plan||'')}</span><br>
      <span class="popup-meta">${connection}</span><br><br>
      <button class="popup-btn" onclick="openClientFromMap(${esc(JSON.stringify(client.id))})">
        Edit Client
      </button>
      <button class="popup-btn popup-btn-danger" onclick="deleteRecord('clients',${esc(JSON.stringify(client.id))})">
        Delete Client
      </button>`;
    makeMarker(`client:${client.id}`, element, lat, lng, popup, point=>{
      client.lat = point.lat;
      client.lng = point.lng;
      save(); renderLeafletMapMarkers();
    });
  });
}

function addMapBuildings(){
  if(mapInstance.getLayer('napbox-3d-buildings')) return;
  mapInstance.addLayer({
    id:'napbox-3d-buildings',
    source:'composite',
    'source-layer':'building',
    filter:['==',['get','extrude'],'true'],
    minzoom:15,
    type:'fill-extrusion',
    paint:{
      'fill-extrusion-color':'#94a3b8',
      'fill-extrusion-height':['interpolate',['linear'],['zoom'],15,0,['get','height']],
      'fill-extrusion-base':['interpolate',['linear'],['zoom'],15,0,['get','min_height']],
      'fill-extrusion-opacity':0.72
    }
  });
}

function setMap3dMode(enabled, animate=true){
  if(!mapInstance) return;
  state.map3d = enabled;
  mapInstance.easeTo({pitch:enabled ? 55 : 0, duration:animate ? 500 : 0});
  if(mapInstance.getLayer('napbox-3d-buildings')){
    mapInstance.setLayoutProperty('napbox-3d-buildings', 'visibility', enabled ? 'visible' : 'none');
  }
  const button = document.getElementById('map3dToggle');
  if(button) button.textContent = enabled ? 'Enable 2D' : 'Enable 3D';
}

function addMapLine(coordinates, color, dashed, tooltip){
  const id = `napbox-line-${mapLines.length}`;
  const layerId = `${id}-layer`;
  mapInstance.addSource(id, {
    type:'geojson',
    data:{type:'Feature', geometry:{type:'LineString', coordinates}, properties:{}}
  });
  mapInstance.addLayer({
    id:layerId,
    type:'line',
    source:id,
    paint:{
      'line-color':color,
      'line-width':dashed ? 2 : 3,
      'line-opacity':0.8,
      ...(dashed ? {'line-dasharray':[2,2]} : {})
    }
  });
  const onEnter = event=>{
    mapInstance.getCanvas().style.cursor = 'pointer';
    mapHoverPopup.setLngLat(event.lngLat).setHTML(`<span class="small">${esc(tooltip)}</span>`).addTo(mapInstance);
  };
  const onLeave = ()=>{
    mapInstance.getCanvas().style.cursor = '';
    mapHoverPopup.remove();
  };
  mapInstance.on('mouseenter', layerId, onEnter);
  mapInstance.on('mouseleave', layerId, onLeave);
  mapLineEvents.push({layerId, onEnter, onLeave});
  mapLines.push(id);
}

function renderMapMarkers(){
  if(!mapInstance) return;
  if(mapEngine==='leaflet'){
    renderLeafletMapMarkers();
    return;
  }
  Object.values(mapMarkers).forEach(marker=>marker.remove());
  mapLineEvents.forEach(({layerId,onEnter,onLeave})=>{
    mapInstance.off('mouseenter', layerId, onEnter);
    mapInstance.off('mouseleave', layerId, onLeave);
  });
  mapLines.forEach(id=>{
    const layerId = `${id}-layer`;
    if(mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId);
    if(mapInstance.getSource(id)) mapInstance.removeSource(id);
  });
  mapMarkers = {}; mapLines = []; mapLineEvents = [];

  const hb = DB.settings.homeBase;
  const homeElement = document.createElement('div');
  homeElement.className = 'home-marker';
  homeElement.textContent = '🏠';
  const homeMarker = new mapboxgl.Marker({element:homeElement, draggable:true, anchor:'center'})
    .setLngLat([Number(hb.lng), Number(hb.lat)])
    .setPopup(new mapboxgl.Popup({offset:20}).setHTML(`<b>${esc(hb.name)}</b><br><span class="small muted">Drag to reposition</span>`))
    .addTo(mapInstance);
  homeMarker.on('dragend', ()=>{
    const p = homeMarker.getLngLat();
    DB.settings.homeBase.lat = p.lat;
    DB.settings.homeBase.lng = p.lng;
    save(); renderMapMarkers();
  });
  mapMarkers['home'] = homeMarker;

  DB.napBoxes.forEach(box=>{
    if(!hasMapCoordinates(box)) return;
    let sLat = hb.lat, sLng = hb.lng;
    let uplinkName = hb.name;
    if(box.uplinkId){
      const p = DB.napBoxes.find(b=>b.id===box.uplinkId);
      if(p && p.lat && p.lng){ sLat = p.lat; sLng = p.lng; uplinkName = p.name; }
    }
    const dist = getDistanceStr(sLat, sLng, box.lat, box.lng);
    try{
      addMapLine([[Number(sLng),Number(sLat)],[Number(box.lng),Number(box.lat)]], box.color || '#3b82f6', Boolean(box.uplinkId), dist);
    }catch(error){
      console.warn(`Could not draw uplink for NAP box ${box.id}`, error);
    }

    const element = document.createElement('div');
    element.innerHTML = napBoxMarkerMarkup(box.id);
    const markerElement = element.firstElementChild;
    markerElement.dataset.mapTable = 'napBoxes';
    markerElement.dataset.mapId = box.id;
    const m = new mapboxgl.Marker({element:markerElement, draggable:false, anchor:'bottom'})
      .setLngLat([Number(box.lng),Number(box.lat)])
      .addTo(mapInstance);
    markerElement.addEventListener('contextmenu', event=>{
      event.preventDefault();
      event.stopPropagation();
      const point = mapInstance.project(m.getLngLat());
      showMapContextMenuGlobal(point, box.lat, box.lng, {table:'napBoxes',id:box.id});
    });
    m.setPopup(new mapboxgl.Popup({offset:20}).setHTML(`
      <b>${esc(box.id)}</b><br>
      <span class="popup-meta">${esc(box.label||'')}</span><br>
      <span class="popup-meta">Uplink: ${esc(uplinkName)} · ${esc(dist)}</span><br><br>
      <button class="popup-btn" onclick="openSplitterFromMap('${esc(box.id)}')">
        Open Splitter
      </button>
    `));
    mapMarkers[box.id] = m;
  });

  DB.clients.forEach(client=>{
    if(client.lat==='' || client.lng==='' || client.lat==null || client.lng==null ||
       !Number.isFinite(Number(client.lat)) || !Number.isFinite(Number(client.lng))) return;
    const lat = Number(client.lat), lng = Number(client.lng);
    const nap = DB.napBoxes.find(box=>box.id===client.napId);
    if(nap && nap.lat!=='' && nap.lng!=='' && Number.isFinite(Number(nap.lat)) && Number.isFinite(Number(nap.lng))){
      const distance = getDistanceStr(nap.lat, nap.lng, lat, lng);
      addMapLine([[Number(nap.lng),Number(nap.lat)],[lng,lat]], '#22c55e', true, `Client drop · ${distance}`);
    }

    const element = document.createElement('div');
    element.className = 'client-house-marker';
    element.textContent = '⌂';
    element.dataset.mapTable = 'clients';
    element.dataset.mapId = client.id;
    const marker = new mapboxgl.Marker({element, draggable:true, anchor:'center'})
      .setLngLat([lng,lat])
      .addTo(mapInstance);
    element.addEventListener('contextmenu', event=>{
      event.preventDefault();
      event.stopPropagation();
      const point = mapInstance.project(marker.getLngLat());
      showMapContextMenuGlobal(point, lat, lng, {table:'clients',id:client.id});
    });
    marker.on('dragend', ()=>{
      const point = marker.getLngLat();
      client.lat = point.lat;
      client.lng = point.lng;
      save(); renderMapMarkers();
    });
    const connection = nap ? `${esc(nap.id)} · port ${esc(client.port||'—')}` : 'Not connected to a NAP';
    marker.setPopup(new mapboxgl.Popup({offset:20}).setHTML(`
      <b>${esc(client.name)}</b><br>
      <span class="popup-meta">${esc(client.plan||'')}</span><br>
      <span class="popup-meta">${connection}</span><br><br>
      <button class="popup-btn" onclick="openClientFromMap(${esc(JSON.stringify(client.id))})">
        Edit Client
      </button>
      <button class="popup-btn popup-btn-danger" onclick="deleteRecord('clients',${esc(JSON.stringify(client.id))})">
        Delete Client
      </button>
    `));
    mapMarkers[`client:${client.id}`] = marker;
  });
}

function openClientFromMap(id){
  state.tab = 'clients';
  state.search = '';
  render();
  openForm('clients', id);
}

function openClientHouseForm(lat, lng){
  const coordinates = {lat:Number(lat).toFixed(6), lng:Number(lng).toFixed(6)};
  if(!DB.clients.length){ openForm('clients', null, coordinates); return; }
  state.pendingClientHouse = coordinates;
  document.getElementById('modal').innerHTML = `
    <div class="modal-head">
      <h2>Place Client House</h2>
      <button class="btn sm" type="button" data-act="closeModal" aria-label="Close">✕</button>
    </div>
    <label class="field"><span>Choose Client</span>
      <select id="houseClientPicker">
        ${DB.clients.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.pppoe||c.id)}</option>`).join('')}
      </select>
    </label>
    <div class="note">The map location will be saved on this client. Assign a NAP box and port in the next form to connect it.</div>
    <div class="modal-actions">
      <button type="button" class="btn" data-act="closeModal">Cancel</button>
      <button type="button" class="btn" data-act="newHouseClient">New Client</button>
      <button type="button" class="btn primary" data-act="continueHouse">Continue</button>
    </div>`;
  activateDialog('backdrop');
}

function openSplitterFromMap(id){
  state.napView = 'splitter';
  state.selectedNapId = id;
  render();
}

function focusNapBoxOnMap(id){
  const box = DB.napBoxes.find(item=>String(item.id)===String(id));
  if(!box || box.lat==='' || box.lat==null || box.lng==='' || box.lng==null ||
     !Number.isFinite(Number(box.lat)) || !Number.isFinite(Number(box.lng))){
    toast('This NAP box has no valid map coordinates');
    return;
  }
  state.tab = 'naps';
  state.napView = 'map';
  state.mapFocus = {lat:Number(box.lat), lng:Number(box.lng)};
  render();
}

function moveMapToCoordinates(lat, lng, zoom=18){
  if(!mapInstance) return false;
  if(mapEngine==='leaflet') mapInstance.flyTo([lat,lng], zoom);
  else if(mapEngine==='mapbox') mapInstance.flyTo({center:[lng,lat], zoom});
  else return false;
  return true;
}

async function searchMapLocation(){
  const input = document.getElementById('mapSearchInput');
  const query = input?.value.trim();
  if(!query){ toast('Enter a place, client, NAP box, or coordinates to search'); return; }
  if(!mapInstance){ toast('Map is not ready yet'); return; }

  const coordinates = parseCoordinates(query);
  if(coordinates){
    moveMapToCoordinates(Number(coordinates.lat), Number(coordinates.lng));
    return;
  }

  const normalizedQuery = query.toLowerCase();
  const matches = [
    ...DB.clients.map(client=>({
      record:client,
      table:'clients',
      label:`${client.name||''} ${client.id||''} ${client.pppoe||''} ${client.address||''}`
    })),
    ...DB.napBoxes.map(box=>({
      record:box,
      table:'napBoxes',
      label:`${box.label||''} ${box.id||''} ${box.address||''}`
    })),
    {
      record:DB.settings.homeBase,
      table:'homeBase',
      label:`${DB.settings.homeBase.name||''} Home Base OLT`
    }
  ].filter(item=>item.label.toLowerCase().includes(normalizedQuery));

  if(matches.length===1){
    const match = matches[0].record;
    if(!hasMapCoordinates(match)){
      toast('That record does not have valid map coordinates');
      return;
    }
    moveMapToCoordinates(Number(match.lat), Number(match.lng));
    return;
  }
  if(matches.length>1){
    toast('More than one map record matches. Refine your search.');
    return;
  }
  if(!mapboxAccessToken){
    toast('Place search needs Mapbox configuration. Try coordinates or a saved record instead.');
    return;
  }

  try{
    const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`);
    url.searchParams.set('limit','1');
    url.searchParams.set('access_token',mapboxAccessToken);
    const response = await fetch(url);
    if(!response.ok) throw new Error(`Place search failed (${response.status})`);
    const result = await response.json();
    const center = result.features?.[0]?.center;
    if(!Array.isArray(center) || center.length<2 ||
       !Number.isFinite(Number(center[0])) || !Number.isFinite(Number(center[1]))){
      toast('No matching place found');
      return;
    }
    moveMapToCoordinates(Number(center[1]), Number(center[0]));
  }catch(error){
    console.error('Map place search failed', error);
    toast('Could not search places. Check your connection and try again.');
  }
}

function napSplitterView(){
  if(!DB.napBoxes.length){
    return `<div class="card"><div class="empty"><div class="big">🔌</div>No NAP boxes yet.</div></div>`;
  }

  if(!state.selectedNapId || !DB.napBoxes.find(b=>b.id===state.selectedNapId)){
    state.selectedNapId = DB.napBoxes[0].id;
  }

  const box = DB.napBoxes.find(b=>b.id===state.selectedNapId);
  const s = napStats(box);
  const splitRatio = normalizeSplitterChoice(box.splitter, box.totalPorts);
  const splitMatch = splitRatio.match(/^2:(\d+)$/);
  const portsPerBank = splitMatch ? Number(splitMatch[1]) : Number(splitRatio) || 8;
  const bankCount = splitMatch ? 2 : 1;
  const usedPct = s.total ? Math.round((s.used / s.total) * 100) : 0;
  const boxStatus = box.status || 'Active';
  const boxStatusClass = boxStatus === 'Active' ? 'active'
    : boxStatus === 'Under Repair' ? 'repair'
      : boxStatus === 'Planned' ? 'planned'
        : 'inactive';

  const selector = `
    <div class="card napbox-toolbar">
        <div class="flex napbox-toolbar-row">
        <label class="field" style="flex:1 1 280px;margin-bottom:0">
          <span>Select NAP Box</span>
          <select id="napPicker">
            ${DB.napBoxes.map(b=>{
              const st = napStats(b);
              return `<option value="${esc(b.id)}" ${b.id===box.id?'selected':''}>
                ${esc(b.id)} — ${esc(b.label||'')} (${st.used}/${st.total})
              </option>`;
            }).join('')}
          </select>
        </label>
        <div class="napbox-mini">
          <div class="label">SPLITTER CONFIGURATION</div>
          <div class="value">${splitMatch ? `2 × 1:${portsPerBank}` : `1 × 1:${portsPerBank}`}</div>
          <div class="sub">${s.total} customer ports · ${s.free} available</div>
        </div>
      </div>
    </div>`;

  const renderPortCell = p=>{
    const c = DB.clients.find(x=>x.id===p.clientId);
    const status = p.status==='Used'
      ? (c && c.status==='Suspended' ? 'warning' : 'connected')
      : p.status==='Faulty'
        ? 'broken'
        : p.status==='Reserved'
          ? 'warning'
          : 'available';

    const paid = c
      ? billingRows().filter(r=>r.clientId===c.id).every(r=>r.balance<=0)
      : false;

    const tick = status==='connected'
      ? `<span class="tick ${paid?'paid':'unpaid'}">${paid?'PAID':'UNPAID'}</span>`
      : '';

    const label = c
      ? esc(c.name)
      : (p.status==='Faulty' ? 'BROKEN'
        : p.status==='Reserved' ? 'RESERVED'
        : 'AVAILABLE');
    const fiberHex = p.fiberColor ? escStyleHex(p.fiberColor) : '';
    const fiberName = fiberColorName(p.fiberColor);
    const fiberMark = fiberHex
      ? `<span class="fiber-color-mark" style="background:${fiberHex}" title="Fiber cable: ${esc(fiberName)}"></span>`
      : '';

    const stateText = p.status==='Used'
      ? (c && c.status==='Suspended' ? 'SUSPENDED' : 'CONNECTED')
      : p.status.toUpperCase();

    return `
      <button type="button" class="port-cell ${status}"
           data-act="openPort"
           data-napid="${esc(box.id)}"
           data-port="${p.port}"
           title="Port ${p.port} — ${label}"
           aria-label="Port ${p.port}, ${stateText}">
        <span class="state-led" aria-hidden="true"></span>
        <span class="num">PORT ${String(p.port).padStart(2,'0')}</span>
        <span class="connector"></span>
        <span class="body"></span>
        ${fiberMark}
        <span class="port-name">${p.status==='Used' ? `FIBER · ${esc(fiberName)}` : esc(stateText)}</span>
        ${tick}
      </button>`;
  };

  const banks = Array.from({length:bankCount},(_,index)=>{
    const start = index * portsPerBank;
    const bankPorts = s.ports.slice(start, start + portsPerBank);
    const bankLabel = splitMatch
      ? `Splitter ${index+1} · 1:${portsPerBank}`
      : `Customer output · 1:${portsPerBank}`;

    return `
      <div class="port-bank">
        <div class="port-bank-label">
          ${esc(bankLabel)}
          <span class="spacer"></span>
          <span>${bankPorts.filter(p=>p.status==='Used').length}/${bankPorts.length} used</span>
        </div>
        <div class="splitter-ports">
          ${bankPorts.map(renderPortCell).join('')}
        </div>
      </div>`;
  }).join('');

  const splitterOutputs = Array.from({length:bankCount},(_,splitterIndex)=>`
    <div class="splitter-output-bank">
      <div class="splitter-output-bank-label">SPLITTER ${splitterIndex+1} <span>1:${portsPerBank}</span></div>
      <div class="splitter-output-row" aria-label="Splitter ${splitterIndex+1} output adapters">
        ${Array.from({length:portsPerBank},(_,i)=>`
          <div class="splitter-out">
            <span class="n">${i+1}</span>
            <div class="adapter"></div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  const grommetCount = Math.min(16, Math.max(8, s.total));
  const grommets = Array.from({length:grommetCount},()=>`<div class="grommet"><i></i></div>`).join('');

  const hasCoordinates = box.lat!=='' && box.lat!=null &&
    box.lng!=='' && box.lng!=null &&
    Number.isFinite(Number(box.lat)) && Number.isFinite(Number(box.lng));

  return `
  ${selector}

  <section class="card napbox-summary" aria-label="NAP box details">
    <div class="napbox-summary-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="3.5" y="4" width="17" height="16" rx="3"></rect>
        <path d="M8 8h8M8 12h8M8 16h3"></path>
        <circle cx="17" cy="16" r="1" class="summary-dot"></circle>
      </svg>
    </div>
    <div class="napbox-summary-copy">
      <span class="napbox-eyebrow">Distribution point</span>
      <strong>${esc(box.id)}${box.label ? ` <span>· ${esc(box.label)}</span>` : ''}</strong>
      <small>${esc(box.address||'')}${box.landmark?` · ${esc(box.landmark)}`:''}</small>
    </div>
    <div class="napbox-summary-capacity" aria-label="${s.used} of ${s.total} ports in use">
      <div class="napbox-summary-count"><strong>${s.used}</strong><span>/ ${s.total} ports in use</span></div>
      <div class="napbox-summary-track"><span style="width:${usedPct}%"></span></div>
      <small>${s.free} available${s.faulty ? ` · ${s.faulty} faulty` : ''}</small>
    </div>
    ${hasCoordinates
      ? `<div class="napbox-summary-actions"><button class="map-link" type="button" data-act="focusNapMap" data-id="${esc(box.id)}">View on map <span aria-hidden="true">↗</span></button></div>`
      : ''}
  </section>

  <div class="splitter-wrap">
    <div class="napbox" role="region" aria-label="${esc(box.id)} NAP box fiber layout">
      <div class="napbox-lid" aria-hidden="true"></div>
      <div class="napbox-screw s1"></div>
      <div class="napbox-screw s2"></div>
      <div class="napbox-screw s3"></div>
      <div class="napbox-screw s4"></div>

      <div class="napbox-head">
        <div class="napbox-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M5 7.5h5.5v9H5zM13.5 4h5.5v6h-5.5zM13.5 14h5.5v6h-5.5zM10.5 12h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </div>
        <div class="napbox-heading">
          <div class="brand">NAP BOX</div>
          <div class="meta">FIBER DISTRIBUTION ENCLOSURE <span>·</span> ${esc(splitMatch ? `2 × 1:${portsPerBank}` : `1 × 1:${portsPerBank}`)}</div>
        </div>
        <span class="spacer"></span>
        <span class="napbox-status ${boxStatusClass}"><span class="led"></span>${esc(boxStatus)}</span>
      </div>

      <div class="napbox-inner">
        <aside class="napbox-side-rail left" aria-label="Fiber management channel">
          <div class="napbox-side-title">FIBER ROUTING</div>
          <div class="fiber-loops" aria-hidden="true">
            <span class="fiber-line"></span>
            <span class="fiber-line f2"></span>
            <span class="fiber-line f3"></span>
            <span class="fiber-clamp"></span>
            <span class="fiber-entry"></span>
            <span class="fiber-grommet"></span>
          </div>
          <span class="fiber-rail-state"><i></i> IN</span>
        </aside>

        <section class="napbox-main">
          <div class="splitter-module">
            <div class="splitter-module-head">
              <div>
                <div class="splitter-module-kicker">OPTICAL SPLITTER</div>
                <div class="splitter-module-title">
                  ${splitMatch ? `Dual PLC Splitter · 2 × 1:${portsPerBank}` : `PLC Splitter · 1 × 1:${portsPerBank}`}
                </div>
                <div class="splitter-module-sub">Incoming fiber · SC/UPC distribution</div>
              </div>
              <span class="splitter-module-spec">LOW LOSS</span>
            </div>
            <div class="splitter-input" title="Incoming fiber"></div>
            <div class="splitter-output-label">
              <span>OUTPUT ADAPTERS</span>
              <span>${s.total} customer connections</span>
            </div>
            ${splitterOutputs}
          </div>

          <div class="customer-panel">
            <div class="customer-panel-head">
              <div>
                <span class="panel-eyebrow">CUSTOMER CONNECTIONS</span>
                <strong>Output ports</strong>
              </div>
              <span class="customer-panel-note">Select a port to manage its assignment</span>
              <span class="spacer"></span>
              <span class="port-count-badge">${s.used} / ${s.total} IN USE</span>
            </div>
            <div class="port-state-legend" aria-label="Port status legend">
              <span><i class="legend-dot connected"></i>Connected</span>
              <span><i class="legend-dot available"></i>Available</span>
              <span><i class="legend-dot warning"></i>Reserved / suspended</span>
              <span><i class="legend-dot faulty"></i>Faulty</span>
            </div>
            ${banks}
          </div>

          <div class="grounding-box">
            <div class="grounding">
              <div class="ground-symbol">⏚</div>
              <div>
                <strong>GROUNDING / BONDING</strong>
                <small>Protective earth point for the enclosure</small>
              </div>
            </div>
            <div class="ground-wire" aria-hidden="true"></div>
          </div>

          <div class="cable-entry-panel">
            <div class="cable-entry-title">
              CABLE ENTRY / EXIT
              <span class="spacer"></span>
              <span>${grommetCount} cable positions</span>
            </div>
            <div class="grommet-grid">${grommets}</div>
          </div>
        </section>

      </div>

      <div class="napbox-foot">
        <span class="napbox-foot-note">Select any customer port to view or update its connection.</span>
        <span class="spacer"></span>
        <span class="meter">AVAILABLE <strong>${s.free}</strong></span>
        <span class="meter">CONNECTED <strong>${s.used}</strong></span>
        ${s.faulty ? `<span class="meter faulty">FAULTY <strong>${s.faulty}</strong></span>` : ''}
      </div>
    </div>
  </div>
  `;
}
