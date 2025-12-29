// ============================================
// VARIABLES GLOBALES
// ============================================

let mapa, usuario, clienteId, carreraActiva;
let origenMarker, destinoMarker, rutaLayer, conductorMarker;
let modoSeleccion = null;
let origenCoords = null, destinoCoords = null;
let intervaloActualizacion = null;

// ============================================
// INICIALIZACIÓN
// ============================================

async function init() {
    console.log('=== INICIANDO APP ===');
    
    // Esperar Supabase
    let intentos = 0;
    while (!window.supabase?.auth && intentos < 50) {
        await new Promise(r => setTimeout(r), 100);
        intentos++;
    }
    
    if (!window.supabase?.auth) {
        alert('Error conectando a Supabase');
        document.getElementById('loader').classList.add('hidden');
        return;
    }
    
    try {
        // Verificar sesión
        const { data: { session } } = await window.supabase.auth.getSession();
        if (!session) {
            window.location.href = 'login.html';
            return;
        }
        
        usuario = session.user;
        console.log('✅ Sesión activa:', usuario.email);
        
        // Cargar perfil
        const { data: perfil } = await window.supabase
            .from('perfiles')
            .select('nombre, rol')
            .eq('id', usuario.id)
            .single();
        
        if (!perfil || perfil.rol !== 'cliente') {
            alert('No tienes permisos de cliente');
            await window.supabase.auth.signOut();
            window.location.href = 'login.html';
            return;
        }
        
        document.getElementById('welcomeMsg').textContent = 'Hola, ' + perfil.nombre;
        
        // Obtener cliente ID
        const { data: cliente } = await window.supabase
            .from('clientes')
            .select('id')
            .eq('perfil_id', usuario.id)
            .single();
        
        clienteId = cliente.id;
        
        // Inicializar
        inicializarMapa();
        inicializarTabs();
        cargarCarreraActiva();
        cargarHistorial();
        suscribirseACambios();
        solicitarPermisoNotificaciones();
        
        console.log('=== APP INICIADA ===');
        document.getElementById('loader').classList.add('hidden');
        
    } catch (error) {
        console.error('Error en init:', error);
        alert('Error: ' + error.message);
        document.getElementById('loader').classList.add('hidden');
    }
}

// ============================================
// MAPA
// ============================================

async function inicializarMapa() {
    mapa = L.map('map').setView([14.0723, -87.1921], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapa);
    
    mapa.on('click', (e) => {
        if (modoSeleccion) {
            capturarUbicacion(e.latlng);
        }
    });
    
    console.log('✅ Mapa inicializado');
}

function seleccionarOrigen() {
    modoSeleccion = 'origen';
    document.body.style.cursor = 'crosshair';
    cerrarModal();
    mostrarNotificacion('Click en el mapa para seleccionar tu ubicación', 'info');
}

function seleccionarDestino() {
    modoSeleccion = 'destino';
    document.body.style.cursor = 'crosshair';
    cerrarModal();
    mostrarNotificacion('Click en el mapa para seleccionar el destino', 'info');
}

async function capturarUbicacion(latlng) {
    const direccion = await obtenerDireccion(latlng.lat, latlng.lng);
    
    if (modoSeleccion === 'origen') {
        origenCoords = { lat: latlng.lat, lng: latlng.lng, dir: direccion };
        if (origenMarker) mapa.removeLayer(origenMarker);
        origenMarker = L.marker(latlng, {
            icon: L.divIcon({ html: '📍', className: 'emoji-marker' })
        }).addTo(mapa).bindPopup('Origen: ' + direccion);
        
        document.getElementById('origenDir').value = direccion;
    } else {
        destinoCoords = { lat: latlng.lat, lng: latlng.lng, dir: direccion };
        if (destinoMarker) mapa.removeLayer(destinoMarker);
        destinoMarker = L.marker(latlng, {
            icon: L.divIcon({ html: '🏁', className: 'emoji-marker' })
        }).addTo(mapa).bindPopup('Destino: ' + direccion);
        
        document.getElementById('destinoDir').value = direccion;
    }
    
    modoSeleccion = null;
    document.body.style.cursor = 'default';
    abrirModalCarrera();
    
    // Calcular ruta si ambos están
    if (origenCoords && destinoCoords) {
        await calcularRuta();
    }
}

