// ============================================
// APP CLIENTE - FINAL v3
// ============================================

console.log('=== CLIENTE INICIADO ===');

let mapa, usuario, clienteId, carreraActiva = null;
let origenMarker, destinoMarker, rutaLayer, conductorMarker, ubicacionUserMarker;
let modoSeleccion = null, origenCoords = null, destinoCoords = null;
let trackingInterval = null;

async function init() {
    try {
        await esperarSupabase();
        if (!await verificarSesion()) return;
        await cargarDatosCliente();
        
        inicializarMapa();
        
        if (typeof PRICING_CONFIG !== 'undefined') await PRICING_CONFIG.cargarDesdeDB();
        
        // Carga inicial y suscripción
        await cargarCarreraActiva();
        suscribirseCambios();
        
        document.getElementById('loader').classList.add('hidden');
        
    } catch (e) {
        console.error(e);
        alert('Error: ' + e.message);
        document.getElementById('loader').classList.add('hidden');
    }
}

async function esperarSupabase() {
    return new Promise(resolve => {
        const i = setInterval(() => { if (window.supabaseClient) { clearInterval(i); resolve(); } }, 100);
    });
}

async function verificarSesion() {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return false; }
    usuario = session.user;
    return true;
}

async function cargarDatosCliente() {
    let { data, error } = await window.supabaseClient.from('clientes').select('id').eq('perfil_id', usuario.id).maybeSingle();
    if (!data) {
        const res = await window.supabaseClient.from('clientes').insert({ perfil_id: usuario.id }).select().single();
        data = res.data;
    }
    clienteId = data.id;
}

// --- MAPA ---
function inicializarMapa() {
    mapa = L.map('map', { zoomControl: false }).setView([15.5048, -88.0250], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapa);
    mapa.on('click', e => { if (modoSeleccion) setUbicacion(e.latlng); });
    
    // GPS Usuario
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            mapa.setView([lat, lng], 15);
            ubicacionUserMarker = L.marker([lat, lng], { icon: L.divIcon({ className:'user-dot', html:'<div style="width:16px;height:16px;background:#3b82f6;border-radius:50%;border:2px solid white;box-shadow:0 0 10px rgba(0,0,0,0.2)"></div>' }) }).addTo(mapa);
            
            // Auto-set Origen
            if (!origenCoords) setUbicacion({ lat, lng }, true);
        });
    }
}

function setUbicacion(latlng, auto = false) {
    if (auto) modoSeleccion = 'origen';
    if (!modoSeleccion) return;

    if (modoSeleccion === 'origen') {
        origenCoords = { lat: latlng.lat, lng: latlng.lng };
        if (origenMarker) mapa.removeLayer(origenMarker);
        origenMarker = L.marker([latlng.lat, latlng.lng]).addTo(mapa);
        obtenerDireccion(latlng.lat, latlng.lng).then(d => { 
            origenCoords.dir = d; document.getElementById('origenDir').value = d; 
        });
    } else {
        destinoCoords = { lat: latlng.lat, lng: latlng.lng };
        if (destinoMarker) mapa.removeLayer(destinoMarker);
        destinoMarker = L.marker([latlng.lat, latlng.lng]).addTo(mapa);
        obtenerDireccion(latlng.lat, latlng.lng).then(d => { 
            destinoCoords.dir = d; document.getElementById('destinoDir').value = d; 
            calcularRuta();
        });
    }
    if (!auto) { modoSeleccion = null; abrirModalCarrera(); }
}

async function obtenerDireccion(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await res.json();
        return data.display_name?.split(',')[0];
    } catch { return `${lat.toFixed(4)}, ${lng.toFixed(4)}`; }
}

async function calcularRuta() {
    if (!origenCoords || !destinoCoords) return;
    const btn = document.getElementById('btnSolicitar');
    btn.textContent = 'Calculando...'; btn.disabled = true;

    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${origenCoords.lng},${origenCoords.lat};${destinoCoords.lng},${destinoCoords.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.routes?.[0]) {
            const r = data.routes[0];
            const dist = r.distance / 1000;
            const time = Math.ceil(r.duration / 60);
            const tipo = document.getElementById('tipoCarrera').value;
            const precio = PRICING_CONFIG ? PRICING_CONFIG.calcularPrecio(dist, tipo==='colectivo') : Math.max(30, dist*15);

            document.getElementById('resDist').textContent = dist.toFixed(1) + ' km';
            document.getElementById('resTime').textContent = time + ' min';
            document.getElementById('resPrecio').textContent = 'L ' + precio.toFixed(2);
            document.getElementById('resumenCarrera').classList.remove('hidden');
            
            if (rutaLayer) mapa.removeLayer(rutaLayer);
            rutaLayer = L.geoJSON(r.geometry, { style: { color: '#2563eb', weight: 4 } }).addTo(mapa);
            mapa.fitBounds(rutaLayer.getBounds(), { padding: [50, 50] });

            btn.textContent = 'Confirmar Viaje'; btn.disabled = false;
        }
    } catch(e) { btn.textContent = 'Error ruta'; }
}

