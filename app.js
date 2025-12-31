let mapa, usuario, clienteId, carreraActiva = null;
let origenMarker, destinoMarker, rutaLayer;
let origenCoords, destinoCoords, modoSeleccion;
let currentType = 'directo';

// DEFINIR ANTES DE INIT
function inicializarEventos() {
    // Eventos de UI adicionales si se requieren
}

async function init() {
    try {
        await esperarSupabase();
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) return window.location.href = 'login.html';
        usuario = session.user;

        await cargarPerfil();
        inicializarMapa();
        
        if (typeof PRICING_CONFIG !== 'undefined') await PRICING_CONFIG.cargarDesdeDB();
        
        await checkEstado();
        suscribirse();
        
        document.getElementById('loader').classList.add('hidden');
    } catch (e) { alert(e.message); }
}

async function esperarSupabase() { return new Promise(r => { const i = setInterval(() => { if (window.supabaseClient) { clearInterval(i); r(); } }, 100); }); }

async function cargarPerfil() {
    let { data } = await window.supabaseClient.from('clientes').select('id, nombre').eq('perfil_id', usuario.id).maybeSingle();
    if (!data) { const res = await window.supabaseClient.from('clientes').insert({ perfil_id: usuario.id }).select().single(); data = res.data; }
    clienteId = data.id;
    document.getElementById('userName').textContent = data.nombre || 'Usuario';
    document.getElementById('profileName').textContent = data.nombre || 'Usuario';
}

function inicializarMapa() {
    mapa = L.map('map', { zoomControl: false }).setView([15.5, -88], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(mapa); // Mapa limpio estilo Uber
    
    mapa.on('click', e => {
        if (modoSeleccion) setPunto(e.latlng);
    });

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            mapa.setView([lat, lng], 15);
            L.marker([lat, lng], {icon: L.divIcon({className:'gps-dot', html:'<div style="width:12px;height:12px;background:#3b82f6;border:2px solid white;border-radius:50%;box-shadow:0 0 10px rgba(0,0,0,0.2)"></div>'})}).addTo(mapa);
            
            // Auto-origen
            if (!origenCoords) setPunto({lat, lng}, 'origen', true);
        });
    }
}

function setMode(m) {
    modoSeleccion = m;
    // Colapsar sheet para ver mapa
    document.getElementById('mainSheet').style.transform = 'translateY(70%)';
}

async function setPunto(latlng, tipoOverride = null, auto = false) {
    const tipo = tipoOverride || modoSeleccion;
    if (!tipo) return;

    // Guardar coords
    const val = { lat: latlng.lat, lng: latlng.lng };
    if (tipo === 'origen') {
        origenCoords = val;
        if (origenMarker) mapa.removeLayer(origenMarker);
        origenMarker = L.marker([val.lat, val.lng]).addTo(mapa);
        document.getElementById('origin').value = "Ubicación seleccionada";
        obtenerDir(val, 'origin');
    } else {
        destinoCoords = val;
        if (destinoMarker) mapa.removeLayer(destinoMarker);
        destinoMarker = L.marker([val.lat, val.lng], {icon: L.divIcon({html:'🏁', className:'emoji-icon'})}).addTo(mapa);
        document.getElementById('dest').value = "Destino seleccionado";
        obtenerDir(val, 'dest');
    }

    if (!auto) {
        modoSeleccion = null;
        document.getElementById('mainSheet').style.transform = 'translateY(0)'; // Subir panel
        
        // Si ambos están listos, calcular
        if (origenCoords && destinoCoords) {
            document.getElementById('rideSelector').classList.remove('hidden');
            calcular();
        }
    }
}

async function obtenerDir(c, id) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${c.lat}&lon=${c.lng}`);
        const d = await res.json();
        document.getElementById(id).value = d.display_name.split(',')[0];
    } catch(e){}
}

async function calcular() {
    try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${origenCoords.lng},${origenCoords.lat};${destinoCoords.lng},${destinoCoords.lat}?overview=full&geometries=geojson`);
        const data = await res.json();
        const route = data.routes[0];
        
        if (rutaLayer) mapa.removeLayer(rutaLayer);
        rutaLayer = L.geoJSON(route.geometry, {style: {color:'black', weight:4}}).addTo(mapa);
        mapa.fitBounds(rutaLayer.getBounds(), {padding:[50,200]}); // Padding abajo para el sheet

        const dist = route.distance / 1000;
        const pDirect = PRICING_CONFIG.calcularPrecio(dist, false);
        const pPool = PRICING_CONFIG.calcularPrecio(dist, true);

        document.getElementById('price-direct').textContent = 'L ' + pDirect.toFixed(0);
        document.getElementById('price-pool').textContent = 'L ' + pPool.toFixed(0);
        
        // Guardar datos temporales
        window.tempDist = dist;
        window.tempTime = Math.ceil(route.duration/60);
        window.tempPrice = pDirect; // Default
    } catch(e) { console.error(e); }
}

