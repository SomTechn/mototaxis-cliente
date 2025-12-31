// ============================================
// APP CLIENTE - MOTOTAXIS
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
        if (window.supabaseClient) {
            console.log('✅ Supabase ya está listo');
            resolve();
            return;
        }
        
        let intentos = 0;
        const interval = setInterval(() => {
            intentos++;
            
            if (window.supabaseClient) {
                clearInterval(interval);
                console.log('✅ Supabase conectado');
                resolve();
            } else if (intentos >= 50) {
                clearInterval(interval);
                reject(new Error('No se pudo cargar Supabase'));
            }
        }, 100);
    });
}

async function verificarSesion() {
    console.log('2. Verificando sesión...');
    
    try {
        const { data: { session }, error } = await window.supabaseClient.auth.getSession();
        
        if (error) throw error;
        
        if (!session) {
            window.location.href = 'login.html';
            return false;
        }
        
        usuario = session.user;
        console.log('✅ Sesión:', usuario.email);
        
        const { data: perfil, error: perfilError } = await window.supabaseClient
            .from('perfiles')
            .select('nombre, rol')
            .eq('id', usuario.id)
            .single();
        
        if (perfilError) throw perfilError;
        
        if (!perfil || perfil.rol !== 'cliente') {
            alert('No tienes permisos de cliente');
            await window.supabaseClient.auth.signOut();
            window.location.href = 'login.html';
            return false;
        }
        
        const welcomeMsg = document.getElementById('welcomeMsg');
        if (welcomeMsg) {
            welcomeMsg.textContent = 'Hola, ' + perfil.nombre;
        }
        
        console.log('✅ Perfil:', perfil.nombre);
        return true;
        
    } catch (error) {
        console.error('Error verificando sesión:', error);
        throw error;
    }
}

async function cargarDatosCliente() {
    console.log('3. Cargando datos de cliente...');
    
    try {
        const { data: cliente, error } = await window.supabaseClient
            .from('clientes')
            .select('id')
            .eq('perfil_id', usuario.id)
            .single();
        
        if (error) throw error;
        if (!cliente) throw new Error('Registro de cliente no encontrado');
        
        clienteId = cliente.id;
        console.log('✅ Cliente ID:', clienteId);
        
    } catch (error) {
        console.error('Error cargando datos cliente:', error);
        throw error;
    }
}

// ============================================
// MAPA
// ============================================

function inicializarMapa() {
    mapa = L.map('map').setView([14.0723, -87.1921], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© OpenStreetMap'
    }).addTo(mapa);
    
    mapa.on('click', (e) => {
        if (modoSeleccion) {
            seleccionarUbicacion(e.latlng);
        }
    });
    
    console.log('✅ Mapa inicializado');
}

// ============================================
// EVENTOS
// ============================================

function inicializarEventos() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        });
    });
}

function abrirModalCarrera() {
    document.getElementById('modalCarrera').classList.add('active');
}

function cerrarModal() {
    document.getElementById('modalCarrera').classList.remove('active');
    limpiarSeleccion();
}

function seleccionarOrigen() {
    modoSeleccion = 'origen';
    document.body.style.cursor = 'crosshair';
    cerrarModal();
    mostrarNotificacion('Click en el mapa para seleccionar tu ubicación');
}

function seleccionarDestino() {
    modoSeleccion = 'destino';
    document.body.style.cursor = 'crosshair';
    cerrarModal();
    mostrarNotificacion('Click en el mapa para seleccionar el destino');
}

async function seleccionarUbicacion(latlng) {
    const direccion = await obtenerDireccion(latlng.lat, latlng.lng);
    
    if (modoSeleccion === 'origen') {
        origenCoords = { lat: latlng.lat, lng: latlng.lng, dir: direccion };
        
        if (origenMarker) mapa.removeLayer(origenMarker);
        origenMarker = L.marker(latlng, {
            icon: L.divIcon({ html: '📍', className: 'emoji-marker', iconSize: [30, 30] })
        }).addTo(mapa).bindPopup('Origen: ' + direccion);
        
        document.getElementById('origenDir').value = direccion;
    } else {
        destinoCoords = { lat: latlng.lat, lng: latlng.lng, dir: direccion };
        
        if (destinoMarker) mapa.removeLayer(destinoMarker);
        destinoMarker = L.marker(latlng, {
            icon: L.divIcon({ html: '🏁', className: 'emoji-marker', iconSize: [30, 30] })
        }).addTo(mapa).bindPopup('Destino: ' + direccion);
        
        document.getElementById('destinoDir').value = direccion;
    }
    
    modoSeleccion = null;
    document.body.style.cursor = 'default';
    abrirModalCarrera();
    
    if (origenCoords && destinoCoords) {
        await calcularRuta();
    }
}

