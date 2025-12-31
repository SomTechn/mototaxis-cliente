// ============================================
// APP CLIENTE - FINAL (CON TIEMPOS DE LLEGADA)
// ============================================

let mapa, usuario, clienteId, carreraActiva = null;
let origenMarker, destinoMarker, rutaLayer, conductorMarker, userMarker;
let origenCoords, destinoCoords, modoSeleccion;
let trackingInterval = null;

async function init() {
    try {
        await esperarSupabase();
        if (!await verificarSesion()) return;
        await cargarDatosCliente();
        
        inicializarMapa();
        
        if (typeof PRICING_CONFIG !== 'undefined') await PRICING_CONFIG.cargarDesdeDB();
        
        await cargarCarreraActiva();
        suscribirse();
        
        document.getElementById('loader').classList.add('hidden');
    } catch (e) { alert(e.message); }
}

async function esperarSupabase() { return new Promise(r => { const i = setInterval(() => { if (window.supabaseClient) { clearInterval(i); r(); } }, 100); }); }
async function verificarSesion() {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return false; }
    usuario = session.user; return true;
}
async function cargarDatosCliente() {
    let { data } = await window.supabaseClient.from('clientes').select('id, nombre').eq('perfil_id', usuario.id).maybeSingle();
    if (!data) { const res = await window.supabaseClient.from('clientes').insert({ perfil_id: usuario.id, nombre: usuario.email.split('@')[0] }).select().single(); data = res.data; }
    clienteId = data.id;
    document.getElementById('profileName').textContent = data.nombre || 'Usuario';
}

function inicializarMapa() {
    mapa = L.map('map', { zoomControl: false }).setView([15.5048, -88.0250], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapa);
    mapa.on('click', e => { if (modoSeleccion) setPunto(e.latlng); });
    
    if(navigator.geolocation) navigator.geolocation.getCurrentPosition(pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        mapa.setView([lat, lng], 15);
        userMarker = L.marker([lat, lng], { icon: L.divIcon({className:'gps-dot', html:'<div style="width:16px;height:16px;background:#3b82f6;border:2px solid white;border-radius:50%;box-shadow:0 0 10px rgba(0,0,0,0.3)"></div>'}) }).addTo(mapa);
        if(!origenCoords) setPunto({lat, lng}, 'origen', true);
    });
}

// ... Lógica de selección de puntos (setPunto, focusInput, etc. igual que antes) ...
function focusInput(modo) { modoSeleccion = modo; document.getElementById('mainSheet').classList.add('minimized'); }
function restoreSheet() { document.getElementById('mainSheet').classList.remove('minimized'); modoSeleccion = null; }

async function setPunto(latlng, tipoOverride = null, auto = false) {
    const tipo = tipoOverride || modoSeleccion;
    if (!tipo) return;
    const val = { lat: latlng.lat, lng: latlng.lng };
    const dir = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;

    if (tipo === 'origen') {
        origenCoords = val; origenCoords.dir = dir;
        if (origenMarker) mapa.removeLayer(origenMarker);
        origenMarker = L.marker([val.lat, val.lng]).addTo(mapa);
        document.getElementById('origenDir').value = "📍 " + dir;
        obtenerNombre(val, 'origenDir');
    } else {
        destinoCoords = val; destinoCoords.dir = dir;
        if (destinoMarker) mapa.removeLayer(destinoMarker);
        destinoMarker = L.marker([val.lat, val.lng], {icon: L.divIcon({html:'🏁', className:'emoji-icon'})}).addTo(mapa);
        document.getElementById('destinoDir').value = "🏁 " + dir;
        obtenerNombre(val, 'destinoDir');
    }
    if (!auto) { restoreSheet(); if (origenCoords && destinoCoords) calcularRuta(); }
}