function selectType(t, el) {
    currentType = t;
    document.querySelectorAll('.type-card').forEach(c=>c.classList.remove('selected'));
    el.classList.add('selected');
    const dist = window.tempDist;
    window.tempPrice = PRICING_CONFIG.calcularPrecio(dist, t==='colectivo');
}

async function pedirViaje() {
    const { error } = await window.supabaseClient.from('carreras').insert({
        cliente_id: clienteId,
        tipo: currentType,
        precio: window.tempPrice,
        distancia_km: window.tempDist,
        tiempo_estimado_min: window.tempTime,
        origen_lat: origenCoords.lat, origen_lng: origenCoords.lng, origen_direccion: document.getElementById('origin').value,
        destino_lat: destinoCoords.lat, destino_lng: destinoCoords.lng, destino_direccion: document.getElementById('dest').value,
        estado: 'buscando'
    });
    
    if(!error) checkEstado();
}

async function checkEstado() {
    const { data } = await window.supabaseClient.from('carreras').select('*, conductores(perfiles(nombre, telefono), placa, modelo_moto)').eq('cliente_id', clienteId).in('estado', ['buscando','aceptada','en_camino','en_curso']).maybeSingle();
    carreraActiva = data;
    
    const idle = document.getElementById('state-idle');
    const active = document.getElementById('state-active');
    
    if (data) {
        idle.classList.add('hidden');
        active.classList.remove('hidden');
        
        const title = document.getElementById('statusTitle');
        const info = document.getElementById('driverInfo');
        
        if (data.estado === 'buscando') {
            title.textContent = '🔍 Buscando conductor...';
            info.classList.add('hidden');
        } else {
            title.textContent = data.estado === 'en_curso' ? '🚀 En viaje' : '🚕 Conductor en camino';
            info.classList.remove('hidden');
            if (data.conductores) {
                document.getElementById('drvName').textContent = data.conductores.perfiles.nombre;
                document.getElementById('drvMoto').textContent = `${data.conductores.modelo_moto} • ${data.conductores.placa}`;
                window.driverPhone = data.conductores.perfiles.telefono;
            }
        }
    } else {
        idle.classList.remove('hidden');
        active.classList.add('hidden');
    }
}

function llamarDriver() { window.open(`tel:${window.driverPhone}`); }
async function cancelarViaje() {
    if (confirm('Cancelar?')) {
        await window.supabaseClient.from('carreras').update({estado:'cancelada_cliente'}).eq('id', carreraActiva.id);
        checkEstado();
    }
}

function suscribirse() {
    window.supabaseClient.channel('cli').on('postgres_changes', {event:'*', schema:'public', table:'carreras', filter:`cliente_id=eq.${clienteId}`}, payload => {
        if (payload.new.estado === 'completada') {
            document.getElementById('rateModal').style.display = 'flex';
            window.lastTripId = payload.new.id;
            checkEstado();
        } else {
            checkEstado();
        }
    }).subscribe();
}

async function sendRate() {
    const r = window.rateVal || 5;
    await window.supabaseClient.from('carreras').update({calificacion_conductor: r}).eq('id', window.lastTripId);
    document.getElementById('rateModal').style.display = 'none';
}

async function cargarHistorial() {
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('cliente_id', clienteId).eq('estado','completada').order('fecha_solicitud',{ascending:false}).limit(10);
    document.getElementById('historyList').innerHTML = data.map(c => `
        <div style="border-bottom:1px solid #eee; padding:15px 0;">
            <div style="display:flex; justify-content:space-between"><strong>${new Date(c.fecha_solicitud).toLocaleDateString()}</strong><span>L ${c.precio}</span></div>
            <div style="font-size:12px; color:#666">${c.origen_direccion} -> ${c.destino_direccion}</div>
        </div>
    `).join('');
}

async function logout() { await window.supabaseClient.auth.signOut(); window.location.href='login.html'; }
window.addEventListener('load', init);
