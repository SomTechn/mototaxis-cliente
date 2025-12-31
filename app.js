// ============================================
// APP CLIENTE - MOTOTAXIS (VERSIÓN FINAL V2)
// ============================================

console.log('=== INICIANDO APP CLIENTE ===');

// --- VARIABLES GLOBALES ---
let mapa, usuario, clienteId;
let carreraActiva = null;
let origenMarker = null, destinoMarker = null, rutaLayer = null, conductorMarker = null;
let ubicacionActualMarker = null; // Punto azul GPS
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
        
        // Cargar mapa y GPS
        inicializarMapa();
        inicializarEventos();
        
        // Inyectar estilos CSS para la animación pequeña
        inyectarEstilosAnimacion();

        // Cargar configuración de precios
        if (typeof PRICING_CONFIG !== 'undefined') {
            await PRICING_CONFIG.cargarDesdeDB();
        }

        // Cargar datos iniciales
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
            if (window.supabaseClient) {
                clearInterval(interval);
                resolve();
            } else if (intentos >= 50) {
                clearInterval(interval);
                reject(new Error('Tiempo de espera agotado cargando base de datos'));
            }
        }, 100);
    });
}

async function verificarSesion() {
    try {
        const { data: { session }, error } = await window.supabaseClient.auth.getSession();
        if (error) throw error;
        
        if (!session) { 
            window.location.href = 'login.html'; 
            return false; 
        }
        
        usuario = session.user;
        
        const { data: perfil, error: perfilError } = await window.supabaseClient
            .from('perfiles')
            .select('nombre, rol')
            .eq('id', usuario.id)
            .single();
            
        if (perfilError || !perfil || perfil.rol !== 'cliente') {
            alert('No tienes permisos de cliente.');
            await window.supabaseClient.auth.signOut();
            window.location.href = 'login.html';
            return false;
        }
        
        const welcomeMsg = document.getElementById('welcomeMsg');
        if (welcomeMsg) welcomeMsg.textContent = 'Hola, ' + perfil.nombre;
        return true;
    } catch (error) {
        console.error('Error sesión:', error);
        throw error;
    }
}

async function cargarDatosCliente() {
    const { data: cliente, error } = await window.supabaseClient
        .from('clientes')
        .select('id')
        .eq('perfil_id', usuario.id)
        .single();
        
    if (error || !cliente) {
        console.log('Creando registro de cliente...');
        const { data: newCliente, error: createError } = await window.supabaseClient
            .from('clientes')
            .insert({ perfil_id: usuario.id })
            .select()
            .single();
        if (createError) throw new Error('Error creando datos de cliente');
        clienteId = newCliente.id;
    } else {
        clienteId = cliente.id;
    }
}

// ============================================
// 2. MAPA Y GEOLOCALIZACIÓN
// ============================================

function inicializarMapa() {
    const centro = (typeof MAP_CONFIG !== 'undefined') ? MAP_CONFIG.defaultCenter : [15.5048, -88.0250];
    
    mapa = L.map('map', { zoomControl: false }).setView(centro, 13);
    L.control.zoom({ position: 'topright' }).addTo(mapa);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(mapa);
    
    mapa.on('click', (e) => {
        if (modoSeleccion) seleccionarUbicacion(e.latlng);
    });

    obtenerUbicacionActual();
}

function obtenerUbicacionActual() {
    if (!navigator.geolocation) {
        mostrarNotificacion('⚠️ GPS no soportado');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            mapa.flyTo([lat, lng], 16, { animate: true, duration: 1.5 });

            const puntoAzulHtml = `
                <div style="background-color:#4285F4; width:15px; height:15px; border-radius:50%; border:2px solid white; box-shadow:0 0 0 10px rgba(66,133,244,0.2);"></div>
            `;
            const iconPunto = L.divIcon({
                className: 'gps-user-location',
                html: puntoAzulHtml,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });

            if (ubicacionActualMarker) mapa.removeLayer(ubicacionActualMarker);
            ubicacionActualMarker = L.marker([lat, lng], { icon: iconPunto }).addTo(mapa);
            
            if (!origenCoords) {
                setTimeout(() => { seleccionarUbicacion({ lat, lng }, true); }, 2000);
            }
        },
        (error) => {
            console.warn('Error GPS:', error);
            mostrarNotificacion('⚠️ Activa el GPS para mejor experiencia.');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function seleccionarOrigen() {
    modoSeleccion = 'origen';
    document.body.style.cursor = 'crosshair';
    cerrarModal();
    mostrarNotificacion('📍 Toca en el mapa el ORIGEN');
}

function seleccionarDestino() {
    modoSeleccion = 'destino';
    document.body.style.cursor = 'crosshair';
    cerrarModal();
    mostrarNotificacion('🏁 Toca en el mapa el DESTINO');
}

async function seleccionarUbicacion(latlng, esAutomatico = false) {
    if (esAutomatico) modoSeleccion = 'origen';
    if (!modoSeleccion && !esAutomatico) return;

    const direccion = await obtenerDireccion(latlng.lat, latlng.lng);
    
    if (modoSeleccion === 'origen') {
        origenCoords = { lat: latlng.lat, lng: latlng.lng, dir: direccion };
        if (origenMarker) mapa.removeLayer(origenMarker);
        
        origenMarker = L.marker([latlng.lat, latlng.lng], {
            icon: L.divIcon({ html: '📍', className: 'emoji-marker' })
        }).addTo(mapa);
        
        document.getElementById('origenDir').value = direccion;
    } else {
        destinoCoords = { lat: latlng.lat, lng: latlng.lng, dir: direccion };
        if (destinoMarker) mapa.removeLayer(destinoMarker);
        
        destinoMarker = L.marker([latlng.lat, latlng.lng], {
            icon: L.divIcon({ html: '🏁', className: 'emoji-marker' })
        }).addTo(mapa);
        
        document.getElementById('destinoDir').value = direccion;
    }
    
    modoSeleccion = null;
    document.body.style.cursor = 'default';
    
    if (!esAutomatico) abrirModalCarrera();
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
            const tiempoMin = Math.ceil(route.duration / 60 * 1.3);
            
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
        }
    } catch (error) {
        console.error('Error ruta:', error);
    }
}

