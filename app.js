let mapa, usuario, clienteId, carreraActiva = null;
let origenMarker, destinoMarker, rutaLayer, conductorMarker, userMarker;
let origenCoords, destinoCoords, modoSeleccion;
let trackingInterval = null;

async function init() {
    try {
        await esperarSupabase();
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) return window.location.href = 'login.html';
        usuario = session.user;

        await cargarPerfil();
        inicializarMapa();
        
        if (typeof PRICING_CONFIG !== 'undefined') await PRICING_CONFIG.cargarDesdeDB();
        
        // Carga estado inicial
        await cargarCarreraActiva();
        suscribirse();
        
        document.getElementById('loader').classList.add('hidden');
    } catch (e) { alert(e.message); }
}

async function esperarSupabase() { return new Promise(r => { const i = setInterval(() => { if (window.supabaseClient) { clearInterval(i); r(); } }, 100); }); }

async function cargarPerfil() {
    let { data } = await window.supabaseClient.from('clientes').select('id, nombre').eq('perfil_id', usuario.id).maybeSingle();
    if (!data) { const res = await window.supabaseClient.from('clientes').insert({ perfil_id: usuario.id, nombre: usuario.email.split('@')[0] }).select().single(); data = res.data; }
    clienteId = data.id;
    document.getElementById('profileName').textContent = data.nombre || 'Usuario';
}

function inicializarMapa() {
    mapa = L.map('map', { zoomControl: false }).setView([15.5, -88], 13);
    // MAPA CLARO Y DETALLADO (OSM HOT)
    L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapa);
    
    mapa.on('click', e => { if (modoSeleccion) setPunto(e.latlng); });

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            mapa.setView([lat, lng], 15);
            userMarker = L.marker([lat, lng], {icon: L.divIcon({className:'gps-dot', html:'<div style="width:16px;height:16px;background:#2563eb;border:2px solid white;border-radius:50%;box-shadow:0 0 10px rgba(0,0,0,0.3)"></div>'})}).addTo(mapa);
            // Auto origen
            if(!origenCoords) setPunto({lat, lng}, 'origen', true);
        });
    }
}

// GESTIÓN DE PUNTOS
function focusInput(modo) {
    modoSeleccion = modo;
    document.getElementById('mainSheet').classList.add('minimized'); // Bajar panel para ver mapa
}

function restoreSheet() {
    document.getElementById('mainSheet').classList.remove('minimized');
    modoSeleccion = null;
}

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

    if (!auto) {
        restoreSheet();
        if (origenCoords && destinoCoords) calcularRuta();
    }
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
    document.getElementById('tripDetails').classList.remove('hidden');
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
    } catch(e) { btn.textContent = 'Reintentar Ruta'; btn.disabled = false; }
}

async function solicitarCarrera() {
    const p = parseFloat(document.getElementById('resPrice').textContent.replace('L ',''));
    const distStr = document.getElementById('resDistTime').textContent.split(' km')[0];
    const dist = parseFloat(distStr);
    
    // UI Instantánea
    document.getElementById('panelRequest').classList.add('hidden');
    document.getElementById('panelActive').classList.remove('hidden');
    document.getElementById('statusTitle').textContent = "Buscando...";

    const { data, error } = await window.supabaseClient.from('carreras').insert({
        cliente_id: clienteId, tipo: document.getElementById('tipoCarrera').value, precio: p, distancia_km: dist,
        origen_lat: origenCoords.lat, origen_lng: origenCoords.lng, origen_direccion: origenCoords.dir,
        destino_lat: destinoCoords.lat, destino_lng: destinoCoords.lng, destino_direccion: destinoCoords.dir,
        estado: 'buscando'
    }).select().single();

    if (error) { alert(error.message); cargarCarreraActiva(); } // Revertir si falla
    else carreraActiva = data;
}

// --- ESTADOS Y REALTIME ---
async function cargarCarreraActiva() {
    const { data } = await window.supabaseClient.from('carreras').select('*, conductores(placa, modelo_moto, perfiles(nombre, telefono))')
        .eq('cliente_id', clienteId).in('estado',['buscando','aceptada','en_camino','en_curso']).maybeSingle();
    
    carreraActiva = data;
    renderUI();
}