async function obtenerDireccion(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
        const res = await fetch(url);
        const data = await res.json();
        return data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    } catch {
        return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
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
            const tiempoMin = Math.round(route.duration / 60 * 1.3);
            
            const tipo = document.getElementById('tipoCarrera').value;
            const precioBase = distanciaKm * 15;
            const precio = Math.max(tipo === 'colectivo' ? precioBase * 0.7 : precioBase, 30);
            
            document.getElementById('resDistancia').textContent = distanciaKm.toFixed(2) + ' km';
            document.getElementById('resTiempo').textContent = tiempoMin + ' min';
            document.getElementById('resPrecio').textContent = 'L ' + precio.toFixed(2);
            document.getElementById('descuentoInfo').style.display = tipo === 'colectivo' ? 'block' : 'none';
            document.getElementById('resumenCarrera').style.display = 'block';
            
            if (rutaLayer) mapa.removeLayer(rutaLayer);
            rutaLayer = L.geoJSON(route.geometry, {
                style: { color: '#2563eb', weight: 4 }
            }).addTo(mapa);
            
            mapa.fitBounds(rutaLayer.getBounds(), { padding: [50, 50] });
        }
    } catch (error) {
        console.error('Error calculando ruta:', error);
    }
}

function seleccionarTipo(tipo) {
    document.getElementById('tipoCarrera').value = tipo;
    document.querySelectorAll('.tipo-card').forEach(card => card.classList.remove('active'));
    event.target.closest('.tipo-card').classList.add('active');
    
    if (origenCoords && destinoCoords) {
        calcularRuta();
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
    const precio = parseFloat(document.getElementById('resPrecio').textContent.replace('L ', ''));
    
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
                estado: 'solicitada'
            })
            .select()
            .single();
        
        if (error) throw error;
        
        cerrarModal();
        limpiarSeleccion();
        mostrarNotificacion('¡Carrera solicitada! Buscando conductor...');
        await cargarCarreraActiva();
        
    } catch (error) {
        console.error('Error:', error);
        mostrarError('Error: ' + error.message);
    } finally {
        ocultarLoader();
    }
}

function limpiarSeleccion() {
    if (origenMarker) mapa.removeLayer(origenMarker);
    if (destinoMarker) mapa.removeLayer(destinoMarker);
    if (rutaLayer) mapa.removeLayer(rutaLayer);
    origenCoords = null;
    destinoCoords = null;
    document.getElementById('origenDir').value = '';
    document.getElementById('destinoDir').value = '';
    document.getElementById('resumenCarrera').style.display = 'none';
}

// ============================================
// CARRERA ACTIVA
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
        
        if (error && error.code !== 'PGRST116') throw error;
        
        if (data) {
            carreraActiva = data;
            await mostrarCarreraActiva(data);
            iniciarTracking(data);
        } else {
            carreraActiva = null;
            document.getElementById('carreraActiva').innerHTML = '<p style="text-align:center;color:#6b7280">No tienes carreras activas</p>';
            detenerTracking();
        }
    } catch (error) {
        console.error('Error cargando carrera:', error);
    }
}

async function mostrarCarreraActiva(carrera) {
    // Cargar info del conductor si existe
    let conductorInfo = null;
    if (carrera.conductor_id) {
        const { data } = await window.supabaseClient
            .from('conductores')
            .select('nombre, telefono, placa, modelo_moto, color')
            .eq('id', carrera.conductor_id)
            .single();
        
        conductorInfo = data;
    }
    
    const estadoBadge = {
        'solicitada': 'warning',
        'buscando': 'warning',
        'asignada': 'info',
        'aceptada': 'success',
        'en_camino': 'info',
        'en_curso': 'success'
    };
    
    let html = `
        <div class="card">
            <h3>Carrera <span class="badge badge-${estadoBadge[carrera.estado]}">${carrera.estado}</span></h3>
            <p><strong>Tipo:</strong> ${carrera.tipo === 'directo' ? 'Directa' : 'Colectiva'}</p>
            <p><strong>Origen:</strong> ${carrera.origen_direccion}</p>
            <p><strong>Destino:</strong> ${carrera.destino_direccion}</p>
            <p><strong>Tarifa:</strong> L ${parseFloat(carrera.precio).toFixed(2)}</p>
    `;
    
    if (conductorInfo) {
        html += `
            <hr style="margin: 1rem 0">
            <h4>Conductor</h4>
            <p><strong>Nombre:</strong> ${conductorInfo.nombre}</p>
            <p><strong>Teléfono:</strong> ${conductorInfo.telefono}</p>
            <p><strong>Vehículo:</strong> ${conductorInfo.modelo_moto} ${conductorInfo.color}</p>
            <p><strong>Placa:</strong> ${conductorInfo.placa}</p>
        `;
    }
    
    html += `
            <button class="btn btn-danger" style="width:100%;margin-top:1rem" onclick="cancelarCarrera('${carrera.id}')">
                Cancelar Carrera
            </button>
        </div>
    `;
    
    document.getElementById('carreraActiva').innerHTML = html;
}