async function solicitarCarrera() {
    const tipo = document.getElementById('tipoCarrera').value;
    const dist = parseFloat(document.getElementById('resDist').textContent);
    const time = parseInt(document.getElementById('resTime').textContent);
    const precio = parseFloat(document.getElementById('resPrecio').textContent.replace('L ', ''));

    const { error } = await window.supabaseClient.from('carreras').insert({
        cliente_id: clienteId, tipo, precio, distancia_km: dist, tiempo_estimado_min: time,
        origen_lat: origenCoords.lat, origen_lng: origenCoords.lng, origen_direccion: origenCoords.dir,
        destino_lat: destinoCoords.lat, destino_lng: destinoCoords.lng, destino_direccion: destinoCoords.dir,
        estado: 'buscando'
    });

    if (error) alert(error.message);
    else { cerrarModal(); cargarCarreraActiva(); }
}

// --- GESTIÓN ESTADO ---
async function cargarCarreraActiva() {
    const { data } = await window.supabaseClient.from('carreras').select('*, conductores(placa, modelo_moto, color, perfiles(nombre, telefono))')
        .eq('cliente_id', clienteId)
        .in('estado', ['buscando','asignada','aceptada','en_camino','en_curso'])
        .maybeSingle();

    carreraActiva = data;
    renderUI();
    if (data && data.conductor_id) iniciarTracking(data.conductor_id);
}

function renderUI() {
    const panelSin = document.getElementById('panelSinViaje');
    const panelCon = document.getElementById('panelConViaje');
    const content = document.getElementById('statusContent');

    if (!carreraActiva) {
        panelSin.classList.remove('hidden');
        panelCon.classList.add('hidden');
        if(rutaLayer) mapa.removeLayer(rutaLayer);
        return;
    }

    // SI HAY VIAJE ACTIVO
    panelSin.classList.add('hidden');
    panelCon.classList.remove('hidden');

    let html = '', estadoTexto = '', color = '';
    
    switch(carreraActiva.estado) {
        case 'buscando': 
            estadoTexto = '🔎 Buscando conductor...'; color = '#f59e0b'; 
            html = `<div class="status-card" style="border-left:4px solid ${color}"><h3 style="margin:0;color:${color}">${estadoTexto}</h3><p class="text-sm">Contactando mototaxis cercanas</p><button class="btn-danger" onclick="cancelarCarrera('${carreraActiva.id}')">Cancelar Solicitud</button></div>`;
            break;
        case 'aceptada':
        case 'en_camino':
            estadoTexto = '🚀 Conductor en camino'; color = '#2563eb';
            html = renderCardConductor(estadoTexto, color, 'Llega en 5 min');
            break;
        case 'en_curso':
            estadoTexto = '🏁 En viaje al destino'; color = '#10b981';
            html = renderCardConductor(estadoTexto, color, 'Estás en viaje');
            break;
    }
    content.innerHTML = html;
}

function renderCardConductor(titulo, color, sub) {
    const c = carreraActiva.conductores;
    const nombre = c?.perfiles?.nombre || 'Conductor';
    const moto = `${c?.modelo_moto || ''} • ${c?.placa || ''}`;
    const tel = c?.perfiles?.telefono || '';

    return `
        <div class="status-card" style="border-left:4px solid ${color}">
            <div class="flex-between">
                <div><h3 style="margin:0;color:${color}">${titulo}</h3><p class="text-sm" style="margin:4px 0">${sub}</p></div>
                <div style="font-size:1.5rem;font-weight:bold">L ${carreraActiva.precio}</div>
            </div>
            <div class="driver-info">
                <div class="driver-avatar">👤</div>
                <div style="flex:1">
                    <div class="font-bold">${nombre}</div>
                    <div class="text-sm">${moto}</div>
                </div>
                <a href="tel:${tel}" style="background:#e0f2fe;padding:10px;border-radius:50%;text-decoration:none">📞</a>
            </div>
        </div>`;
}

async function cancelarCarrera(id) {
    if(confirm('¿Cancelar?')) {
        await window.supabaseClient.from('carreras').update({ estado: 'cancelada_cliente' }).eq('id', id);
        cargarCarreraActiva();
    }
}

function suscribirseCambios() {
    window.supabaseClient.channel('cliente_carreras')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'carreras', filter: `cliente_id=eq.${clienteId}` }, 
        payload => {
            if (payload.new.estado === 'completada') { alert('Viaje finalizado'); window.location.reload(); }
            else { cargarCarreraActiva(); } // Recarga estado UI
        }).subscribe();
}

function iniciarTracking(driverId) {
    if(trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(async () => {
        const { data } = await window.supabaseClient.from('conductores').select('latitud,longitud').eq('id', driverId).single();
        if(data) {
            if(conductorMarker) conductorMarker.setLatLng([data.latitud, data.longitud]);
            else conductorMarker = L.marker([data.latitud, data.longitud], { icon: L.divIcon({className:'moto-icon', html:'🏍️'}) }).addTo(mapa);
        }
    }, 5000);
}

// Helpers UI
function abrirModalCarrera() { document.getElementById('modalCarrera').classList.add('active'); }
function cerrarModal() { document.getElementById('modalCarrera').classList.remove('active'); }
function seleccionarTipo(t) { 
    document.getElementById('tipoCarrera').value = t; 
    document.querySelectorAll('.type-option').forEach(e => e.classList.remove('active'));
    event.currentTarget.classList.add('active');
    calcularRuta();
}
function seleccionarOrigen() { modoSeleccion='origen'; cerrarModal(); }
function seleccionarDestino() { modoSeleccion='destino'; cerrarModal(); }
async function cerrarSesion() { await window.supabaseClient.auth.signOut(); window.location.href='login.html'; }

window.addEventListener('load', init);