async function obtenerNombre(c, id) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${c.lat}&lon=${c.lng}`);
        const d = await res.json();
        if(d.display_name) {
            const txt = d.display_name.split(',')[0];
            document.getElementById(id).value = (id==='origenDir'?'📍 ':'🏁 ') + txt;
            if(id==='origenDir') origenCoords.dir = txt; else destinoCoords.dir = txt;
        }
    } catch(e){}
}

async function calcularRuta() {
    document.getElementById('tripOptions').classList.remove('hidden');
    const btn = document.getElementById('btnSolicitar');
    btn.textContent = 'Calculando...'; btn.disabled = true;

    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${origenCoords.lng},${origenCoords.lat};${destinoCoords.lng},${destinoCoords.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.routes?.[0]) {
            const r = data.routes[0];
            const dist = r.distance/1000;
            const time = Math.ceil(r.duration/60);
            const tipo = document.getElementById('tipoCarrera').value;
            const precio = PRICING_CONFIG.calcularPrecio(dist, tipo === 'colectivo');

            document.getElementById('resDistTime').textContent = `${dist.toFixed(1)} km • ${time} min`;
            document.getElementById('resPrice').textContent = `L ${precio.toFixed(0)}`;
            
            if (rutaLayer) mapa.removeLayer(rutaLayer);
            rutaLayer = L.geoJSON(r.geometry, {style: {color:'black', weight:4}}).addTo(mapa);
            mapa.fitBounds(rutaLayer.getBounds(), {padding:[50,200]});
            btn.textContent = 'Confirmar Mototaxi'; btn.disabled = false;
        }
    } catch(e) { btn.textContent = 'Error ruta (Reintentar)'; btn.disabled = false; }
}

async function solicitarCarrera() {
    const p = parseFloat(document.getElementById('resPrice').textContent.replace('L ',''));
    const distStr = document.getElementById('resDistTime').textContent.split(' km')[0];
    
    document.getElementById('panelRequest').classList.add('hidden');
    document.getElementById('panelActive').classList.remove('hidden');
    document.getElementById('statusTitle').textContent = "Buscando...";

    const { error } = await window.supabaseClient.from('carreras').insert({
        cliente_id: clienteId, tipo: document.getElementById('tipoCarrera').value, precio: p, distancia_km: parseFloat(distStr),
        origen_lat: origenCoords.lat, origen_lng: origenCoords.lng, origen_direccion: origenCoords.dir,
        destino_lat: destinoCoords.lat, destino_lng: destinoCoords.lng, destino_direccion: destinoCoords.dir,
        estado: 'buscando'
    });
    if (error) { alert(error.message); cargarCarreraActiva(); } else { cargarCarreraActiva(); }
}

// --- ESTADOS Y UI ---
async function cargarCarreraActiva() {
    const { data } = await window.supabaseClient.from('carreras').select('*, conductores(placa, modelo_moto, perfiles(nombre, telefono))')
        .eq('cliente_id', clienteId).in('estado',['buscando','aceptada','en_camino','en_curso']).maybeSingle();
    carreraActiva = data;
    renderUI();
}

function renderUI() {
    const reqPanel = document.getElementById('panelRequest');
    const actPanel = document.getElementById('panelActive');
    const infoDriver = document.getElementById('driverCard');
    const radar = document.getElementById('radarIcon');
    
    if (!carreraActiva) {
        reqPanel.classList.remove('hidden');
        actPanel.classList.add('hidden');
        if(conductorMarker) mapa.removeLayer(conductorMarker);
        if(trackingInterval) clearInterval(trackingInterval);
        return;
    }

    reqPanel.classList.add('hidden');
    actPanel.classList.remove('hidden');
    
    const s = carreraActiva.estado;
    
    // ESTADO: BUSCANDO
    if (s === 'buscando') {
        document.getElementById('statusTitle').textContent = "🔎 Buscando...";
        document.getElementById('statusSub').textContent = "Contactando conductores...";
        infoDriver.classList.add('hidden');
        radar.innerHTML = "🔎";
        return;
    }

    // ESTADO: CONDUCTOR ASIGNADO (Aceptada / En camino / En curso)
    infoDriver.classList.remove('hidden');
    const c = carreraActiva.conductores;
    
    // HTML DINÁMICO CON DATOS DEL CONDUCTOR Y TIEMPOS
    const htmlInfo = `
        <div class="driver-row">
            <div class="driver-avatar">👤</div>
            <div style="flex:1">
                <div style="font-size:18px; font-weight:800; color:#1e293b">${c?.perfiles?.nombre || 'Conductor'}</div>
                <div style="color:#64748b; font-size:14px">${c?.modelo_moto} • ${c?.placa}</div>
            </div>
            <div style="text-align:right">
                <div style="font-weight:bold; font-size:18px; color:#2563eb">L ${carreraActiva.precio}</div>
                <div style="font-size:12px; color:#94a3b8">EFECTIVO</div>
            </div>
        </div>

        <div class="eta-grid">
            <div class="eta-box">
                <div class="eta-label">Llega a ti en</div>
                <div class="eta-value green" id="etaPickup">-- min</div>
            </div>
            <div class="eta-box">
                <div class="eta-label">Llegada Destino</div>
                <div class="eta-value blue" id="etaDest">--:--</div>
            </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px">
            <button class="act-btn" onclick="callDriver()">📞 Llamar</button>
            <button class="act-btn" onclick="alert('Compartir')">🔗 Compartir</button>
        </div>
    `;
    
    infoDriver.innerHTML = htmlInfo;
    window.driverPhone = c?.perfiles?.telefono;

    if (s === 'en_curso') {
        document.getElementById('statusTitle').textContent = "🚀 En viaje";
        document.getElementById('statusSub').textContent = "Hacia " + carreraActiva.destino_direccion.split(',')[0];
        radar.innerHTML = "🚀";
        // Si está en curso, el tiempo "A recoger" es 0 o irrelevante
        setTimeout(() => document.getElementById('etaPickup').textContent = "¡A bordo!", 100);
    } else {
        document.getElementById('statusTitle').textContent = "🚕 Conductor en camino";
        document.getElementById('statusSub').textContent = "Tu mototaxi está llegando";
        radar.innerHTML = "🚕";
    }

    if(carreraActiva.conductor_id) iniciarTracking(carreraActiva.conductor_id);
}

function iniciarTracking(driverId) {
    if(trackingInterval) clearInterval(trackingInterval);
    
    // Función de actualización inmediata
    const update = async () => {
        const { data } = await window.supabaseClient.from('conductores').select('latitud,longitud').eq('id', driverId).single();
        
        if(data && data.latitud) {
            const driverPos = { lat: data.latitud, lng: data.longitud };
            
            // 1. Mover icono en mapa
            if(conductorMarker) conductorMarker.setLatLng([driverPos.lat, driverPos.lng]);
            else conductorMarker = L.marker([driverPos.lat, driverPos.lng], {icon: L.divIcon({html:'🏍️', className:'emoji-icon'})}).addTo(mapa);
            
            // 2. CALCULAR TIEMPOS REALES (OSRM)
            actualizarTiemposReales(driverPos);
        }
    };

    update(); // Ejecutar ya
    trackingInterval = setInterval(update, 5000); // Repetir cada 5s
}

async function actualizarTiemposReales(driverPos) {
    // Si la carrera no está en UI o faltan elementos, salir
    if (!carreraActiva || !document.getElementById('etaPickup')) return;

    try {
        const estado = carreraActiva.estado;
        let minToPickup = 0;

        // Calcular: Conductor -> Cliente (Solo si no ha recogido)
        if (estado === 'aceptada' || estado === 'en_camino') {
            const resPick = await fetch(`https://router.project-osrm.org/route/v1/driving/${driverPos.lng},${driverPos.lat};${carreraActiva.origen_lng},${carreraActiva.origen_lat}?overview=false`);
            const dataPick = await resPick.json();
            if (dataPick.routes?.[0]) {
                minToPickup = Math.ceil(dataPick.routes[0].duration / 60);
                document.getElementById('etaPickup').textContent = minToPickup + " min";
            }
        }

        // Calcular: Hora Llegada Destino (Ahora + Tiempo a recoger + Tiempo Viaje)
        // Usamos el tiempo estimado del viaje original como base para simplificar
        const tiempoViaje = carreraActiva.tiempo_estimado_min || 15; 
        const minutosTotales = (estado === 'en_curso' ? 0 : minToPickup) + tiempoViaje;
        
        const arrivalDate = new Date(new Date().getTime() + minutosTotales * 60000);
        const horaLlegada = arrivalDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        document.getElementById('etaDest').textContent = horaLlegada;

    } catch (e) { console.warn('Error calculando tiempos ETA', e); }
}

