// ============================================
// APP CLIENTE - FINAL FIX (NULL & AUDIO)
// ============================================

console.log('=== INICIANDO APP CLIENTE ===');

let mapa, usuario, clienteId;
let carreraActiva = null;
let origenMarker = null, destinoMarker = null, rutaLayer = null, conductorMarker = null, ubicacionActualMarker = null;
let modoSeleccion = null;
let origenCoords = null, destinoCoords = null;
let trackingInterval = null;

// ============================================
// 1. INICIALIZACIÓN
// ============================================

async function init() {
    try {
        await esperarSupabase();
        const sesionValida = await verificarSesion();
        if (!sesionValida) return;
        
        await cargarDatosCliente();
        
        inicializarMapa();
        inicializarEventos();
        inyectarEstilosAnimacion();

        if (typeof PRICING_CONFIG !== 'undefined') await PRICING_CONFIG.cargarDesdeDB();

        await cargarCarreraActiva();
        await cargarHistorial();
        suscribirseACambios();
        
        ocultarLoader();
        console.log('=== ✅ APP CLIENTE LISTA ===');
        
    } catch (error) {
        console.error('Error init:', error);
        mostrarError('Error al iniciar: ' + error.message);
        ocultarLoader();
    }
}

async function esperarSupabase() {
    return new Promise((resolve, reject) => {
        if (window.supabaseClient) { resolve(); return; }
        let i = 0;
        const interval = setInterval(() => {
            i++;
            if (window.supabaseClient) { clearInterval(interval); resolve(); } 
            else if (i > 50) { clearInterval(interval); reject(new Error('Timeout DB')); }
        }, 100);
    });
}

async function verificarSesion() {
    const { data: { session }, error } = await window.supabaseClient.auth.getSession();
    if (!session || error) { window.location.href = 'login.html'; return false; }
    usuario = session.user;
    return true;
}

async function cargarDatosCliente() {
    const { data: cliente, error } = await window.supabaseClient
        .from('clientes').select('id').eq('perfil_id', usuario.id).maybeSingle();
        
    if (error) throw error;
    if (!cliente) {
        const { data: newCliente, error: createError } = await window.supabaseClient
            .from('clientes').insert({ perfil_id: usuario.id }).select().single();
        if (createError) throw new Error('Error creando cliente');
        clienteId = newCliente.id;
    } else {
        clienteId = cliente.id;
    }
}

// ============================================
// 2. MAPA
// ============================================

function inicializarMapa() {
    const centro = (typeof MAP_CONFIG !== 'undefined') ? MAP_CONFIG.defaultCenter : [15.5048, -88.0250];
    mapa = L.map('map', { zoomControl: false }).setView(centro, 13);
    L.control.zoom({ position: 'topright' }).addTo(mapa);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapa);
    mapa.on('click', (e) => { if (modoSeleccion) seleccionarUbicacion(e.latlng); });
    obtenerUbicacionActual();
}

function obtenerUbicacionActual() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            mapa.flyTo([lat, lng], 16, { animate: true, duration: 1.5 });
            const html = `<div style="background-color:#4285F4; width:15px; height:15px; border-radius:50%; border:2px solid white; box-shadow:0 0 0 10px rgba(66,133,244,0.2);"></div>`;
            const icon = L.divIcon({ className: 'gps-user-location', html: html, iconSize: [20, 20], iconAnchor: [10, 10] });
            if (ubicacionActualMarker) mapa.removeLayer(ubicacionActualMarker);
            ubicacionActualMarker = L.marker([lat, lng], { icon: icon }).addTo(mapa);
            if (!origenCoords) setTimeout(() => seleccionarUbicacion({ lat, lng }, true), 2000);
        },
        () => console.warn('GPS no disponible'), { enableHighAccuracy: true }
    );
}

function seleccionarOrigen() { modoSeleccion = 'origen'; cerrarModal(); mostrarNotificacion('📍 Marca el ORIGEN'); }
function seleccionarDestino() { modoSeleccion = 'destino'; cerrarModal(); mostrarNotificacion('🏁 Marca el DESTINO'); }

async function seleccionarUbicacion(latlng, esAutomatico = false) {
    if (esAutomatico) modoSeleccion = 'origen';
    if (!modoSeleccion && !esAutomatico) return;

    const dir = await obtenerDireccion(latlng.lat, latlng.lng);
    
    if (modoSeleccion === 'origen') {
        origenCoords = { lat: latlng.lat, lng: latlng.lng, dir: dir };
        if (origenMarker) mapa.removeLayer(origenMarker);
        origenMarker = L.marker([latlng.lat, latlng.lng], { icon: L.divIcon({ html: '📍', className: 'emoji-marker' }) }).addTo(mapa);
        document.getElementById('origenDir').value = dir;
    } else {
        destinoCoords = { lat: latlng.lat, lng: latlng.lng, dir: dir };
        if (destinoMarker) mapa.removeLayer(destinoMarker);
        destinoMarker = L.marker([latlng.lat, latlng.lng], { icon: L.divIcon({ html: '🏁', className: 'emoji-marker' }) }).addTo(mapa);
        document.getElementById('destinoDir').value = dir;
    }
    modoSeleccion = null;
    if (!esAutomatico) abrirModalCarrera();
    if (origenCoords && destinoCoords) await calcularRuta();
}