async function obtenerDireccion(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
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
            const tiempoMin = Math.round(route.duration / 60 * 1.3); // Con tráfico
            
            const tipo = document.getElementById('tipoCarrera').value;
            const precioBase = distanciaKm * 15;
            const precio = Math.max(tipo === 'colectivo' ? precioBase * 0.7 : precioBase, 30);
            
            // Mostrar resumen
            document.getElementById('resDistancia').textContent = distanciaKm.toFixed(2) + ' km';
            document.getElementById('resTiempo').textContent = tiempoMin + ' min';
            document.getElementById('resPrecio').textContent = 'L ' + precio.toFixed(2);
            document.getElementById('descuentoInfo').style.display = tipo === 'colectivo' ? 'block' : 'none';
            document.getElementById('resumenCarrera').style.display = 'block';
            
            // Dibujar ruta
            if (rutaLayer) mapa.removeLayer(rutaLayer);
            rutaLayer = L.geoJSON(route.geometry, {
                style: { color: '#2563eb', weight: 4 }
            }).addTo(mapa);
            
            // Ajustar vista
            mapa.fitBounds(rutaLayer.getBounds(), { padding: [50, 50] });
        }
    } catch (error) {
        console.error('Error calculando ruta:', error);
    }
}

// ============================================
// MODAL Y SELECCIÓN
// ============================================

function abrirModalCarrera() {
    document.getElementById('modalCarrera').classList.add('active');
}

function cerrarModal() {
    document.getElementById('modalCarrera').classList.remove('active');
}

function seleccionarTipo(tipo) {
    document.getElementById('tipoCarrera').value = tipo;
    document.querySelectorAll('.tipo-card').forEach(card => card.classList.remove('active'));
    event.target.closest('.tipo-card').classList.add('active');
    
    if (origenCoords && destinoCoords) {
        calcularRuta();
    }
}

