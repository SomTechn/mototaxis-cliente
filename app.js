// ============================================
// APP CLIENTE - MOTOTAXIS V2 (CORREGIDO)
// ============================================

console.log('=== INICIANDO APP CLIENTE ===');

let mapa, usuario, clienteId;
let carreraActiva = null;
let origenMarker = null, destinoMarker = null, rutaLayer = null, conductorMarker = null;
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
        inicializarEventos();
        
        // Cargar precios desde DB si existe la config
        if (typeof PRICING_CONFIG !== 'undefined') {
            await PRICING_CONFIG.cargarDesdeDB();
        }

        await cargarCarreraActiva();
        await cargarHistorial(); // <--- Esta función ahora sí existe abajo
        suscribirseACambios();
        
        console.log('=== ✅ APP CLIENTE INICIADA ===');
        ocultarLoader();
        
    } catch (error) {
        console.error('=== ❌ ERROR EN INIT ===', error);
        mostrarError('Error al iniciar: ' + error.message); // <--- Esta también existe
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
                reject(new Error('No se pudo cargar Supabase (Timeout)'));
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
        
        // Verificar perfil
        const { data: perfil, error: perfilError } = await window.supabaseClient
            .from('perfiles')
            .select('nombre, rol')
            .eq('id', usuario.id)
            .single();
            
        if (perfilError || !perfil || perfil.rol !== 'cliente') {
            alert('No tienes permisos de cliente o el usuario no existe.');
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
        // Intentar crearlo si no existe (Auto-fix)
        console.log('⚠️ Registro cliente no encontrado, creando...');
        const { data: newCliente, error: createError } = await window.supabaseClient
            .from('clientes')
            .insert({ perfil_id: usuario.id })
            .select()
            .single();
            
        if (createError) throw new Error('No se pudo crear registro de cliente');
        clienteId = newCliente.id;
    } else {
        clienteId = cliente.id;
    }
}

// ============================================
// 2. MAPA Y RUTAS
// ============================================

function inicializarMapa() {
    const centro = (typeof MAP_CONFIG !== 'undefined') ? MAP_CONFIG.defaultCenter : [15.5048, -88.0250];
    mapa = L.map('map').setView(centro, 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© OpenStreetMap'
    }).addTo(mapa);
    
    mapa.on('click', (e) => {
        if (modoSeleccion) seleccionarUbicacion(e.latlng);
    });
}

function seleccionarOrigen() {
    modoSeleccion = 'origen';
    document.body.style.cursor = 'crosshair';
    cerrarModal();
    mostrarNotificacion('📍 Toca en el mapa para marcar el ORIGEN');
}

function seleccionarDestino() {
    modoSeleccion = 'destino';
    document.body.style.cursor = 'crosshair';
    cerrarModal();
    mostrarNotificacion('🏁 Toca en el mapa para marcar el DESTINO');
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
            const tiempoMin = Math.ceil(route.duration / 60 * 1.3); // +30% tráfico
            
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
        console.error('Error calculando ruta:', error);
    }
}

// ============================================
// 3. GESTIÓN DE CARRERAS (CRUD)
// ============================================

async function solicitarCarrera() {
    if (!origenCoords || !destinoCoords) {
        mostrarNotificacion('⚠️ Debes seleccionar origen y destino');
        return;
    }
    
    const tipo = document.getElementById('tipoCarrera').value;
    const distancia = parseFloat(document.getElementById('resDistancia').textContent);
    const tiempo = parseInt(document.getElementById('resTiempo').textContent);
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
                estado: 'buscando'
            })
            .select()
            .single();
        
        if (error) throw error;
        
        cerrarModal();
        limpiarSeleccion();
        mostrarNotificacion('✅ Solicitud enviada. Buscando conductor...');
        await cargarCarreraActiva();
        
    } catch (error) {
        console.error('Error solicitud:', error);
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
        const searchingUI = document.getElementById('searchingAnimation');
        
        // Manejar caso "no encontrado" sin lanzar error
        if (error && error.code === 'PGRST116') {
            carreraActiva = null;
            container.innerHTML = '<p style="text-align:center;color:#6b7280;margin-top:2rem">No tienes viajes en curso</p>';
            container.classList.remove('hidden');
            searchingUI.classList.add('hidden');
            detenerTracking();
            return;
        }

        if (error) throw error;
        
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
        }
    } catch (error) {
        console.error('Error cargando activa:', error);
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
        'aceptada': 'Conductor va hacia ti',
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
                📞 Llamar
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

// ESTA FUNCION FALTABA
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
        
    } catch (error) {
        console.error('Error historial:', error);
    }
}

async function cancelarCarrera(id) {
    if(!confirm('¿Seguro deseas cancelar?')) return;
    mostrarLoader();
    try {
        await window.supabaseClient.from('carreras')
            .update({ estado: 'cancelada_cliente' }).eq('id', id);
        mostrarNotificacion('Viaje cancelado');
        await cargarCarreraActiva();
    } catch (e) {
        mostrarError(e.message);
    } finally {
        ocultarLoader();
    }
}

// ============================================
// 4. TRACKING & REALTIME
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
// 5. UTILIDADES (Helpers)
// ============================================

function mostrarLoader() { document.getElementById('loader').classList.remove('hidden'); }
function ocultarLoader() { document.getElementById('loader').classList.add('hidden'); }

// ESTA FUNCION AHORA ESTA DEFINIDA Y GLOBAL
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