async function obtenerDireccion(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await res.json();
        return data.display_name?.split(',')[0] || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch { return `${lat.toFixed(4)}, ${lng.toFixed(4)}`; }
}

async function calcularRuta() {
    const btn = document.getElementById('btnSolicitar');
    if(btn) { btn.disabled = true; btn.textContent = "Calculando..."; }

    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${origenCoords.lng},${origenCoords.lat};${destinoCoords.lng},${destinoCoords.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.routes && data.routes[0]) {
            const r = data.routes[0];
            const dist = r.distance / 1000;
            const time = Math.ceil((r.duration / 60) * 1.3);
            const tipo = document.getElementById('tipoCarrera').value;
            let precio = (typeof PRICING_CONFIG !== 'undefined') ? PRICING_CONFIG.calcularPrecio(dist, tipo === 'colectivo') : Math.max(dist * 15, 30);
            
            document.getElementById('resDistancia').textContent = dist.toFixed(2) + ' km';
            document.getElementById('resTiempo').textContent = time + ' min';
            document.getElementById('resPrecio').textContent = 'L ' + precio.toFixed(2);
            document.getElementById('resumenCarrera').style.display = 'block';
            
            if (rutaLayer) mapa.removeLayer(rutaLayer);
            rutaLayer = L.geoJSON(r.geometry, { style: { color: '#2563eb', weight: 4 } }).addTo(mapa);
            mapa.fitBounds(rutaLayer.getBounds(), { padding: [50, 50] });

            if(btn) { btn.disabled = false; btn.textContent = "Pedir Mototaxi"; }
        }
    } catch (e) { if(btn) btn.textContent = "Error ruta"; }
}

// ============================================
// 3. CARRERAS
// ============================================

async function solicitarCarrera() {
    if (!origenCoords || !destinoCoords) return;
    
    const tipo = document.getElementById('tipoCarrera').value;
    const dist = parseFloat(document.getElementById('resDistancia').textContent);
    const time = parseInt(document.getElementById('resTiempo').textContent);
    const precio = parseFloat(document.getElementById('resPrecio').textContent.replace('L ', ''));
    
    try {
        mostrarLoader();
        const { error } = await window.supabaseClient.from('carreras').insert({
            tipo, cliente_id: clienteId,
            origen_direccion: origenCoords.dir, origen_lat: origenCoords.lat, origen_lng: origenCoords.lng,
            destino_direccion: destinoCoords.dir, destino_lat: destinoCoords.lat, destino_lng: destinoCoords.lng,
            distancia_km: dist, tiempo_estimado_min: time, precio, estado: 'buscando'
        });
        
        if (error) throw error;
        cerrarModal();
        mostrarNotificacion('✅ Solicitud enviada');
        await cargarCarreraActiva();
        
    } catch (e) { mostrarError(e.message); } 
    finally { ocultarLoader(); }
}

async function cargarCarreraActiva() {
    try {
        const { data, error } = await window.supabaseClient
            .from('carreras')
            .select('*')
            .eq('cliente_id', clienteId)
            .in('estado', ['solicitada', 'buscando', 'asignada', 'aceptada', 'en_camino', 'en_curso'])
            .order('fecha_solicitud', { ascending: false })
            .limit(1)
            .maybeSingle();
            
        const container = document.getElementById('carreraActiva');
        if (document.getElementById('searchingAnimation')) document.getElementById('searchingAnimation').classList.add('hidden');
        
        if (error) throw error;
        
        if (!data) {
            carreraActiva = null;
            container.innerHTML = '<p style="text-align:center;color:#6b7280;margin-top:2rem">No tienes viajes activos</p>';
            detenerTracking();
            return;
        }

        carreraActiva = data;
        
        if (!rutaLayer && data.origen_lat && data.destino_lat) {
             origenCoords = { lat: data.origen_lat, lng: data.origen_lng };
             destinoCoords = { lat: data.destino_lat, lng: data.destino_lng };
        }

        if (data.estado === 'buscando' || data.estado === 'solicitada') {
            mostrarTarjetaBusqueda(data);
        } else {
            await mostrarCarreraActiva(data);
            iniciarTracking(data);
        }
        if (window.expandSidebar) window.expandSidebar();

    } catch (e) { console.error(e); }
}

