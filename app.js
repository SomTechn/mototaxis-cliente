// ============================================
// APP CLIENTE - FINAL
// ============================================

let mapa, usuario, clienteId, carreraActiva = null;
let origenMarker, destinoMarker, rutaLayer, conductorMarker, userMarker;
let modoSeleccion = null, origenCoords = null, destinoCoords = null;
let trackingInterval = null, currentRating = 0;

async function init() {
    try {
        await esperarSupabase();
        if (!await verificarSesion()) return;
        await cargarDatosCliente();
        
        inicializarMapa();
        if (typeof PRICING_CONFIG !== 'undefined') await PRICING_CONFIG.cargarDesdeDB();
        
        await cargarCarreraActiva();
        suscribirseCambios();
        
    } catch (e) { alert(e.message); }
}

// ... (Funciones de soporte iguales: esperarSupabase, verificarSesion, cargarDatosCliente) ...
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
    document.getElementById('userName').textContent = data.nombre || 'Cliente';
}

// --- MAPA ---
function inicializarMapa() {
    mapa = L.map('map', { zoomControl: false }).setView([15.5048, -88.0250], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapa);
    mapa.on('click', e => { if (modoSeleccion) setUbicacion(e.latlng); });
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            mapa.setView([lat, lng], 15);
            userMarker = L.marker([lat, lng], { icon: L.divIcon({className:'user-dot', html:'<div style="width:16px;height:16px;background:#3b82f6;border-radius:50%;border:2px solid white;box-shadow:0 0 10px rgba(0,0,0,0.3)"></div>'}) }).addTo(mapa);
            if (!origenCoords) setUbicacion({ lat, lng }, true);
        });
    }
}

function setUbicacion(latlng, auto = false) {
    if (auto) modoSeleccion = 'origen';
    if (!modoSeleccion) return;

    // Obtener dirección (Simulada si falla API)
    const dir = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
    
    if (modoSeleccion === 'origen') {
        origenCoords = { lat: latlng.lat, lng: latlng.lng, dir };
        if (origenMarker) mapa.removeLayer(origenMarker);
        origenMarker = L.marker([latlng.lat, latlng.lng]).addTo(mapa);
        document.getElementById('origenDir').value = dir;
        obtenerNombreDireccion(latlng.lat, latlng.lng, 'origenDir');
    } else {
        destinoCoords = { lat: latlng.lat, lng: latlng.lng, dir };
        if (destinoMarker) mapa.removeLayer(destinoMarker);
        destinoMarker = L.marker([latlng.lat, latlng.lng]).addTo(mapa);
        document.getElementById('destinoDir').value = dir;
        obtenerNombreDireccion(latlng.lat, latlng.lng, 'destinoDir');
    }
    
    if (!auto) modoSeleccion = null;
    if (origenCoords && destinoCoords) calcularRuta();
}

async function obtenerNombreDireccion(lat, lng, elementId) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await res.json();
        if (data.display_name) {
            const val = data.display_name.split(',')[0];
            document.getElementById(elementId).value = val;
            if(elementId === 'origenDir') origenCoords.dir = val;
            if(elementId === 'destinoDir') destinoCoords.dir = val;
        }
    } catch(e){}
}

async function calcularRuta() {
    const btn = document.getElementById('btnSolicitar');
    btn.disabled = true; btn.textContent = "Calculando...";
    
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${origenCoords.lng},${origenCoords.lat};${destinoCoords.lng},${destinoCoords.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.routes?.[0]) {
            const r = data.routes[0];
            const dist = r.distance / 1000;
            const time = Math.ceil(r.duration / 60);
            const tipo = document.getElementById('tipoCarrera').value;
            const precio = PRICING_CONFIG.calcularPrecio(dist, tipo === 'colectivo');

            document.getElementById('resDist').textContent = dist.toFixed(1) + ' km';
            document.getElementById('resPrice').textContent = 'L ' + precio.toFixed(2);
            document.getElementById('resumenCarrera').classList.remove('hidden');
            
            if (rutaLayer) mapa.removeLayer(rutaLayer);
            rutaLayer = L.geoJSON(r.geometry, { style: { color: '#2563eb', weight: 4 } }).addTo(mapa);
            mapa.fitBounds(rutaLayer.getBounds(), { padding: [50, 50] });

            btn.disabled = false; btn.textContent = "Pedir Mototaxi";
        }
    } catch (e) { btn.textContent = "Error ruta (Reintentar)"; }
}

async function solicitarCarrera() {
    const tipo = document.getElementById('tipoCarrera').value;
    const dist = parseFloat(document.getElementById('resDist').textContent);
    const precio = parseFloat(document.getElementById('resPrice').textContent.replace('L ', ''));

    const { error } = await window.supabaseClient.from('carreras').insert({
        cliente_id: clienteId, tipo, precio, distancia_km: dist,
        origen_lat: origenCoords.lat, origen_lng: origenCoords.lng, origen_direccion: origenCoords.dir,
        destino_lat: destinoCoords.lat, destino_lng: destinoCoords.lng, destino_direccion: destinoCoords.dir,
        estado: 'buscando'
    });

    if (!error) cargarCarreraActiva();
}