function iniciarTracking(carrera) {
    if (trackingInterval) clearInterval(trackingInterval);
    
    if (!carrera.conductor_id) return;
    
    trackingInterval = setInterval(async () => {
        try {
            const { data } = await window.supabaseClient
                .from('conductores')
                .select('latitud, longitud')
                .eq('id', carrera.conductor_id)
                .single();
            
            if (data && data.latitud && data.longitud) {
                actualizarConductorEnMapa(data.latitud, data.longitud);
            }
        } catch (error) {
            console.warn('Error tracking:', error);
        }
    }, 5000);
}

function detenerTracking() {
    if (trackingInterval) {
        clearInterval(trackingInterval);
        trackingInterval = null;
    }
    
    if (conductorMarker) {
        mapa.removeLayer(conductorMarker);
        conductorMarker = null;
    }
}

function actualizarConductorEnMapa(lat, lng) {
    if (conductorMarker) {
        conductorMarker.setLatLng([lat, lng]);
    } else {
        conductorMarker = L.marker([lat, lng], {
            icon: L.divIcon({ html: '🏍️', className: 'emoji-marker', iconSize: [35, 35] })
        }).addTo(mapa).bindPopup('Conductor');
    }
}

async function cancelarCarrera(id) {
    if (!confirm('¿Cancelar esta carrera?')) return;
    
    try {
        mostrarLoader();
        
        const { error } = await window.supabaseClient
            .from('carreras')
            .update({ estado: 'cancelada_cliente' })
            .eq('id', id);
        
        if (error) throw error;
        
        mostrarNotificacion('Carrera cancelada');
        detenerTracking();
        await cargarCarreraActiva();
        
    } catch (error) {
        mostrarError('Error: ' + error.message);
    } finally {
        ocultarLoader();
    }
}

// ============================================
// HISTORIAL
// ============================================

async function cargarHistorial() {
    try {
        const { data } = await window.supabaseClient
            .from('carreras')
            .select('*')
            .eq('cliente_id', clienteId)
            .in('estado', ['completada', 'cancelada_cliente'])
            .order('fecha_solicitud', { ascending: false })
            .limit(10);
        
        if (!data || data.length === 0) {
            document.getElementById('historialCarreras').innerHTML = '<p style="text-align:center;color:#6b7280">Sin historial</p>';
            return;
        }
        
        const html = data.map(c => `
            <div class="card mb-1">
                <div style="display:flex; justify-content:space-between">
                    <strong>${c.tipo === 'directo' ? 'Directa' : 'Colectiva'}</strong>
                    <span class="badge badge-${c.estado === 'completada' ? 'success' : 'warning'}">${c.estado}</span>
                </div>
                <p style="font-size:0.875rem;margin-top:0.5rem">${new Date(c.fecha_solicitud).toLocaleDateString('es-HN')}</p>
                <p style="font-size:0.875rem">${c.origen_direccion} → ${c.destino_direccion}</p>
                <p style="font-weight:bold">L ${parseFloat(c.precio).toFixed(2)}</p>
            </div>
        `).join('');
        
        document.getElementById('historialCarreras').innerHTML = html;
        
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============================================
// SUSCRIPCIONES EN TIEMPO REAL
// ============================================

function suscribirseACambios() {
    window.supabaseClient
        .channel('cliente-carreras')
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'carreras',
            filter: `cliente_id=eq.${clienteId}`
        }, async (payload) => {
            const carrera = payload.new;
            
            if (carrera.estado === 'aceptada') {
                mostrarNotificacion('¡Conductor aceptó tu carrera!');
                reproducirSonido();
            } else if (carrera.estado === 'en_camino') {
                mostrarNotificacion('El conductor va en camino');
                reproducirSonido();
            } else if (carrera.estado === 'completada') {
                mostrarNotificacion('¡Carrera completada!');
                reproducirSonido();
                detenerTracking();
            }
            
            await cargarCarreraActiva();
        })
        .subscribe();
}

// ============================================
// UTILIDADES
// ============================================

function mostrarLoader() {
    const loader = document.getElementById('loader');
    if (loader) loader.classList.remove('hidden');
}

function ocultarLoader() {
    const loader = document.getElementById('loader');
    if (loader) loader.classList.add('hidden');
}

function mostrarNotificacion(mensaje) {
    console.log('📢', mensaje);
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.textContent = mensaje;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

function mostrarError(mensaje) {
    alert(mensaje);
    console.error(mensaje);
}

function reproducirSonido() {
    try {
        document.getElementById('notificationSound').play();
    } catch (e) {}
}

async function cerrarSesion() {
    if (confirm('¿Cerrar sesión?')) {
        detenerTracking();
        await window.supabaseClient.auth.signOut();
        window.location.href = 'login.html';
    }
}

// ============================================
// INICIALIZACIÓN
// ============================================

window.addEventListener('load', init);

window.addEventListener('supabaseReady', () => {
    console.log('✅ Evento supabaseReady recibido');
});

window.addEventListener('supabaseError', (event) => {
    console.error('❌ Error de Supabase:', event.detail);
    mostrarError('Error de conexión con la base de datos');
});

console.log('📱 App Cliente cargado');