// ============================================
// 3. GESTIÓN DE CARRERAS (CRUD)
// ============================================

async function solicitarCarrera() {
    if (!origenCoords || !destinoCoords) {
        mostrarNotificacion('⚠️ Selecciona origen y destino');
        return;
    }
    
    const tipo = document.getElementById('tipoCarrera').value;
    const distancia = parseFloat(document.getElementById('resDistancia').textContent);
    const tiempo = parseInt(document.getElementById('resTiempo').textContent);
    const precio = parseFloat(document.getElementById('resPrecio').textContent.replace('L ', ''));
    
    try {
        mostrarLoader();
        
        const { error } = await window.supabaseClient
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
                estado: 'buscando'
            });
        
        if (error) throw error;
        
        cerrarModal();
        // NOTA: No limpiamos el mapa aquí para que el cliente vea la ruta mientras espera
        mostrarNotificacion('✅ Buscando conductor...');
        await cargarCarreraActiva();
        
    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
    } finally {
        ocultarLoader();
    }
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
            .single();
            
        const container = document.getElementById('carreraActiva');
        // NOTA: Ya no usamos el div separado "searchingAnimation", usamos la tarjeta integrada
        if (document.getElementById('searchingAnimation')) {
             document.getElementById('searchingAnimation').classList.add('hidden');
        }
        
        if (error && error.code === 'PGRST116') {
            carreraActiva = null;
            container.innerHTML = '<p style="text-align:center;color:#6b7280;margin-top:2rem">No tienes viajes en curso</p>';
            container.classList.remove('hidden');
            detenerTracking();
            return;
        }

        if (error) throw error;
        
        if (data) {
            carreraActiva = data;
            
            // Si hay carrera activa y no tenemos la ruta dibujada (ej. recarga de pagina), intentar dibujarla
            if (!rutaLayer && data.origen_lat && data.destino_lat) {
                 // Recuperar ruta visualmente (opcional pero recomendado)
                 origenCoords = { lat: data.origen_lat, lng: data.origen_lng };
                 destinoCoords = { lat: data.destino_lat, lng: data.destino_lng };
                 // Aquí podríamos volver a pintar marcadores, pero lo dejaremos simple por ahora
            }

            container.classList.remove('hidden');
            
            if (data.estado === 'buscando' || data.estado === 'solicitada') {
                mostrarTarjetaBusqueda(data); // Tarjeta compacta con animación
            } else {
                await mostrarCarreraActiva(data);
                iniciarTracking(data);
            }
        }
    } catch (error) {
        console.error('Error carrera activa:', error);
    }
}

