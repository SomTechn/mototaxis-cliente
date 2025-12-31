// CLIENTE JS FINAL
let mapa, usuario, clienteId, carreraActiva = null;
let origenMarker, destinoMarker, rutaLayer, driverMarker;
let coords = { origen: null, destino: null };
let mode = null;

async function init() {
    try {
        await esperarSupabase();
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) return window.location.href = 'login.html';
        usuario = session.user;

        await cargarPerfil();
        initMap();
        
        if (typeof PRICING_CONFIG !== 'undefined') await PRICING_CONFIG.cargarDesdeDB();
        
        // Cargar estado inicial y suscribirse
        await checkActiveTrip(); 
        suscribirse();
        
        document.getElementById('loader').style.display = 'none';
    } catch (e) { console.error(e); }
}

// Soporte
async function esperarSupabase() { return new Promise(r => { const i = setInterval(() => { if (window.supabaseClient) { clearInterval(i); r(); } }, 100); }); }
async function cargarPerfil() {
    let { data } = await window.supabaseClient.from('clientes').select('id, nombre').eq('perfil_id', usuario.id).maybeSingle();
    if (!data) { const res = await window.supabaseClient.from('clientes').insert({ perfil_id: usuario.id, nombre: usuario.email.split('@')[0] }).select().single(); data = res.data; }
    clienteId = data.id;
    document.getElementById('profName').textContent = data.nombre || 'Usuario';
}