// ============================================
// SOLICITAR CARRERA
// ============================================

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
        document.getElementById('loader').classList.remove('hidden');
        
        const { data, error } = await window.supabase
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
        mostrarNotificacion('¡Carrera solicitada! Buscando conductor...', 'success');
        reproducirSonido();
        cargarCarreraActiva();
        
    } catch (error) {
        console.error('Error:', error);
        alert('Error: ' + error.message);
    } finally {
        document.getElementById('loader').classList.add('hidden');
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
        const { data, error } = await window.supabase
            .from('carreras')
            .select('*, conductor:conductores(*, perfil:perfiles(nombre, telefono))')
            .eq('cliente_id', clienteId)
            .in('estado', ['solicitada', 'buscando', 'asignada', 'aceptada', 'en_camino', 'en_curso'])
            .order('fecha_solicitud', { ascending: false })
            .limit(1)
            .single();
        
        if (error && error.code !== 'PGRST116') throw error;
        
        if (data) {
            carreraActiva = data;
            mostrarCarreraActiva(data);
            iniciarSeguimiento();
        } else {
            carreraActiva = null;
            document.getElementById('carreraActiva').innerHTML = '<div class="card"><p style="text-align:center;color:#6b7280">No tienes carreras activas</p></div>';
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
            <h3>${carrera.numero_carrera || 'Carrera'} <span class="badge badge-${estadoBadge[carrera.estado]}">${carrera.estado}</span></h3>
            <p><strong>Tipo:</strong> ${carrera.tipo === 'directo' ? 'Directa' : 'Colectiva'}</p>
            <p><strong>Origen:</strong> ${carrera.origen_direccion}</p>
            <p><strong>Destino:</strong> ${carrera.destino_direccion}</p>
            <p><strong>Tarifa:</strong> L ${parseFloat(carrera.precio).toFixed(2)}</p>
    `;
    
    if (carrera.conductor && carrera.conductor.perfil) {
        html += `
            <hr style="margin: 1rem 0">
            <p><strong>Conductor:</strong> ${carrera.conductor.perfil.nombre}</p>
            <p><strong>Teléfono:</strong> ${carrera.conductor.perfil.telefono}</p>
            <p><strong>Placa:</strong> ${carrera.conductor.placa}</p>
        `;
    }
    
    html += `
            <button class="btn btn-danger" style="width:100%;margin-top:1rem" onclick="cancelarCarrera('${carrera.id}')">Cancelar Carrera</button>
        </div>
    `;
    
    document.getElementById('carreraActiva').innerHTML = html;
}

function iniciarSeguimiento() {
    if (intervaloActualizacion) clearInterval(intervaloActualizacion);
    
    intervaloActualizacion = setInterval(async () => {
        if (!carreraActiva) return;
        
        // Actualizar ubicación del conductor
        const { data } = await window.supabase
            .from('ubicaciones_tiempo_real')
            .select('latitud, longitud')
            .eq('carrera_id', carreraActiva.id)
            .order('timestamp', { ascending: false })
            .limit(1)
            .single();
        
        if (data) {
            actualizarConductorEnMapa(data.latitud, data.longitud);
        }
    }, 5000);
}

function actualizarConductorEnMapa(lat, lng) {
    if (conductorMarker) {
        conductorMarker.setLatLng([lat, lng]);
    } else {
        conductorMarker = L.marker([lat, lng], {
            icon: L.divIcon({ html: '🏍️', className: 'emoji-marker' })
        }).addTo(mapa).bindPopup('Conductor');
    }
}

async function cancelarCarrera(id) {
    if (!confirm('¿Cancelar esta carrera?')) return;
    
    try {
        await window.supabase
            .from('carreras')
            .update({ estado: 'cancelada_cliente' })
            .eq('id', id);
        
        mostrarNotificacion('Carrera cancelada', 'info');
        cargarCarreraActiva();
        if (conductorMarker) mapa.removeLayer(conductorMarker);
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// ============================================
// NOTIFICACIONES EN TIEMPO REAL
// ============================================

function suscribirseACambios() {
    window.supabase
        .channel('carreras-changes')
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'carreras',
            filter: `cliente_id=eq.${clienteId}`
        }, (payload) => {
            const carrera = payload.new;
            
            if (carrera.estado === 'aceptada') {
                mostrarNotificacion('¡Conductor aceptó tu carrera!', 'success');
                reproducirSonido();
            } else if (carrera.estado === 'en_camino') {
                mostrarNotificacion('El conductor va en camino', 'info');
                reproducirSonido();
            } else if (carrera.estado === 'completada') {
                mostrarNotificacion('¡Carrera completada!', 'success');
                reproducirSonido();
                if (conductorMarker) mapa.removeLayer(conductorMarker);
            }
            
            cargarCarreraActiva();
        })
        .subscribe();
}

// ============================================
// HISTORIAL
// ============================================

async function cargarHistorial() {
    try {
        const { data } = await window.supabase
            .from('carreras')
            .select('*')
            .eq('cliente_id', clienteId)
            .in('estado', ['completada', 'cancelada_cliente'])
            .order('fecha_solicitud', { ascending: false })
            .limit(10);
        
        if (data && data.length > 0) {
            const html = data.map(c => `
                <div class="card" style="margin-bottom:0.5rem">
                    <strong>${c.numero_carrera}</strong>
                    <p style="font-size:0.875rem;color:#6b7280">${c.estado}</p>
                    <p style="font-size:0.875rem">L ${parseFloat(c.precio).toFixed(2)}</p>
                </div>
            `).join('');
            document.getElementById('historialCarreras').innerHTML = html;
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============================================
// UTILIDADES
// ============================================

function inicializarTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        });
    });
}

function mostrarNotificacion(mensaje, tipo) {
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.textContent = mensaje;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

function reproducirSonido() {
    document.getElementById('notificationSound').play().catch(() => {});
}

async function solicitarPermisoNotificaciones() {
    if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
    }
}

async function cerrarSesion() {
    if (confirm('¿Cerrar sesión?')) {
        await window.supabase.auth.signOut();
        window.location.href = 'login.html';
    }
}

window.addEventListener('load', init);
