// ============================================
// APP CLIENTE - MOTOTAXIS
// ============================================

console.log('=== INICIANDO APP CLIENTE ===');

let mapa, usuario, clienteId;
let carreraActiva = null;
let origenMarker = null, destinoMarker = null, rutaLayer = null;
let modoSeleccion = null;
let origenCoords = null, destinoCoords = null;

// ============================================
// INICIALIZACIÓN
// ============================================

async function init() {
    console.log('1. Iniciando app cliente...');
    
    try {
        // Esperar Supabase
        await esperarSupabase();
        
        // Verificar sesión
        const sesionValida = await verificarSesion();
        if (!sesionValida) return;
        
        // Cargar datos del cliente
        await cargarDatosCliente();
        
        // Inicializar componentes
        inicializarMapa();
        inicializarEventos();
        
        // Cargar datos
        await cargarCarreraActiva();
        
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
        const maxIntentos = 50;
        
        const interval = setInterval(() => {
            intentos++;
            console.log(`Intento ${intentos}/${maxIntentos} esperando Supabase...`);
            
            if (window.supabaseClient) {
                clearInterval(interval);
                console.log('✅ Supabase conectado');
                resolve();
            } else if (intentos >= maxIntentos) {
                clearInterval(interval);
                reject(new Error('No se pudo cargar Supabase. Recarga la página.'));
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
        
        // Verificar rol
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
        
        // Actualizar UI
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
        maxZoom: 18
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
            .select('*, conductores(*, perfiles(nombre, telefono))')
            .eq('cliente_id', clienteId)
            .in('estado', ['solicitada', 'buscando', 'asignada', 'aceptada', 'en_camino', 'en_curso'])
            .order('fecha_solicitud', { ascending: false })
            .limit(1)
            .single();
        
        if (error && error.code !== 'PGRST116') throw error;
        
        if (data) {
            carreraActiva = data;
            mostrarCarreraActiva(data);
        } else {
            carreraActiva = null;
            document.getElementById('carreraActiva').innerHTML = '<p style="text-align:center;color:#6b7280">No tienes carreras activas</p>';
        }
    } catch (error) {
        console.error('Error cargando carrera:', error);
    }
}

function mostrarCarreraActiva(carrera) {
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
    
    if (carrera.conductores && carrera.conductores.perfiles) {
        html += `
            <hr style="margin: 1rem 0">
            <p><strong>Conductor:</strong> ${carrera.conductores.perfiles.nombre}</p>
            <p><strong>Teléfono:</strong> ${carrera.conductores.perfiles.telefono}</p>
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
        await cargarCarreraActiva();
        
    } catch (error) {
        mostrarError('Error: ' + error.message);
    } finally {
        ocultarLoader();
    }
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
    // Aquí puedes agregar toast visual si quieres
}

function mostrarError(mensaje) {
    alert(mensaje);
    console.error(mensaje);
}

async function cerrarSesion() {
    if (confirm('¿Cerrar sesión?')) {
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
