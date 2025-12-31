// APP CLIENTE (FINAL)
let mapa, usuario, clienteId, carreraActiva = null;
let origenMarker, destinoMarker, rutaLayer, conductorMarker, userMarker;
let modoSeleccion = null, origenCoords = null, destinoCoords = null;
let trackingInterval = null;

async function init() {
    try {
        await esperarSupabase();
        if (!await verificarSesion()) return;
        await cargarDatosCliente();
        inicializarMapa();
        if (typeof PRICING_CONFIG !== 'undefined') await PRICING_CONFIG.cargarDesdeDB();
        await cargarCarreraActiva();
        suscribirse();
        document.getElementById('loader').classList.add('hidden');
    } catch (e) { alert(e.message); }
}

async function esperarSupabase() { return new Promise(r => { const i = setInterval(() => { if (window.supabaseClient) { clearInterval(i); r(); } }, 100); }); }
async function verificarSesion() {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return false; }
    usuario = session.user; return true;
}
async function cargarDatosCliente() {
    let { data } = await window.supabaseClient.from('clientes').select('id, nombre').eq('perfil_id', usuario.id).maybeSingle();
    if (!data) { const res = await window.supabaseClient.from('clientes').insert({ perfil_id: usuario.id }).select().single(); data = res.data; }
    clienteId = data.id;
    document.getElementById('profileName').textContent = data.nombre || 'Cliente';
}

function inicializarMapa() {
    mapa = L.map('map', { zoomControl: false }).setView([15.5048, -88.0250], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapa);
    mapa.on('click', e => { if (modoSeleccion) setUbicacion(e.latlng); });
    if(navigator.geolocation) navigator.geolocation.getCurrentPosition(pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        mapa.setView([lat, lng], 15);
        if(!origenCoords) setUbicacion({lat, lng}, true);
    });
}

function setUbicacion(latlng, auto = false) {
    if (auto) modoSeleccion = 'origen';
    if (!modoSeleccion) return;
    const dir = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`; // Placeholder
    
    if (modoSeleccion === 'origen') {
        origenCoords = { lat: latlng.lat, lng: latlng.lng, dir };
        if(origenMarker) mapa.removeLayer(origenMarker);
        origenMarker = L.marker([latlng.lat, latlng.lng]).addTo(mapa);
        document.getElementById('origenDir').value = dir;
    } else {
        destinoCoords = { lat: latlng.lat, lng: latlng.lng, dir };
        if(destinoMarker) mapa.removeLayer(destinoMarker);
        destinoMarker = L.marker([latlng.lat, latlng.lng]).addTo(mapa);
        document.getElementById('destinoDir').value = dir;
    }
    
    // Intentar obtener nombre real
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}`)
        .then(r=>r.json()).then(d=>{
            if(d.display_name) {
                const val = d.display_name.split(',')[0];
                if(modoSeleccion === 'origen' || auto) { document.getElementById('origenDir').value = val; origenCoords.dir = val; }
                else { document.getElementById('destinoDir').value = val; destinoCoords.dir = val; }
            }
        });

    if(!auto) { modoSeleccion = null; document.getElementById('homeSheet').style.transform = 'translateY(0)'; }
    if(origenCoords && destinoCoords) calcularRuta();
}

async function calcularRuta() {
    const btn = document.getElementById('btnSolicitar');
    btn.disabled = true; btn.textContent = 'Calculando...';
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${origenCoords.lng},${origenCoords.lat};${destinoCoords.lng},${destinoCoords.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        if(data.routes?.[0]) {
            const r = data.routes[0];
            const dist = r.distance/1000;
            const price = Math.max(30, dist*15); // Simple pricing fallback
            
            document.getElementById('resDist').textContent = dist.toFixed(1)+' km';
            document.getElementById('resPrice').textContent = 'L '+price.toFixed(0);
            document.getElementById('resumenCarrera').classList.remove('hidden');
            
            if(rutaLayer) mapa.removeLayer(rutaLayer);
            rutaLayer = L.geoJSON(r.geometry).addTo(mapa);
            mapa.fitBounds(rutaLayer.getBounds(), {padding:[50,50]});
            btn.disabled = false; btn.textContent = 'Pedir Mototaxi';
        }
    } catch(e) { btn.textContent = 'Error ruta (Reintentar)'; btn.disabled = false; }
}

async function solicitarCarrera() {
    const p = parseFloat(document.getElementById('resPrice').textContent.replace('L ',''));
    const d = parseFloat(document.getElementById('resDist').textContent);
    const { error } = await window.supabaseClient.from('carreras').insert({
        cliente_id: clienteId, tipo: document.getElementById('tipoCarrera').value, precio: p, distancia_km: d,
        origen_lat: origenCoords.lat, origen_lng: origenCoords.lng, origen_direccion: origenCoords.dir,
        destino_lat: destinoCoords.lat, destino_lng: destinoCoords.lng, destino_direccion: destinoCoords.dir,
        estado: 'buscando'
    });
    if(!error) cargarCarreraActiva();
}

async function cargarCarreraActiva() {
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('cliente_id', clienteId).in('estado',['buscando','aceptada','en_camino','en_curso']).maybeSingle();
    carreraActiva = data;
    const form = document.getElementById('tripForm');
    const status = document.getElementById('tripStatus');
    if(data) {
        form.classList.add('hidden'); status.classList.remove('hidden');
        document.getElementById('statusContent').innerHTML = `<h3>${data.estado === 'buscando' ? '🔎 Buscando...' : '🚀 En curso'}</h3><button onclick="cancelar('${data.id}')">Cancelar</button>`;
    } else {
        form.classList.remove('hidden'); status.classList.add('hidden');
    }
}

async function cancelar(id) { await window.supabaseClient.from('carreras').update({ estado:'cancelada_cliente' }).eq('id', id); }
function suscribirse() { window.supabaseClient.channel('cliente').on('postgres_changes', { event: '*', schema: 'public', table: 'carreras', filter: `cliente_id=eq.${clienteId}` }, cargarCarreraActiva).subscribe(); }
function seleccionarOrigen() { modoSeleccion='origen'; document.getElementById('homeSheet').style.transform='translateY(80%)'; }
function seleccionarDestino() { modoSeleccion='destino'; document.getElementById('homeSheet').style.transform='translateY(80%)'; }
function setTipo(t) { document.getElementById('tipoCarrera').value = t; calcularRuta(); }
async function cargarHistorial() {
    const { data } = await window.supabaseClient.from('carreras').select('*').eq('cliente_id', clienteId).in('estado',['completada']).limit(10);
    document.getElementById('historialLista').innerHTML = data.map(c=>`<div>${c.fecha_solicitud} - L${c.precio}</div>`).join('');
}
async function cerrarSesion() { await window.supabaseClient.auth.signOut(); window.location.href='login.html'; }

window.addEventListener('load', init);
