// ============================================
// APP CLIENTE - MOTOTAXIS (VERSIÓN MOBILE FIX)
// ============================================

console.log('=== INICIANDO APP CLIENTE ===');

let mapa, usuario, clienteId;
let carreraActiva = null;
let origenMarker = null, destinoMarker = null, rutaLayer = null, conductorMarker = null;
let ubicacionActualMarker = null;
let modoSeleccion = null;
let origenCoords = null, destinoCoords = null;
let trackingInterval = null;

// ============================================
// 1. INICIALIZACIÓN
// ============================================

async function init() {
    console.log('1. Iniciando app cliente...');
    
    try {
        await esperarSupabase();
        const sesionValida = await verificarSesion();
        if (!sesionValida) return;
        
        await cargarDatosCliente();
        
        inicializarMapa();
        inyectarEstilosAnimacion();

        if (typeof PRICING_CONFIG !== 'undefined') await PRICING_CONFIG.cargarDesdeDB();

        await cargarCarreraActiva();
        await cargarHistorial();
        suscribirseACambios();
        
        console.log('=== ✅ APP CLIENTE LISTA ===');
        ocultarLoader();
        
    } catch (error) {
        console.error('=== ❌ ERROR EN INIT ===', error);
        mostrarError('Error al iniciar: ' + error.message);
        ocultarLoader();
    }
}

async function esperarSupabase() {
    return new Promise((resolve, reject) => {
        if (window.supabaseClient) { resolve(); return; }
        let intentos = 0;
        const interval = setInterval(() => {
            intentos++;
            if (window.supabaseClient) { clearInterval(interval); resolve(); } 
            else if (intentos >= 50) { clearInterval(interval); reject(new Error('Timeout DB')); }
        }, 100);
    });
}

async function verificarSesion() {
    try {
        const { data: { session }, error } = await window.supabaseClient.auth.getSession();
        if (error) throw error;
        if (!session) { window.location.href = 'login.html'; return false; }
        
        usuario = session.user;
        const { data: perfil, error: perfilError } = await window.supabaseClient
            .from('perfiles').select('nombre, rol').eq('id', usuario.id).maybeSingle();
            
        if (perfilError) throw perfilError;
        if (!perfil || perfil.rol !== 'cliente') {
            alert('No tienes permisos de cliente.');
            await window.supabaseClient.auth.signOut();
            window.location.href = 'login.html';
            return false;
        }
        
        const welcomeMsg = document.getElementById('welcomeMsg');
        if (welcomeMsg) {
            welcomeMsg.style.display = 'inline';
            welcomeMsg.textContent = perfil.nombre;
        }
        return true;
    } catch (error) {
        console.error('Error sesión:', error);
        throw error;
    }
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
    
    // Zoom arriba derecha
    L.control.zoom({ position: 'topright' }).addTo(mapa);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapa);
    
    mapa.on('click', (e) => { if (modoSeleccion) seleccionarUbicacion(e.latlng); });
    obtenerUbicacionActual();
}

function obtenerUbicacionActual() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            mapa.flyTo([lat, lng], 16, { animate: true, duration: 1.5 });

            const puntoAzulHtml = `<div style="background-color:#4285F4; width:15px; height:15px; border-radius:50%; border:2px solid white; box-shadow:0 0 0 10px rgba(66,133,244,0.2);"></div>`;
            const iconPunto = L.divIcon({ className: 'gps-user-location', html: puntoAzulHtml, iconSize: [20, 20], iconAnchor: [10, 10] });

            if (ubicacionActualMarker) mapa.removeLayer(ubicacionActualMarker);
            ubicacionActualMarker = L.marker([lat, lng], { icon: iconPunto }).addTo(mapa);
            
            if (!origenCoords) setTimeout(() => { seleccionarUbicacion({ lat, lng }, true); }, 2000);
        },
        () => console.warn('GPS no disponible'), { enableHighAccuracy: true }
    );
}

function seleccionarOrigen() {
    modoSeleccion = 'origen';
    cerrarModal();
    mostrarNotificacion('📍 Marca el ORIGEN en el mapa');
}

