let mapa, usuario, clienteId, carreraActiva = null;
let origenMarker, destinoMarker, rutaLayer;
let coords = { org: null, dst: null };
let modoSel = null; // 'origen' o 'destino'

async function init() {
    try {
        await esperarSupabase();
        if(!await checkSession()) return;
        await loadProfile();
        initMap();
        if (typeof PRICING_CONFIG !== 'undefined') await PRICING_CONFIG.cargarDesdeDB();
        
        await checkTrip();
        sub();
        document.getElementById('loader').classList.add('hidden');
    } catch(e){ alert(e.message); }
}

// CONFIG
async function esperarSupabase() { return new Promise(r => { const i=setInterval(()=>{ if(window.supabaseClient){clearInterval(i);r();} },100); }); }
async function checkSession() {
    const { data } = await window.supabaseClient.auth.getSession();
    if(!data.session) { window.location.href='login.html'; return false; }
    usuario = data.session.user; return true;
}
async function loadProfile() {
    let { data } = await window.supabaseClient.from('clientes').select('id').eq('perfil_id', usuario.id).maybeSingle();
    if(!data) { const res = await window.supabaseClient.from('clientes').insert({perfil_id:usuario.id}).select().single(); data=res.data; }
    clienteId = data.id;
}

// MAPA OSCURO & LOGICA
function initMap() {
    mapa = L.map('map', {zoomControl:false}).setView([15.5,-88], 13);
    // TEMA OSCURO PARA EL MAPA
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapa);
    
    mapa.on('click', e => {
        if(modoSel) {
            coords[modoSel] = e.latlng;
            updateMarkers();
            modoSel = null;
            document.getElementById('mainSheet').style.transform = 'translateY(0)'; // Subir panel
            if(coords.org && coords.dst) calcRoute();
        }
    });

    if(navigator.geolocation) navigator.geolocation.getCurrentPosition(p=>{
        const c = {lat:p.coords.latitude, lng:p.coords.longitude};
        mapa.setView(c, 15);
        if(!coords.org) { coords.org = c; updateMarkers(); }
    });
}

function updateMarkers() {
    if(coords.org) {
        if(!origenMarker) origenMarker = L.marker(coords.org).addTo(mapa);
        else origenMarker.setLatLng(coords.org);
        getAddr(coords.org, 'orgInput');
    }
    if(coords.dst) {
        if(!destinoMarker) destinoMarker = L.marker(coords.dst, {icon:L.divIcon({html:'🏁',className:'emoji'})}).addTo(mapa);
        else destinoMarker.setLatLng(coords.dst);
        getAddr(coords.dst, 'dstInput');
    }
}

async function getAddr(c, id) {
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${c.lat}&lon=${c.lng}`);
        const d = await r.json();
        document.getElementById(id).value = d.display_name ? d.display_name.split(',')[0] : 'Ubicación seleccionada';
    } catch { document.getElementById(id).value = `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`; }
}

// SELECCION
window.setPunto = function(m) {
    modoSel = (m === 'origen') ? 'org' : 'dst';
    document.getElementById('mainSheet').style.transform = 'translateY(150px)'; // Bajar panel para ver mapa
}

async function calcRoute() {
    const btn = document.getElementById('btnConfirm');
    btn.textContent = 'Calculando...'; btn.disabled = true;
    
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${coords.org.lng},${coords.org.lat};${coords.dst.lng},${coords.dst.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        const r = data.routes[0];
        
        if(rutaLayer) mapa.removeLayer(rutaLayer);
        rutaLayer = L.geoJSON(r.geometry, {style:{color:'white', weight:4}}).addTo(mapa); // Ruta Blanca
        mapa.fitBounds(rutaLayer.getBounds(), {padding:[50,100]});

        const dist = r.distance/1000;
        const pDirect = PRICING_CONFIG.calcularPrecio(dist, false);
        const pPool = PRICING_CONFIG.calcularPrecio(dist, true);
        
        document.getElementById('priceDirect').textContent = 'L '+pDirect.toFixed(0);
        document.getElementById('pricePool').textContent = 'L '+pPool.toFixed(0);
        
        // Guardar para envio
        window.tripMeta = { dist, time: Math.ceil(r.duration/60), pDirect, pPool };
        
        document.getElementById('rideList').classList.add('show');
        btn.textContent = 'Confirmar Moto'; btn.disabled = false;
        
    } catch(e) { btn.textContent = 'Error ruta'; }
}

window.selectRide = function(t, el) {
    document.getElementById('selectedType').value = t;
    document.querySelectorAll('.ride-option').forEach(x=>x.classList.remove('selected'));
    el.classList.add('selected');
}

window.pedir = async function() {
    const t = document.getElementById('selectedType').value;
    const price = t==='directo' ? window.tripMeta.pDirect : window.tripMeta.pPool;
    
    const { error } = await window.supabaseClient.from('carreras').insert({
        cliente_id: clienteId, tipo: t, precio: price, 
        distancia_km: window.tripMeta.dist, tiempo_estimado_min: window.tripMeta.time,
        origen_lat: coords.org.lat, origen_lng: coords.org.lng, origen_direccion: document.getElementById('orgInput').value,
        destino_lat: coords.dst.lat, destino_lng: coords.dst.lng, destino_direccion: document.getElementById('dstInput').value,
        estado: 'buscando'
    });
    if(!error) checkTrip();
}

// ESTADOS
async function checkTrip() {
    const { data } = await window.supabaseClient.from('carreras').select('*, conductores(placa, modelo_moto, perfiles(nombre, telefono))')
        .eq('cliente_id', clienteId).in('estado',['buscando','aceptada','en_camino','en_curso']).maybeSingle();
    carreraActiva = data;
    renderUI();
}

function renderUI() {
    const form = document.getElementById('bookingForm');
    const stat = document.getElementById('tripStatus');
    
    if(!carreraActiva) {
        form.style.display = 'block'; stat.style.display = 'none';
        if(rutaLayer) mapa.removeLayer(rutaLayer);
    } else {
        form.style.display = 'none'; stat.style.display = 'block';
        const t = document.getElementById('statusTitle');
        const m = document.getElementById('statusMsg');
        const c = document.getElementById('driverCard');
        
        if(carreraActiva.estado === 'buscando') {
            t.textContent = 'Buscando conductor...';
            m.textContent = 'Estamos contactando mototaxis cercanas';
            c.classList.add('hidden');
        } else {
            const drv = carreraActiva.conductores;
            t.textContent = carreraActiva.estado === 'en_curso' ? 'En viaje' : 'Conductor en camino';
            m.textContent = carreraActiva.estado === 'en_curso' ? 'Hacia el destino' : 'Llega en 5 min';
            c.classList.remove('hidden');
            if(drv) {
                document.getElementById('drvName').textContent = drv.perfiles.nombre;
                document.getElementById('drvMoto').textContent = `${drv.modelo_moto} • ${drv.placa}`;
                window.drvPhone = drv.perfiles.telefono;
            }
        }
    }
}

// UTILS
window.cancelar = async function() {
    if(confirm('Cancelar?')) await window.supabaseClient.from('carreras').update({estado:'cancelada_cliente'}).eq('id',carreraActiva.id);
};
window.llamar = function() { window.open(`tel:${window.drvPhone}`); };
function sub() {
    window.supabaseClient.channel('cli').on('postgres_changes', {event:'*', schema:'public', table:'carreras', filter:`cliente_id=eq.${clienteId}`}, p=>{
        if(p.new.estado==='completada') { alert('Llegaste!'); window.location.reload(); }
        else checkTrip();
    }).subscribe();
}

window.addEventListener('load', init);