function mostrarTarjetaBusqueda(carrera) {
    const html = `
        <div class="card" style="border-top: 4px solid #f59e0b;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                <div class="mini-pulse-ring"></div>
                <h3 style="margin: 0; font-size: 1.1rem; color: #f59e0b;">Buscando...</h3>
            </div>
            <div style="margin: 10px 0; padding: 10px; background: #f9fafb; border-radius: 8px; font-size: 0.9em;">
                <div style="margin-bottom: 5px;"><strong>📍 Destino:</strong> ${carrera.destino_direccion.substring(0, 30)}...</div>
                <div><strong>💰 Precio:</strong> L ${carrera.precio}</div>
            </div>
            <button class="btn btn-danger" style="width:100%; font-size: 0.9em; padding: 10px;" onclick="cancelarCarrera('${carrera.id}')">✕ Cancelar Solicitud</button>
        </div>
    `;
    document.getElementById('carreraActiva').innerHTML = html;
}

async function mostrarCarreraActiva(carrera) {
    let conductorInfo = null;
    
    // CORRECCIÓN CRÍTICA: Validar si hay conductor antes de buscarlo
    if (carrera.conductor_id) {
        const { data } = await window.supabaseClient
            .from('conductores')
            .select('placa, modelo_moto, color, perfil:perfiles(nombre, telefono)')
            .eq('id', carrera.conductor_id).maybeSingle();
        conductorInfo = data;
    }
    
    const estados = { 'asignada': 'Asignado', 'aceptada': 'Aceptado', 'en_camino': 'En Camino', 'en_curso': 'En Curso' };
    const color = carrera.estado === 'en_curso' ? '#10b981' : '#3b82f6';
    
    // SAFE ACCESS: Usar ?. para evitar crash si conductorInfo es null
    const nombreCond = conductorInfo?.perfil?.nombre || 'Conductor';
    const motoCond = conductorInfo?.modelo_moto || '';
    const placaCond = conductorInfo?.placa || '';
    const telCond = conductorInfo?.perfil?.telefono || '';

    let html = `
        <div class="card" style="border-top: 4px solid ${color};">
            <h3>${estados[carrera.estado] || carrera.estado}</h3>
            <div style="margin: 10px 0; padding: 10px; background: #f0f9ff; border-radius: 8px;">
                <p><strong>Destino:</strong> ${carrera.destino_direccion}</p>
                <p><strong>Precio:</strong> L ${carrera.precio}</p>
            </div>
    `;
    
    if (conductorInfo) {
        html += `
            <div style="display:flex; align-items:center; gap:15px; margin-top:10px; padding-top:10px; border-top:1px solid #eee">
                <div style="font-size:35px;">🏍️</div>
                <div>
                    <p style="font-weight:bold; margin:0">${nombreCond}</p>
                    <p style="margin:0; font-size:0.8em; color:#666">${motoCond} • ${placaCond}</p>
                </div>
            </div>
            <div style="display:flex; gap:10px; margin-top:15px">
                <a href="tel:${telCond}" class="btn btn-primary" style="flex:1; justify-content:center;">📞</a>
                <a href="https://wa.me/504${telCond.replace(/-/g, '')}" class="btn btn-success" style="flex:1; justify-content:center;">💬</a>
            </div>
        `;
    }
    
    if (carrera.estado !== 'en_curso') {
        html += `<button class="btn btn-secondary" style="width:100%; margin-top:10px; color:#ef4444;" onclick="cancelarCarrera('${carrera.id}')">Cancelar Viaje</button>`;
    }
    html += `</div>`;
    document.getElementById('carreraActiva').innerHTML = html;
}

// ... Resto de funciones (cargarHistorial, cancelarCarrera, tracking, etc) igual que antes ...
// Asegurarse de incluir cargarHistorial, cancelarCarrera, limpiarMapaCompleto, iniciarTracking, detenerTracking, actualizarConductorEnMapa

async function cargarHistorial() {
    try {
        const { data } = await window.supabaseClient.from('carreras').select('*').eq('cliente_id', clienteId)
            .in('estado', ['completada', 'cancelada_cliente']).order('fecha_solicitud', { ascending: false }).limit(5);
        const div = document.getElementById('historialCarreras');
        if (!data || !data.length) { div.innerHTML = '<p style="text-align:center;color:#999">Sin historial.</p>'; return; }
        div.innerHTML = data.map(c => `
            <div class="card mb-1" style="border-left: 4px solid ${c.estado==='completada'?'#10b981':'#ef4444'};padding:0.8rem">
                <div style="display:flex;justify-content:space-between;font-size:0.85em">
                    <strong>${new Date(c.fecha_solicitud).toLocaleDateString()}</strong><span>${c.estado}</span>
                </div>
                <p style="font-size:0.8em;margin:5px 0">${c.destino_direccion.substring(0,25)}...</p>
                <strong style="color:#2563eb;font-size:0.9em">L ${c.precio}</strong>
            </div>`).join('');
    } catch(e){}
}