function seleccionarDestino() {
    modoSeleccion = 'destino';
    cerrarModal();
    mostrarNotificacion('🏁 Marca el DESTINO en el mapa');
}

async function seleccionarUbicacion(latlng, esAutomatico = false) {
    if (esAutomatico) modoSeleccion = 'origen';
    if (!modoSeleccion && !esAutomatico) return;

    const direccion = await obtenerDireccion(latlng.lat, latlng.lng);
    
    if (modoSeleccion === 'origen') {
        origenCoords = { lat: latlng.lat, lng: latlng.lng, dir: direccion };
        if (origenMarker) mapa.removeLayer(origenMarker);
        origenMarker = L.marker([latlng.lat, latlng.lng], { icon: L.divIcon({ html: '📍', className: 'emoji-marker' }) }).addTo(mapa);
        document.getElementById('origenDir').value = direccion;
    } else {
        destinoCoords = { lat: latlng.lat, lng: latlng.lng, dir: direccion };
        if (destinoMarker) mapa.removeLayer(destinoMarker);
        destinoMarker = L.marker([latlng.lat, latlng.lng], { icon: L.divIcon({ html: '🏁', className: 'emoji-marker' }) }).addTo(mapa);
        document.getElementById('destinoDir').value = direccion;
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
    // Deshabilitar botón mientras calcula
    const btn = document.getElementById('btnSolicitar');
    if(btn) { btn.disabled = true; btn.textContent = "Calculando..."; }

    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${origenCoords.lng},${origenCoords.lat};${destinoCoords.lng},${destinoCoords.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.routes && data.routes[0]) {
            const route = data.routes[0];
            const distanciaKm = route.distance / 1000;
            // +30% tiempo por tráfico/espera
            const tiempoMin = Math.ceil((route.duration / 60) * 1.3);
            
            const tipo = document.getElementById('tipoCarrera').value;
            let precio = 0;
            
            if (typeof PRICING_CONFIG !== 'undefined') {
                precio = PRICING_CONFIG.calcularPrecio(distanciaKm, tipo === 'colectivo');
            } else {
                precio = Math.max(distanciaKm * 15, 30);
            }
            
            document.getElementById('resDistancia').textContent = distanciaKm.toFixed(2) + ' km';
            document.getElementById('resTiempo').textContent = tiempoMin + ' min';
            document.getElementById('resPrecio').textContent = 'L ' + precio.toFixed(2);
            document.getElementById('resumenCarrera').style.display = 'block';
            
            if (rutaLayer) mapa.removeLayer(rutaLayer);
            rutaLayer = L.geoJSON(route.geometry, { style: { color: '#2563eb', weight: 4 } }).addTo(mapa);
            mapa.fitBounds(rutaLayer.getBounds(), { padding: [50, 50] });

            // HABILITAR BOTÓN AHORA QUE HAY DATOS
            if(btn) { btn.disabled = false; btn.textContent = "Pedir Mototaxi"; }
        }
    } catch (error) {
        console.error('Error ruta:', error);
        if(btn) btn.textContent = "Error al calcular";
    }
}

// ============================================
// 3. LOGICA CARRERAS
// ============================================