async function cargarCarreraActiva() {
    const { data } = await window.supabaseClient.from('carreras')
        .select('*, conductores(placa, modelo_moto, color, perfiles(nombre, telefono))')
        .eq('cliente_id', clienteId)
        .in('estado', ['buscando','asignada','aceptada','en_camino','en_curso'])
        .maybeSingle();

    carreraActiva = data;
    const form = document.getElementById('tripForm');
    const status = document.getElementById('tripStatus');
    
    if (data) {
        form.classList.add('hidden');
        status.classList.remove('hidden');
        renderStatus(data);
        if(data.conductor_id) iniciarTracking(data.conductor_id);
    } else {
        form.classList.remove('hidden');
        status.classList.add('hidden');
        if(rutaLayer) mapa.removeLayer(rutaLayer);
        detenerTracking();
    }
}

function renderStatus(c) {
    const div = document.getElementById('statusContent');
    let html = '';
    
    if (c.estado === 'buscando') {
        html = `<div class="trip-card" style="border-left:4px solid #f59e0b">
            <h3>🔎 Buscando conductor...</h3>
            <p>Espera un momento.</p>
            <button onclick="cancelar('${c.id}')" style="color:#ef4444;background:none;border:none;font-weight:bold">Cancelar</button>
        </div>`;
    } else {
        const cond = c.conductores;
        html = `<div class="trip-card" style="border-left:4px solid #10b981">
            <h3>🚀 ${c.estado === 'en_curso' ? 'En viaje' : 'Conductor en camino'}</h3>
            <div style="display:flex;gap:10px;margin-top:10px;align-items:center">
                <div style="font-size:30px">🏍️</div>
                <div><strong>${cond?.perfiles?.nombre || 'Conductor'}</strong><br><small>${cond?.modelo_moto} • ${cond?.placa}</small></div>
                <a href="tel:${cond?.perfiles?.telefono}" style="margin-left:auto;font-size:1.5rem">📞</a>
            </div>
        </div>`;
    }
    div.innerHTML = html;
}

// CALIFICACIÓN
function rate(n) {
    currentRating = n;
    document.querySelectorAll('.star').forEach((s, i) => {
        s.classList.toggle('active', i < n);
    });
}

async function enviarCalificacion() {
    if (!carreraActiva) return; // Prevent null error if finished
    // Asumimos que tenemos el ID del viaje guardado temporalmente o lo pasamos
    // Como el viaje ya está 'completada', carreraActiva será null al recargar. 
    // Usaremos una variable global 'lastTripId' guardada al recibir evento completado
}

// Eventos y Realtime
function suscribirseCambios() {
    window.supabaseClient.channel('cliente').on('postgres_changes', { event: '*', schema: 'public', table: 'carreras', filter: `cliente_id=eq.${clienteId}` }, 
    payload => {
        const nueva = payload.new;
        if (nueva.estado === 'completada') {
            document.getElementById('ratingModal').style.display = 'flex';
            carreraActiva = null; // Limpiar estado activo
            // Guardar ID para calificar
            window.lastTripId = nueva.id;
            cargarCarreraActiva();
        } else {
            cargarCarreraActiva();
        }
    }).subscribe();
}

async function cancelar(id) {
    if(confirm('¿Cancelar?')) await window.supabaseClient.from('carreras').update({ estado: 'cancelada_cliente' }).eq('id', id);
}

// Helpers
function seleccionarOrigen() { modoSeleccion = 'origen'; }
function seleccionarDestino() { modoSeleccion = 'destino'; }
function setTipo(t) { 
    document.getElementById('tipoCarrera').value = t;
    document.querySelectorAll('.type-btn').forEach(b => {
        b.style.border = '1px solid #e5e7eb'; b.style.background = 'white';
    });
    const btn = document.getElementById(t === 'directo' ? 'btnDirecto' : 'btnColectivo');
    btn.style.border = '2px solid #2563eb'; btn.style.background = '#eff6ff';
    if(origenCoords && destinoCoords) calcularRuta();
}
function iniciarTracking(id) {
    if(trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(async () => {
        const { data } = await window.supabaseClient.from('conductores').select('latitud,longitud').eq('id', id).maybeSingle();
        if(data) {
            if(conductorMarker) conductorMarker.setLatLng([data.latitud, data.longitud]);
            else conductorMarker = L.marker([data.latitud, data.longitud], { icon: L.divIcon({html:'🏍️', className:'emoji-marker'}) }).addTo(mapa);
        }
    }, 4000);
}
function detenerTracking() { if(trackingInterval) clearInterval(trackingInterval); if(conductorMarker) mapa.removeLayer(conductorMarker); conductorMarker=null; }
async function cerrarSesion() { await window.supabaseClient.auth.signOut(); window.location.href='login.html'; }

// Fix para Historial
async function cargarHistorial() {
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('cliente_id', clienteId).in('estado',['completada','cancelada_cliente']).order('fecha_solicitud', {ascending:false}).limit(10);
    const div = document.getElementById('historialLista');
    div.innerHTML = data.map(c => `<div style="border-bottom:1px solid #eee;padding:10px 0"><div>${new Date(c.fecha_solicitud).toLocaleDateString()} - <strong>L ${c.precio}</strong></div><small>${c.destino_direccion}</small></div>`).join('');
}

// Fix modal calificación
window.enviarCalificacion = async function() {
    const comment = document.getElementById('ratingComment').value;
    if (window.lastTripId) {
        await window.supabaseClient.from('carreras').update({ 
            calificacion_conductor: currentRating, 
            comentario_cliente: comment 
        }).eq('id', window.lastTripId);
        document.getElementById('ratingModal').style.display = 'none';
        alert('¡Gracias por tu calificación!');
    }
}

window.addEventListener('load', init);
