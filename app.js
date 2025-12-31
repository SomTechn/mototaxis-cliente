// ============================================
// APP CLIENTE - MOTOTAXIS V2
// ============================================

console.log('=== INICIANDO APP CLIENTE ===');

let mapa, usuario, clienteId;
let carreraActiva = null;
let origenMarker = null, destinoMarker = null, rutaLayer = null, conductorMarker = null;
let modoSeleccion = null;
let origenCoords = null, destinoCoords = null;
let trackingInterval = null;

// ============================================
// INICIALIZACIÓN
// ============================================

async function init() {
    console.log('1. Iniciando app cliente...');
    
    try {
        await esperarSupabase();
        const sesionValida = await verificarSesion();
        if (!sesionValida) return;
        
        await cargarDatosCliente();
        
        inicializarMapa();
        inicializarEventos();
        
        // Cargar precios desde DB (definido en config.js)
        if (typeof PRICING_CONFIG !== 'undefined') {
            await PRICING_CONFIG.cargarDesdeDB();
        }

        await cargarCarreraActiva();
        await cargarHistorial();
        suscribirseACambios();
        
        console.log('=== ✅ APP CLIENTE INICIADA ===');
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
            if (window.supabaseClient) {
                clearInterval(interval);
                resolve();
            } else if (intentos >= 50) {
                clearInterval(interval);
                reject(new Error('No se pudo cargar Supabase'));
            }
        }, 100);
    });
}

async function verificarSesion() {
    try {
        const { data: { session }, error } = await window.supabaseClient.auth.getSession();
        if (error) throw error;
        if (!session) { window.location.href = 'login.html'; return false; }
        
        usuario = session.user;
        const { data: perfil } = await window.supabaseClient
            .from('perfiles').select('nombre, rol').eq('id', usuario.id).single();
            
        if (!perfil || perfil.rol !== 'cliente') {
            alert('No tienes permisos de cliente');
            await window.supabaseClient.auth.signOut();
            window.location.href = 'login.html';
            return false;
        }
        
        document.getElementById('welcomeMsg').textContent = 'Hola, ' + perfil.nombre;
        return true;
    } catch (error) {
        console.error('Error sesión:', error);
        throw error;
    }
}

async function cargarDatosCliente() {
    const { data: cliente, error } = await window.supabaseClient
        .from('clientes').select('id').eq('perfil_id', usuario.id).single();
    if (error || !cliente) throw new Error('Cliente no encontrado');
    clienteId = cliente.id;
}

// ============================================
// MAPA Y SOLICITUDES
// ============================================

function inicializarMapa() {
    // Usar centro por defecto de config.js o Tegucigalpa
    const centro = (typeof MAP_CONFIG !== 'undefined') ? MAP_CONFIG.defaultCenter : [14.0723, -87.1921];
    mapa = L.map('map').setView(centro, 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© OpenStreetMap'
    }).addTo(mapa);
    
    mapa.on('click', (e) => {
        if (modoSeleccion) seleccionarUbicacion(e.latlng);
    });
}

function inicializarEventos() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        });
    });
}

// Funciones de selección (Origen/Destino) igual que antes...
function seleccionarOrigen() {
    modoSeleccion = 'origen';
    document.body.style.cursor = 'crosshair';
    cerrarModal();
    mostrarNotificacion('Click en el mapa para seleccionar origen');
}

function seleccionarDestino() {
    modoSeleccion = 'destino';
    document.body.style.cursor = 'crosshair';
    cerrarModal();
    mostrarNotificacion('Click en el mapa para seleccionar destino');
}

async function seleccionarUbicacion(latlng) {
    const direccion = await obtenerDireccion(latlng.lat, latlng.lng);
    
    if (modoSeleccion === 'origen') {
        origenCoords = { lat: latlng.lat, lng: latlng.lng, dir: direccion };
        if (origenMarker) mapa.removeLayer(origenMarker);
        origenMarker = L.marker(latlng, {
            icon: L.divIcon({ html: '📍', className: 'emoji-marker' })
        }).addTo(mapa);
        document.getElementById('origenDir').value = direccion;
    } else {
        destinoCoords = { lat: latlng.lat, lng: latlng.lng, dir: direccion };
        if (destinoMarker) mapa.removeLayer(destinoMarker);
        destinoMarker = L.marker(latlng, {
            icon: L.divIcon({ html: '🏁', className: 'emoji-marker' })
        }).addTo(mapa);
        document.getElementById('destinoDir').value = direccion;
    }
    
    modoSeleccion = null;
    document.body.style.cursor = 'default';
    abrirModalCarrera();
    
    if (origenCoords && destinoCoords) await calcularRuta();
}