function renderUI() {
    const req = document.getElementById('panelRequest');
    const act = document.getElementById('panelActive');
    const info = document.getElementById('driverInfo');
    
    if (!carreraActiva) {
        req.classList.remove('hidden');
        act.classList.add('hidden');
        if(conductorMarker) mapa.removeLayer(conductorMarker);
        if(trackingInterval) clearInterval(trackingInterval);
        return;
    }

    req.classList.add('hidden');
    act.classList.remove('hidden');
    
    const s = carreraActiva.estado;
    const t = document.getElementById('statusTitle');
    const sub = document.getElementById('statusSub');

    if (s === 'buscando') {
        t.textContent = "🔍 Buscando...";
        sub.textContent = "Contactando conductores...";
        info.classList.add('hidden');
    } else {
        info.classList.remove('hidden');
        // Datos Conductor
        const c = carreraActiva.conductores;
        document.getElementById('drvName').textContent = c?.perfiles?.nombre || 'Conductor';
        document.getElementById('drvPlaca').textContent = `${c?.modelo_moto} • ${c?.placa}`;
        window.driverPhone = c?.perfiles?.telefono;
        
        // Iniciar Tracking
        if(carreraActiva.conductor_id) iniciarTracking(carreraActiva.conductor_id);

        if (s === 'en_curso') {
            t.textContent = "🚀 En viaje";
            sub.textContent = "Disfruta el recorrido";
        } else {
            t.textContent = "🚕 Conductor en camino";
            sub.textContent = "Llega en breves minutos";
        }
    }
}

function iniciarTracking(driverId) {
    if(trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(async () => {
        const { data } = await window.supabaseClient.from('conductores').select('latitud,longitud').eq('id', driverId).single();
        if(data && data.latitud) {
            if(conductorMarker) conductorMarker.setLatLng([data.latitud, data.longitud]);
            else conductorMarker = L.marker([data.latitud, data.longitud], {icon: L.divIcon({html:'🏍️', className:'emoji-icon'})}).addTo(mapa);
        }
    }, 4000);
}

function suscribirse() {
    window.supabaseClient.channel('cli').on('postgres_changes', {event:'*', schema:'public', table:'carreras', filter:`cliente_id=eq.${clienteId}`}, payload => {
        const n = payload.new;
        if (n.estado === 'completada') {
            carreraActiva = null;
            document.getElementById('rateModal').style.display = 'flex';
            window.lastTripId = n.id;
            renderUI();
        } else {
            cargarCarreraActiva();
        }
    }).subscribe();
}

async function enviarCalificacion() {
    const r = window.rateVal || 5;
    await window.supabaseClient.from('carreras').update({calificacion_conductor: r}).eq('id', window.lastTripId);
    document.getElementById('rateModal').style.display = 'none';
    alert('¡Gracias!');
}

async function cancelarCarrera() {
    if(confirm('¿Cancelar?')) {
        await window.supabaseClient.from('carreras').update({estado:'cancelada_cliente'}).eq('id', carreraActiva.id);
    }
}

// UI Helpers
function openDrawer() { document.getElementById('drawer').classList.add('open'); document.querySelector('.drawer-overlay').style.display='block'; }
function closeDrawer() { document.getElementById('drawer').classList.remove('open'); document.querySelector('.drawer-overlay').style.display='none'; }
function setTipo(t) { 
    document.getElementById('tipoCarrera').value = t;
    document.getElementById('btnDirecto').style.border = t==='directo'?'2px solid #2563eb':'1px solid #ddd';
    document.getElementById('btnColectivo').style.border = t==='colectivo'?'2px solid #2563eb':'1px solid #ddd';
    calcularRuta();
}
function callDriver() { window.open(`tel:${window.driverPhone}`); }
async function verHistorial() {
    document.getElementById('historyModal').style.display = 'flex';
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('cliente_id', clienteId).in('estado',['completada']).order('fecha_solicitud',{ascending:false}).limit(10);
    document.getElementById('historyList').innerHTML = data.map(c=>`<div style="padding:10px;border-bottom:1px solid #eee"><b>${new Date(c.fecha_solicitud).toLocaleDateString()}</b> - L${c.precio}<br><small>${c.destino_direccion}</small></div>`).join('');
}
async function logout() { await window.supabaseClient.auth.signOut(); window.location.href='login.html'; }

window.addEventListener('load', init);