function suscribirse() {
    window.supabaseClient.channel('cli').on('postgres_changes', {event:'*', schema:'public', table:'carreras', filter:`cliente_id=eq.${clienteId}`}, 
    payload => {
        const n = payload.new;
        if (n.estado === 'completada') {
            document.getElementById('rateModal').style.display = 'flex';
            window.lastTripId = n.id;
            carreraActiva = null; 
        } else {
            cargarCarreraActiva();
        }
    }).subscribe();
}

async function enviarCalificacion() {
    const r = window.rateVal || 5;
    await window.supabaseClient.from('carreras').update({calificacion_conductor: r}).eq('id', window.lastTripId);
    document.getElementById('rateModal').style.display = 'none';
    cargarCarreraActiva(); 
}

async function cancelarCarrera() {
    if(confirm('¿Cancelar?')) await window.supabaseClient.from('carreras').update({estado:'cancelada_cliente'}).eq('id', carreraActiva.id);
}

function setTipo(t) { 
    document.getElementById('tipoCarrera').value = t;
    document.getElementById('btnDirecto').style.border = t==='directo'?'2px solid #2563eb':'1px solid #ddd';
    document.getElementById('btnColectivo').style.border = t==='colectivo'?'2px solid #2563eb':'1px solid #ddd';
    if(origenCoords && destinoCoords) calcularRuta();
}
function callDriver() { window.open(`tel:${window.driverPhone}`); }
async function verHistorial() {
    document.getElementById('historyModal').style.display = 'flex';
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('cliente_id', clienteId).in('estado',['completada']).order('fecha_solicitud',{ascending:false}).limit(10);
    document.getElementById('historyList').innerHTML = data.map(c=>`<div style="padding:10px;border-bottom:1px solid #eee"><b>${new Date(c.fecha_solicitud).toLocaleDateString()}</b> - L${c.precio}<br><small>${c.destino_direccion}</small></div>`).join('');
}
async function logout() { await window.supabaseClient.auth.signOut(); window.location.href='login.html'; }

window.addEventListener('load', init);