async function obtenerDireccion(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
        const res = await fetch(url);
        const data = await res.json();
        return data.display_name?.split(',')[0] || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch {
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
}

async function calcularRuta() {
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${origenCoords.lng},${origenCoords.lat};${destinoCoords.lng},${destinoCoords.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.routes && data.routes[0]) {
            const route = data.routes[0];
            const distanciaKm = route.distance / 1000;
            const tiempoMin = Math.ceil(route.duration / 60 * 1.3); // +30% por tráfico
            
            const tipo = document.getElementById('tipoCarrera').value;
            
            // USAR PRICING CONFIG
            let precio = 0;
            if (typeof PRICING_CONFIG !== 'undefined') {
                precio = PRICING_CONFIG.calcularPrecio(distanciaKm, tipo === 'colectivo');
            } else {
                // Fallback si no carga config
                precio = Math.max(distanciaKm * 15, 30);
                if (tipo === 'colectivo') precio *= 0.7;
            }
            
            document.getElementById('resDistancia').textContent = distanciaKm.toFixed(2) + ' km';
            document.getElementById('resTiempo').textContent = tiempoMin + ' min';
            document.getElementById('resPrecio').textContent = 'L ' + precio.toFixed(2);
            document.getElementById('resumenCarrera').style.display = 'block';
            
            if (rutaLayer) mapa.removeLayer(rutaLayer);
            rutaLayer = L.geoJSON(route.geometry, { style: { color: '#2563eb', weight: 4 } }).addTo(mapa);
            mapa.fitBounds(rutaLayer.getBounds(), { padding: [50, 50] });
        }
    } catch (error) {
        console.error('Error ruta:', error);
    }
}

async function solicitarCarrera() {
    if (!origenCoords || !destinoCoords) {
        alert('Selecciona origen y destino');
        return;
    }
    
    const tipo = document.getElementById('tipoCarrera').value;
    const distancia = parseFloat(document.getElementById('resDistancia').textContent);
    const tiempo = parseInt(document.getElementById('resTiempo').textContent);
    // Parseamos el precio correctamente quitando "L "
    const precioTexto = document.getElementById('resPrecio').textContent.replace('L ', '');
    const precio = parseFloat(precioTexto);
    
    try {
        mostrarLoader();
        
        const { data, error } = await window.supabaseClient
            .from('carreras')
            .insert({
                tipo,
                cliente_id: clienteId,
                origen_direccion: origenCoords.dir,
                origen_lat: origenCoords.lat,
                origen_lng: origenCoords.lng,
                destino_direccion: destinoCoords.dir,
                destino_lat: destinoCoords.lat,
                destino_lng: destinoCoords.lng,
                distancia_km: distancia,
                tiempo_estimado_min: tiempo,
                precio,
                estado: 'buscando' // Estado inicial para que los conductores lo vean
            })
            .select()
            .single();
        
        if (error) throw error;
        
        cerrarModal();
        limpiarSeleccion();
        mostrarNotificacion('¡Solicitud enviada! Buscando conductor cercano...');
        await cargarCarreraActiva();
        
    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
    } finally {
        ocultarLoader();
    }
}

// ============================================
// GESTIÓN DE CARRERA ACTIVA
// ============================================

async function cargarCarreraActiva() {
    try {
        const { data, error } = await window.supabaseClient
            .from('carreras')
            .select('*')
            .eq('cliente_id', clienteId)
            .in('estado', ['solicitada', 'buscando', 'asignada', 'aceptada', 'en_camino', 'en_curso'])
            .order('fecha_solicitud', { ascending: false })
            .limit(1)
            .single();
            
        // Limpiar UI anterior
        const container = document.getElementById('carreraActiva');
        const searchingUI = document.getElementById('searchingAnimation');
        
        if (error && error.code !== 'PGRST116') throw error;
        
        if (data) {
            carreraActiva = data;
            
            // Si está buscando, mostrar animación
            if (data.estado === 'buscando' || data.estado === 'solicitada') {
                container.classList.add('hidden');
                searchingUI.classList.remove('hidden');
            } else {
                container.classList.remove('hidden');
                searchingUI.classList.add('hidden');
                await mostrarCarreraActiva(data);
                iniciarTracking(data);
            }
        } else {
            carreraActiva = null;
            container.innerHTML = '<p style="text-align:center;color:#6b7280;margin-top:2rem">No tienes carreras activas</p>';
            container.classList.remove('hidden');
            searchingUI.classList.add('hidden');
            detenerTracking();
        }
    } catch (error) {
        console.error('Error carrera activa:', error);
    }
}