// Mapa
function initMap() {
    mapa = L.map('map', { zoomControl: false }).setView([15.5, -88], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(mapa);
    
    mapa.on('click', e => {
        if (!mode) return;
        const latlng = e.latlng;
        if (mode === 'origen') {
            coords.origen = latlng;
            if(origenMarker) mapa.removeLayer(origenMarker);
            origenMarker = L.marker(latlng).addTo(mapa);
            getAddr(latlng, 'origin');
        } else {
            coords.destino = latlng;
            if(destinoMarker) mapa.removeLayer(destinoMarker);
            destinoMarker = L.marker(latlng, {icon:L.divIcon({html:'🏁',className:'emoji'})}).addTo(mapa);
            getAddr(latlng, 'dest');
        }
        mode = null;
        if(coords.origen && coords.destino) calcular();
    });

    if(navigator.geolocation) navigator.geolocation.getCurrentPosition(pos => {
        const c = {lat: pos.coords.latitude, lng: pos.coords.longitude};
        mapa.setView(c, 15);
        if(!coords.origen) {
            coords.origen = c;
            getAddr(c, 'origin');
        }
    });
}

function setPunto(m) { mode = m; alert('Toca el mapa para seleccionar ' + m); }

async function getAddr(c, id) {
    try {
        document.getElementById(id).value = `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`; // Fallback
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${c.lat}&lon=${c.lng}`);
        const d = await res.json();
        if(d.display_name) document.getElementById(id).value = d.display_name.split(',')[0];
    } catch(e){}
}

async function calcular() {
    try {
        const btn = document.getElementById('btnRequest');
        btn.textContent = 'Calculando...';
        const url = `https://router.project-osrm.org/route/v1/driving/${coords.origen.lng},${coords.origen.lat};${coords.destino.lng},${coords.destino.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        const r = data.routes[0];
        
        if(rutaLayer) mapa.removeLayer(rutaLayer);
        rutaLayer = L.geoJSON(r.geometry).addTo(mapa);
        mapa.fitBounds(rutaLayer.getBounds(), {padding:[50,200]});

        const dist = r.distance/1000;
        const price = Math.max(30, dist*15); // Simple config
        
        document.getElementById('prices').classList.remove('hidden');
        document.getElementById('priceLabel').textContent = 'L ' + price.toFixed(0);
        
        btn.textContent = 'Pedir Mototaxi';
        btn.disabled = false;
        btn.onclick = () => crearViaje(dist, Math.ceil(r.duration/60), price);
        
    } catch(e) { console.error(e); }
}

async function crearViaje(dist, time, price) {
    const { error } = await window.supabaseClient.from('carreras').insert({
        cliente_id: clienteId, tipo: 'directo', precio: price, distancia_km: dist, tiempo_estimado_min: time,
        origen_lat: coords.origen.lat, origen_lng: coords.origen.lng, origen_direccion: document.getElementById('origin').value,
        destino_lat: coords.destino.lat, destino_lng: coords.destino.lng, destino_direccion: document.getElementById('dest').value,
        estado: 'buscando'
    });
    if(!error) checkActiveTrip();
}

// LOGICA ESTADOS UI
async function checkActiveTrip() {
    const { data } = await window.supabaseClient.from('carreras').select('*, conductores(perfiles(nombre, telefono), placa, modelo_moto)')
        .eq('cliente_id', clienteId).in('estado', ['buscando','aceptada','en_camino','en_curso']).maybeSingle();
    
    carreraActiva = data;
    renderState();
}

function renderState() {
    const form = document.getElementById('requestForm');
    const info = document.getElementById('tripInfo');
    
    if (!carreraActiva) {
        form.style.display = 'block';
        info.classList.remove('visible');
        return;
    }

    // SI HAY VIAJE
    form.style.display = 'none';
    info.classList.add('visible');
    
    const title = document.getElementById('statusTitle');
    const sub = document.getElementById('statusSub');
    const det = document.getElementById('driverDetails');

    if (carreraActiva.estado === 'buscando') {
        title.textContent = '🔍 Buscando...';
        sub.textContent = 'Estamos buscando conductores cercanos';
        det.classList.add('hidden');
    } else {
        const c = carreraActiva.conductores;
        title.textContent = carreraActiva.estado === 'en_curso' ? '🚀 En Viaje' : '🚕 Conductor en camino';
        sub.textContent = 'Tu conductor llegará pronto';
        det.classList.remove('hidden');
        document.getElementById('drvName').textContent = c?.perfiles?.nombre || 'Conductor';
        document.getElementById('drvPlate').textContent = `${c?.modelo_moto} • ${c?.placa}`;
        document.getElementById('drvPrice').textContent = 'L ' + carreraActiva.precio;
        window.phone = c?.perfiles?.telefono;
        trackDriver(carreraActiva.conductor_id);
    }
}

function suscribirse() {
    window.supabaseClient.channel('cli').on('postgres_changes', { event: '*', schema: 'public', table: 'carreras', filter: `cliente_id=eq.${clienteId}` }, payload => {
        if(payload.new.estado === 'completada') {
            document.getElementById('rateModal').style.display = 'flex';
            window.lastTrip = payload.new.id;
            carreraActiva = null;
            renderState();
        } else {
            checkActiveTrip();
        }
    }).subscribe();
}

function trackDriver(id) {
    // Polling simple para mover el icono del conductor
    setInterval(async () => {
        const { data } = await window.supabaseClient.from('conductores').select('latitud,longitud').eq('id', id).single();
        if(data) {
            if(driverMarker) driverMarker.setLatLng([data.latitud, data.longitud]);
            else driverMarker = L.marker([data.latitud, data.longitud], {icon:L.divIcon({html:'🏍️',className:'emoji'})}).addTo(mapa);
        }
    }, 5000);
}

// Acciones
async function cancelar() {
    if(confirm('Cancelar?')) await window.supabaseClient.from('carreras').update({estado:'cancelada_cliente'}).eq('id', carreraActiva.id);
}
function llamar() { window.open(`tel:${window.phone}`); }
async function sendRate() {
    await window.supabaseClient.from('carreras').update({calificacion_conductor: window.rateVal||5}).eq('id', window.lastTrip);
    document.getElementById('rateModal').style.display = 'none';
}
async function loadHist() {
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('cliente_id', clienteId).eq('estado','completada').limit(10);
    document.getElementById('histList').innerHTML = data.map(c => `<div style="padding:10px;border-bottom:1px solid #eee"><b>${new Date(c.fecha_solicitud).toLocaleDateString()}</b> - L${c.precio}<br><small>${c.destino_direccion}</small></div>`).join('');
}
async function logout() { await window.supabaseClient.auth.signOut(); window.location.href='login.html'; }

window.addEventListener('load', init);