async function solicitarCarrera() {
    if (!origenCoords || !destinoCoords) { mostrarNotificacion('⚠️ Faltan datos'); return; }
    
    const tipo = document.getElementById('tipoCarrera').value;
    const distancia = parseFloat(document.getElementById('resDistancia').textContent);
    const tiempo = parseInt(document.getElementById('resTiempo').textContent);
    const precio = parseFloat(document.getElementById('resPrecio').textContent.replace('L ', ''));
    
    try {
        mostrarLoader();
        const { error } = await window.supabaseClient.from('carreras').insert({
            tipo, cliente_id: clienteId,
            origen_direccion: origenCoords.dir, origen_lat: origenCoords.lat, origen_lng: origenCoords.lng,
            destino_direccion: destinoCoords.dir, destino_lat: destinoCoords.lat, destino_lng: destinoCoords.lng,
            distancia_km: distancia, tiempo_estimado_min: tiempo, precio, estado: 'buscando'
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
        
        if (error) throw error;
        
        if (!data) {
            carreraActiva = null;
            container.innerHTML = '<p style="text-align:center;color:#6b7280;margin-top:2rem">No tienes viajes activos</p>';
            detenerTracking();
            return;
        }

        carreraActiva = data;
        
        // Recuperar ruta visual si se perdió
        if (!rutaLayer && data.origen_lat && data.destino_lat) {
             origenCoords = { lat: data.origen_lat, lng: data.origen_lng };
             destinoCoords = { lat: data.destino_lat, lng: data.destino_lng };
        }

        // LÓGICA DE UI
        if (data.estado === 'buscando' || data.estado === 'solicitada') {
            mostrarTarjetaBusqueda(data);
        } else {
            await mostrarCarreraActiva(data);
            iniciarTracking(data);
        }

        // AUTO EXPANDIR PANEL (Móvil)
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
            
            <button class="btn btn-danger" style="width:100%; font-size: 0.9em; padding: 10px;" onclick="cancelarCarrera('${carrera.id}')">
                ✕ Cancelar Solicitud
            </button>
        </div>
    `;
    document.getElementById('carreraActiva').innerHTML = html;
}

async function mostrarCarreraActiva(carrera) {
    let conductorInfo = null;
    if (carrera.conductor_id) {
        const { data } = await window.supabaseClient
            .from('conductores')
            .select('placa, modelo_moto, color, perfil:perfiles(nombre, telefono)')
            .eq('id', carrera.conductor_id).maybeSingle();
        conductorInfo = data;
    }
    
    const estados = { 'asignada': 'Asignado', 'aceptada': 'Aceptado', 'en_camino': 'En Camino', 'en_curso': 'En Curso' };
    const color = carrera.estado === 'en_curso' ? '#10b981' : '#3b82f6';
    
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
                    <p style="font-weight:bold; margin:0">${conductorInfo.perfil.nombre}</p>
                    <p style="margin:0; font-size:0.8em; color:#666">${conductorInfo.modelo_moto} • ${conductorInfo.placa}</p>
                </div>
            </div>
            <div style="display:flex; gap:10px; margin-top:15px">
                <a href="tel:${conductorInfo.perfil.telefono}" class="btn btn-primary" style="flex:1; justify-content:center;">📞</a>
                <a href="https://wa.me/504${conductorInfo.perfil.telefono.replace(/-/g, '')}" class="btn btn-success" style="flex:1; justify-content:center;">💬</a>
            </div>
        `;
    }
    
    if (carrera.estado !== 'en_curso') {
        html += `<button class="btn btn-secondary" style="width:100%; margin-top:10px; color:#ef4444;" onclick="cancelarCarrera('${carrera.id}')">Cancelar Viaje</button>`;
    }
    html += `</div>`;
    document.getElementById('carreraActiva').innerHTML = html;
}

async function cargarHistorial() {
    try {
        const { data } = await window.supabaseClient
            .from('carreras').select('*').eq('cliente_id', clienteId)
            .in('estado', ['completada', 'cancelada_cliente', 'cancelada_conductor'])
            .order('fecha_solicitud', { ascending: false }).limit(5);
            
        const divHistorial = document.getElementById('historialCarreras');
        if (!data || data.length === 0) {
            divHistorial.innerHTML = '<p style="text-align:center; color:#999; font-size:0.9em">Sin historial reciente.</p>';
            return;
        }
        
        divHistorial.innerHTML = data.map(c => `
            <div class="card mb-1" style="border-left: 4px solid ${c.estado === 'completada' ? '#10b981' : '#ef4444'}; padding:0.8rem">
                <div style="display:flex; justify-content:space-between; font-size:0.85em">
                    <strong>${new Date(c.fecha_solicitud).toLocaleDateString()}</strong>
                    <span>${c.estado === 'completada' ? 'Completado' : 'Cancelado'}</span>
                </div>
                <p style="font-size:0.8em; margin:5px 0">${c.destino_direccion.substring(0,25)}...</p>
                <strong style="color:#2563eb; font-size:0.9em">L ${c.precio}</strong>
            </div>
        `).join('');
    } catch (e) { console.error(e); }
}

async function cancelarCarrera(id) {
    if(!confirm('¿Cancelar viaje?')) return;
    mostrarLoader();
    try {
        await window.supabaseClient.from('carreras').update({ estado: 'cancelada_cliente' }).eq('id', id);
        mostrarNotificacion('Viaje cancelado');
        limpiarMapaCompleto();
        await cargarCarreraActiva();
    } catch (e) { mostrarError(e.message); } 
    finally { ocultarLoader(); }
}

function limpiarMapaCompleto() {
    if (rutaLayer) { mapa.removeLayer(rutaLayer); rutaLayer = null; }
    if (origenMarker) { mapa.removeLayer(origenMarker); origenMarker = null; }
    if (destinoMarker) { mapa.removeLayer(destinoMarker); destinoMarker = null; }
    origenCoords = null; destinoCoords = null;
    document.getElementById('origenDir').value = '';
    document.getElementById('destinoDir').value = '';
    document.getElementById('resumenCarrera').style.display = 'none';
}

function iniciarTracking(carrera) {
    if (trackingInterval) clearInterval(trackingInterval);
    if (!carrera.conductor_id) return;
    trackingInterval = setInterval(async () => {
        const { data } = await window.supabaseClient.from('conductores')
            .select('latitud, longitud, rumbo').eq('id', carrera.conductor_id).maybeSingle();
        if (data && data.latitud) actualizarConductorEnMapa(data.latitud, data.longitud, data.rumbo);
    }, 4000);
}

function detenerTracking() {
    if (trackingInterval) clearInterval(trackingInterval);
    if (conductorMarker) { mapa.removeLayer(conductorMarker); conductorMarker = null; }
}

function actualizarConductorEnMapa(lat, lng, rumbo) {
    const iconHtml = `<div style="transform: rotate(${rumbo || 0}deg); font-size: 30px;">🏍️</div>`;
    const motoIcon = L.divIcon({ html: iconHtml, className: 'emoji-marker', iconSize: [40, 40] });
    if (conductorMarker) { conductorMarker.setLatLng([lat, lng]); conductorMarker.setIcon(motoIcon); }
    else { conductorMarker = L.marker([lat, lng], { icon: motoIcon }).addTo(mapa); }
}

function suscribirseACambios() {
    window.supabaseClient.channel('cliente-updates')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'carreras', filter: `cliente_id=eq.${clienteId}` }, 
        (payload) => {
            const nueva = payload.new;
            if (nueva.estado === 'aceptada') { mostrarNotificacion('¡Conductor encontrado! 🎉'); reproducirSonido(); }
            else if (nueva.estado === 'en_camino') mostrarNotificacion('Conductor cerca 📍');
            else if (nueva.estado === 'completada') { alert('Viaje finalizado. L ' + nueva.precio); detenerTracking(); limpiarMapaCompleto(); }
            cargarCarreraActiva();
        }).subscribe();
}