async function mostrarCarreraActiva(carrera) {
    let conductorInfo = null;
    if (carrera.conductor_id) {
        const { data } = await window.supabaseClient
            .from('conductores')
            .select('placa, modelo_moto, color, perfil:perfiles(nombre, telefono)')
            .eq('id', carrera.conductor_id)
            .single();
        conductorInfo = data;
    }
    
    const estados = {
        'asignada': 'Conductor Asignado',
        'aceptada': 'Conductor Aceptó',
        'en_camino': 'Conductor en Camino',
        'en_curso': 'Viaje en Curso'
    };
    
    let html = `
        <div class="card">
            <h3>${estados[carrera.estado] || carrera.estado}</h3>
            <div style="margin: 10px 0; padding: 10px; background: #f0f9ff; border-radius: 8px;">
                <p><strong>Destino:</strong> ${carrera.destino_direccion}</p>
                <p><strong>Precio:</strong> L ${carrera.precio}</p>
            </div>
    `;
    
    if (conductorInfo) {
        html += `
            <div style="display:flex; align-items:center; gap:10px; margin-top:10px">
                <div style="font-size:40px">🏍️</div>
                <div>
                    <p style="font-weight:bold; margin:0">${conductorInfo.perfil.nombre}</p>
                    <p style="margin:0; font-size:0.9em; color:#666">
                        ${conductorInfo.modelo_moto} ${conductorInfo.color} <br>
                        Placa: ${conductorInfo.placa}
                    </p>
                </div>
            </div>
            <a href="tel:${conductorInfo.perfil.telefono}" class="btn btn-primary" style="width:100%; justify-content:center; margin-top:10px">
                📞 Llamar Conductor
            </a>
        `;
    }
    
    html += `
            <button class="btn btn-danger" style="width:100%; margin-top:10px" onclick="cancelarCarrera('${carrera.id}')">
                Cancelar Viaje
            </button>
        </div>
    `;
    
    document.getElementById('carreraActiva').innerHTML = html;
}

// ============================================
// TRACKING TIEMPO REAL
// ============================================

function iniciarTracking(carrera) {
    if (trackingInterval) clearInterval(trackingInterval);
    if (!carrera.conductor_id) return;
    
    // Polling cada 4 segundos
    trackingInterval = setInterval(async () => {
        try {
            const { data } = await window.supabaseClient
                .from('conductores')
                .select('latitud, longitud, rumbo')
                .eq('id', carrera.conductor_id)
                .single();
            
            if (data && data.latitud) {
                actualizarConductorEnMapa(data.latitud, data.longitud, data.rumbo);
            }
        } catch (e) { console.warn(e); }
    }, 4000);
}

function detenerTracking() {
    if (trackingInterval) clearInterval(trackingInterval);
    if (conductorMarker) {
        mapa.removeLayer(conductorMarker);
        conductorMarker = null;
    }
}

function actualizarConductorEnMapa(lat, lng, rumbo) {
    // Ícono rotado según el rumbo
    const iconHtml = `
        <div style="transform: rotate(${rumbo || 0}deg); transition: transform 0.5s;">
            🏍️
        </div>`;
        
    const motoIcon = L.divIcon({ 
        html: iconHtml, 
        className: 'emoji-marker', 
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });

    if (conductorMarker) {
        conductorMarker.setLatLng([lat, lng]);
        conductorMarker.setIcon(motoIcon);
    } else {
        conductorMarker = L.marker([lat, lng], { icon: motoIcon }).addTo(mapa).bindPopup('Tu conductor');
    }

    // Notificación de proximidad
    if (carreraActiva && carreraActiva.estado === 'en_camino' && origenCoords) {
        const dist = UTILS.calcularDistancia(lat, lng, origenCoords.lat, origenCoords.lng);
        if (dist < 0.2) { // Menos de 200 metros
            mostrarNotificacion('¡Tu conductor está llegando!', 'Por favor prepárate.');
        }
    }
}

// ============================================
// UTILIDADES Y MODALES
// ============================================

function abrirModalCarrera() { document.getElementById('modalCarrera').classList.add('active'); }
function cerrarModal() { document.getElementById('modalCarrera').classList.remove('active'); limpiarSeleccion(); }
function limpiarSeleccion() {
    // No limpiamos si estamos en medio de selección
    if (modoSeleccion) return;
    document.getElementById('resumenCarrera').style.display = 'none';
}

async function cancelarCarrera(id) {
    if(!confirm('¿Seguro deseas cancelar?')) return;
    mostrarLoader();
    await window.supabaseClient.from('carreras')
        .update({ estado: 'cancelada_cliente' }).eq('id', id);
    mostrarNotificacion('Carrera cancelada');
    await cargarCarreraActiva();
    ocultarLoader();
}

function suscribirseACambios() {
    window.supabaseClient
        .channel('cliente-updates')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'carreras', filter: `cliente_id=eq.${clienteId}` }, 
        (payload) => {
            const nueva = payload.new;
            if (nueva.estado === 'aceptada') {
                mostrarNotificacion('¡Conductor encontrado!');
                reproducirSonido();
            } else if (nueva.estado === 'completada') {
                alert('Viaje finalizado. Precio: L ' + nueva.precio);
                detenerTracking();
            }
            cargarCarreraActiva();
        })
        .subscribe();
}

function mostrarLoader() { document.getElementById('loader').classList.remove('hidden'); }
function ocultarLoader() { document.getElementById('loader').classList.add('hidden'); }
function mostrarNotificacion(msg) {
    const n = document.createElement('div');
    n.className = 'notification';
    n.textContent = msg;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 4000);
}
function reproducirSonido() { try { document.getElementById('notificationSound').play(); } catch(e){} }
function seleccionarTipo(t) {
    document.getElementById('tipoCarrera').value = t;
    document.querySelectorAll('.tipo-card').forEach(c => c.classList.remove('active'));
    event.currentTarget.classList.add('active');
    if(origenCoords && destinoCoords) calcularRuta();
}

// Inicialización global
window.addEventListener('load', init);