async function cancelarCarrera(id) {
    if(!confirm('¿Cancelar?')) return;
    mostrarLoader();
    try {
        await window.supabaseClient.from('carreras').update({ estado: 'cancelada_cliente' }).eq('id', id);
        limpiarMapaCompleto();
        await cargarCarreraActiva();
    } catch (e) { mostrarError(e.message); } finally { ocultarLoader(); }
}

function limpiarMapaCompleto() {
    if (rutaLayer) { mapa.removeLayer(rutaLayer); rutaLayer = null; }
    if (origenMarker) { mapa.removeLayer(origenMarker); origenMarker = null; }
    if (destinoMarker) { mapa.removeLayer(destinoMarker); destinoMarker = null; }
    origenCoords = null; destinoCoords = null;
    document.getElementById('origenDir').value = ''; document.getElementById('destinoDir').value = '';
    document.getElementById('resumenCarrera').style.display = 'none';
}

function iniciarTracking(carrera) {
    if (trackingInterval) clearInterval(trackingInterval);
    if (!carrera.conductor_id) return;
    trackingInterval = setInterval(async () => {
        const { data } = await window.supabaseClient.from('conductores').select('latitud, longitud, rumbo').eq('id', carrera.conductor_id).maybeSingle();
        if (data && data.latitud) actualizarConductorEnMapa(data.latitud, data.longitud, data.rumbo);
    }, 4000);
}

function detenerTracking() {
    if (trackingInterval) clearInterval(trackingInterval);
    if (conductorMarker) { mapa.removeLayer(conductorMarker); conductorMarker = null; }
}

function actualizarConductorEnMapa(lat, lng, rumbo) {
    const icon = L.divIcon({ html: `<div style="transform: rotate(${rumbo||0}deg); font-size: 30px;">🏍️</div>`, className: 'emoji-marker', iconSize: [40, 40] });
    if (conductorMarker) { conductorMarker.setLatLng([lat, lng]); conductorMarker.setIcon(icon); }
    else { conductorMarker = L.marker([lat, lng], { icon: icon }).addTo(mapa); }
}

function suscribirseACambios() {
    window.supabaseClient.channel('cliente-updates').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'carreras', filter: `cliente_id=eq.${clienteId}` }, 
        (payload) => {
            const nueva = payload.new;
            if (nueva.estado === 'aceptada') { mostrarNotificacion('¡Conductor encontrado! 🎉'); reproducirSonido(); }
            else if (nueva.estado === 'completada') { alert('Viaje finalizado. L ' + nueva.precio); detenerTracking(); limpiarMapaCompleto(); }
            cargarCarreraActiva();
        }).subscribe();
}

function inyectarEstilosAnimacion() {
    const style = document.createElement('style');
    style.innerHTML = `.mini-pulse-ring { width: 15px; height: 15px; border-radius: 50%; background: #fcd34d; display: inline-block; }`;
    document.head.appendChild(style);
}

function mostrarLoader() { document.getElementById('loader').classList.remove('hidden'); }
function ocultarLoader() { document.getElementById('loader').classList.add('hidden'); }
function mostrarError(m) { console.error(m); alert(m); }
function mostrarNotificacion(m) {
    const n = document.createElement('div'); n.className = 'notification'; n.textContent = m;
    n.style.cssText = `position: fixed; top: 10px; right: 10px; background: white; padding: 10px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.2); z-index: 10000; animation: slideIn 0.3s;`;
    document.body.appendChild(n); setTimeout(() => n.remove(), 4000);
}
function reproducirSonido() { try { document.getElementById('notificationSound').play().catch(e => {}); } catch(e){} }
function abrirModalCarrera() { document.getElementById('modalCarrera').classList.add('active'); }
function cerrarModal() { document.getElementById('modalCarrera').classList.remove('active'); limpiarSeleccion(); }
function limpiarSeleccion() { if (modoSeleccion) return; document.getElementById('resumenCarrera').style.display = 'none'; }
function seleccionarTipo(t) {
    document.getElementById('tipoCarrera').value = t;
    document.querySelectorAll('.tipo-card').forEach(c => c.classList.remove('active'));
    event.currentTarget.classList.add('active');
    if(origenCoords && destinoCoords) calcularRuta();
}
window.addEventListener('load', init);