function inyectarEstilosAnimacion() {
    const style = document.createElement('style');
    style.innerHTML = `
        .mini-pulse-ring { width: 15px; height: 15px; border-radius: 50%; background: #fcd34d; position: relative; display: inline-block; }
        .mini-pulse-ring::before { content: ''; position: absolute; left: -5px; top: -5px; width: 25px; height: 25px; border-radius: 50%; border: 2px solid #f59e0b; animation: mini-pulse 1.5s infinite; }
        @keyframes mini-pulse { 0% { transform: scale(0.5); opacity: 1; } 100% { transform: scale(1.2); opacity: 0; } }
    `;
    document.head.appendChild(style);
}

function mostrarLoader() { document.getElementById('loader').classList.remove('hidden'); }
function ocultarLoader() { document.getElementById('loader').classList.add('hidden'); }
function mostrarError(m) { console.error(m); mostrarNotificacion('❌ ' + m); }
function mostrarNotificacion(m) {
    const n = document.createElement('div'); n.className = 'notification'; n.textContent = m;
    n.style.cssText = `position: fixed; top: 10px; right: 10px; background: white; padding: 10px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.2); z-index: 10000; animation: slideIn 0.3s;`;
    document.body.appendChild(n); setTimeout(() => n.remove(), 4000);
}
function reproducirSonido() { try { document.getElementById('notificationSound').play(); } catch(e){} }
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