// Nueva tarjeta compacta con animación integrada
function mostrarTarjetaBusqueda(carrera) {
    const html = `
        <div class="card" style="margin-top: 1rem; border-top: 4px solid #f59e0b;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                <div class="mini-pulse-ring"></div> <h3 style="margin: 0; font-size: 1.1rem; color: #f59e0b;">Buscando Conductor...</h3>
            </div>
            
            <p style="font-size: 0.85em; color: #666; margin-bottom: 10px;">
                Conectando con mototaxis cercanas...
            </p>
            
            <div style="margin: 10px 0; padding: 10px; background: #f9fafb; border-radius: 8px; font-size: 0.9em;">
                <div style="margin-bottom: 5px;"><strong>📍 Destino:</strong> ${carrera.destino_direccion.substring(0, 30)}...</div>
                <div><strong>💰 Precio:</strong> L ${carrera.precio}</div>
            </div>
            
            <button class="btn btn-danger" style="width:100%; font-size: 0.9em; padding: 8px;" onclick="cancelarCarrera('${carrera.id}')">
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
            .eq('id', carrera.conductor_id)
            .single();
        conductorInfo = data;
    }
    
    const titulos = {
        'asignada': 'Conductor Asignado',
        'aceptada': '¡Conductor Aceptó!',
        'en_camino': '🚖 Conductor en Camino',
        'en_curso': '🚀 Viaje en Curso'
    };
    
    const color = carrera.estado === 'en_curso' ? '#10b981' : '#3b82f6';
    
    let html = `
        <div class="card" style="border-top: 4px solid ${color};">
            <h3>${titulos[carrera.estado] || carrera.estado}</h3>
            
            <div style="margin: 10px 0; padding: 10px; background: #f0f9ff; border-radius: 8px;">
                <p><strong>Destino:</strong> ${carrera.destino_direccion}</p>
                <p><strong>Precio:</strong> <span style="font-size:1.2em; color:${color}; font-weight:bold">L ${carrera.precio}</span></p>
            </div>
    `;
    
    if (conductorInfo) {
        html += `
            <div style="display:flex; align-items:center; gap:15px; margin-top:15px; padding-top:15px; border-top:1px solid #eee">
                <div style="font-size:45px; background:#f3f4f6; padding:10px; border-radius:50%">🏍️</div>
                <div>
                    <p style="font-weight:bold; font-size:1.1em; margin:0">${conductorInfo.perfil.nombre}</p>
                    <p style="margin:5px 0 0 0; font-size:0.9em; color:#666">
                        ${conductorInfo.modelo_moto} ${conductorInfo.color} <br>
                        <span style="background:#eee; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:0.8em">PLACA: ${conductorInfo.placa}</span>
                    </p>
                </div>
            </div>
            
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:15px">
                <a href="tel:${conductorInfo.perfil.telefono}" class="btn btn-primary" style="justify-content:center;">📞 Llamar</a>
                <a href="https://wa.me/504${conductorInfo.perfil.telefono.replace(/-/g, '')}" target="_blank" class="btn btn-success" style="justify-content:center;">💬 WhatsApp</a>
            </div>
        `;
    }
    
    if (carrera.estado !== 'en_curso') {
        html += `<button class="btn btn-secondary" style="width:100%; margin-top:10px; color:#ef4444;" onclick="cancelarCarrera('${carrera.id}')">Cancelar Viaje</button>`;
    } else {
         html += `<div style="margin-top:10px; text-align:center; color:#10b981; font-weight:bold">¡Disfruta tu viaje!</div>`;
    }
    html += `</div>`;
    document.getElementById('carreraActiva').innerHTML = html;
}

// Historial
async function cargarHistorial() {
    try {
        const { data, error } = await window.supabaseClient
            .from('carreras')
            .select('*')
            .eq('cliente_id', clienteId)
            .in('estado', ['completada', 'cancelada_cliente', 'cancelada_conductor'])
            .order('fecha_solicitud', { ascending: false })
            .limit(10);
            
        if (error) throw error;
        
        const divHistorial = document.getElementById('historialCarreras');
        if (!data || data.length === 0) {
            divHistorial.innerHTML = '<p style="text-align:center; color:#999">No hay historial reciente.</p>';
            return;
        }
        
        divHistorial.innerHTML = data.map(c => {
            const fecha = new Date(c.fecha_solicitud).toLocaleDateString();
            const esCompletada = c.estado === 'completada';
            return `
            <div class="card mb-1" style="border-left: 4px solid ${esCompletada ? '#10b981' : '#ef4444'}">
                <div style="display:flex; justify-content:space-between">
                    <strong>${fecha}</strong>
                    <span style="font-size:0.8em">${esCompletada ? 'Completado' : 'Cancelado'}</span>
                </div>
                <p style="font-size:0.9em; margin:5px 0">${c.destino_direccion}</p>
                <strong style="color:#2563eb">L ${c.precio}</strong>
            </div>
            `;
        }).join('');
    } catch (e) { console.error(e); }
}

async function cancelarCarrera(id) {
    if(!confirm('¿Seguro deseas cancelar?')) return;
    mostrarLoader();
    try {
        await window.supabaseClient.from('carreras')
            .update({ estado: 'cancelada_cliente' }).eq('id', id);
        
        mostrarNotificacion('Viaje cancelado');
        
        // AQUÍ ESTÁ EL CAMBIO IMPORTANTE:
        limpiarMapaCompleto(); // Borrar ruta y marcadores
        
        await cargarCarreraActiva();
    } catch (e) {
        mostrarError(e.message);
    } finally {
        ocultarLoader();
    }
}

// Nueva función helper para limpiar todo el mapa
function limpiarMapaCompleto() {
    // 1. Borrar ruta
    if (rutaLayer) {
        mapa.removeLayer(rutaLayer);
        rutaLayer = null;
    }
    // 2. Borrar marcadores origen/destino
    if (origenMarker) {
        mapa.removeLayer(origenMarker);
        origenMarker = null;
    }
    if (destinoMarker) {
        mapa.removeLayer(destinoMarker);
        destinoMarker = null;
    }
    // 3. Resetear variables
    origenCoords = null;
    destinoCoords = null;
    document.getElementById('origenDir').value = '';
    document.getElementById('destinoDir').value = '';
    document.getElementById('resumenCarrera').style.display = 'none';
}

// ============================================
// 4. TRACKING & REALTIME
// ============================================

function iniciarTracking(carrera) {
    if (trackingInterval) clearInterval(trackingInterval);
    if (!carrera.conductor_id) return;
    
    trackingInterval = setInterval(async () => {
        try {
            const { data } = await window.supabaseClient
                .from('conductores')
                .select('latitud, longitud, rumbo')
                .eq('id', carrera.conductor_id)
                .single();
            if (data && data.latitud) actualizarConductorEnMapa(data.latitud, data.longitud, data.rumbo);
        } catch (e) { }
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
    const iconHtml = `<div style="transform: rotate(${rumbo || 0}deg); font-size: 30px;">🏍️</div>`;
    const motoIcon = L.divIcon({ html: iconHtml, className: 'emoji-marker', iconSize: [40, 40] });

    if (conductorMarker) {
        conductorMarker.setLatLng([lat, lng]);
        conductorMarker.setIcon(motoIcon);
    } else {
        conductorMarker = L.marker([lat, lng], { icon: motoIcon }).addTo(mapa);
    }
}

function suscribirseACambios() {
    window.supabaseClient
        .channel('cliente-updates')
        .on('postgres_changes', { 
            event: 'UPDATE', 
            schema: 'public', 
            table: 'carreras', 
            filter: `cliente_id=eq.${clienteId}` 
        }, 
        (payload) => {
            const nueva = payload.new;
            if (nueva.estado === 'aceptada') {
                mostrarNotificacion('¡Conductor encontrado! 🎉');
                reproducirSonido();
            } else if (nueva.estado === 'en_camino') {
                mostrarNotificacion('El conductor está cerca 📍');
            } else if (nueva.estado === 'completada') {
                alert('Viaje finalizado. Precio: L ' + nueva.precio);
                detenerTracking();
            }
            cargarCarreraActiva();
        })
        .subscribe();
}

// ============================================
// 5. UTILIDADES Y ESTILOS
// ============================================

function inyectarEstilosAnimacion() {
    const style = document.createElement('style');
    style.innerHTML = `
        .mini-pulse-ring {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #fcd34d;
            position: relative;
            display: inline-block;
        }
        .mini-pulse-ring::before {
            content: '';
            position: absolute;
            left: -5px; top: -5px;
            width: 30px; height: 30px;
            border-radius: 50%;
            border: 2px solid #f59e0b;
            animation: mini-pulse 1.5s infinite;
        }
        @keyframes mini-pulse {
            0% { transform: scale(0.5); opacity: 1; }
            100% { transform: scale(1.2); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
}

function mostrarLoader() { document.getElementById('loader').classList.remove('hidden'); }
function ocultarLoader() { document.getElementById('loader').classList.add('hidden'); }

function mostrarError(mensaje) {
    console.error(mensaje);
    mostrarNotificacion('❌ ' + mensaje);
}

function mostrarNotificacion(msg) {
    const n = document.createElement('div');
    n.className = 'notification';
    n.textContent = msg;
    n.style.cssText = `
        position: fixed; top: 20px; right: 20px; 
        background: white; padding: 15px; 
        border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999; animation: slideIn 0.3s;
    `;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 4000);
}

function reproducirSonido() { try { document.getElementById('notificationSound').play(); } catch(e){} }

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

function abrirModalCarrera() { document.getElementById('modalCarrera').classList.add('active'); }
function cerrarModal() { document.getElementById('modalCarrera').classList.remove('active'); limpiarSeleccion(); }

// Limpieza para el modal de selección (no borra si ya hay ruta aceptada)
function limpiarSeleccion() {
    if (modoSeleccion) return;
    document.getElementById('resumenCarrera').style.display = 'none';
}

function seleccionarTipo(t) {
    document.getElementById('tipoCarrera').value = t;
    document.querySelectorAll('.tipo-card').forEach(c => c.classList.remove('active'));
    event.currentTarget.classList.add('active');
    if(origenCoords && destinoCoords) calcularRuta();
}

// Inicialización global
window.addEventListener('load', init);
