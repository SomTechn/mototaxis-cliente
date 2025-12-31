let mapa, usuario, clienteId, carrera=null, coords={org:null, dst:null}, markers={org:null, dst:null}, mode=null, rutaLayer;

window.addEventListener('load', async () => {
    try {
        await new Promise(r=>setTimeout(r,500));
        if(!window.supabaseClient) throw new Error('Error DB');
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if(!session) return window.location.href='login.html';
        usuario = session.user;

        await loadProfile();
        initMap();
        if (typeof PRICING_CONFIG !== 'undefined') await PRICING_CONFIG.cargarDesdeDB();
        await checkTrip();
        sub();
        document.getElementById('loader').classList.add('hidden');
    } catch(e){ alert(e.message); }
});

async function loadProfile() {
    let { data } = await window.supabaseClient.from('clientes').select('id, nombre').eq('perfil_id', usuario.id).maybeSingle();
    if(!data) { const res=await window.supabaseClient.from('clientes').insert({perfil_id:usuario.id}).select().single(); data=res.data; }
    clienteId = data.id;
    document.getElementById('profName').textContent = data.nombre || 'Usuario';
}

function initMap() {
    mapa = L.map('map', {zoomControl:false}).setView([15.5,-88], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(mapa);
    mapa.on('click', e => {
        if(mode) {
            coords[mode] = e.latlng;
            if(markers[mode]) mapa.removeLayer(markers[mode]);
            markers[mode] = L.marker(e.latlng).addTo(mapa);
            document.getElementById(mode).value = 'Ubicación seleccionada';
            mode = null;
            if(coords.org && coords.dst) calc();
        }
    });
    if(navigator.geolocation) navigator.geolocation.getCurrentPosition(p=>{
        const c={lat:p.coords.latitude, lng:p.coords.longitude};
        mapa.setView(c, 15);
        if(!coords.org) { coords.org=c; document.getElementById('org').value='Tu Ubicación'; }
    });
}

// FUNCIONES GLOBALES
window.setPunto = function(m) { mode=m; alert('Toca el mapa'); };

window.nav = function(v, el) {
    document.getElementById('view-home').style.display = v==='home'?'block':'none';
    document.querySelectorAll('.fs-view').forEach(x => x.classList.remove('active'));
    if(v!=='home') document.getElementById('view-'+v).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
    el.classList.add('active');
    if(v==='history') loadHist();
    if(v==='profile') document.getElementById('view-profile').classList.add('active');
};

window.toggleMenu = function() { window.nav('profile', document.querySelectorAll('.nav-item')[2]); };

async function calc() {
    const btn=document.getElementById('btnReq'); btn.textContent='Calculando...';
    try {
        const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords.org.lng},${coords.org.lat};${coords.dst.lng},${coords.dst.lat}?overview=full&geometries=geojson`);
        const d = await r.json();
        const km = d.routes[0].distance/1000;
        const p = Math.max(30, km*15);
        document.getElementById('priceLabel').textContent = 'L '+p.toFixed(0);
        document.getElementById('priceBox').classList.remove('hidden');
        btn.disabled=false; btn.textContent='Confirmar';
        window.tripData = { km, p, time: Math.ceil(d.routes[0].duration/60) };
        if(rutaLayer) mapa.removeLayer(rutaLayer);
        rutaLayer = L.geoJSON(d.routes[0].geometry).addTo(mapa);
        mapa.fitBounds(rutaLayer.getBounds(), {padding:[50,50]});
    } catch(e){ btn.textContent='Error ruta'; }
}

window.pedir = async function() {
    const { error } = await window.supabaseClient.from('carreras').insert({
        cliente_id: clienteId, tipo:'directo', precio:window.tripData.p, distancia_km:window.tripData.km,
        origen_lat:coords.org.lat, origen_lng:coords.org.lng, origen_direccion:document.getElementById('org').value,
        destino_lat:coords.dst.lat, destino_lng:coords.dst.lng, destino_direccion:document.getElementById('dst').value,
        estado:'buscando'
    });
    if(!error) checkTrip();
};

async function checkTrip() {
    const { data } = await window.supabaseClient.from('carreras').select('*, conductores(perfiles(nombre,telefono), placa, modelo_moto)').eq('cliente_id',clienteId).in('estado',['buscando','aceptada','en_camino','en_curso']).maybeSingle();
    carrera=data;
    const f=document.getElementById('reqForm'), t=document.getElementById('tripInfo');
    if(data) {
        f.style.display='none'; t.style.display='block';
        const st = document.getElementById('stTitle');
        const di = document.getElementById('drvInfo');
        if(data.estado==='buscando') { st.textContent='🔍 Buscando...'; di.classList.add('hidden'); }
        else {
            st.textContent = data.estado==='en_curso' ? '🚀 En Viaje' : '🚕 Conductor viene';
            di.classList.remove('hidden');
            if(data.conductores) {
                document.getElementById('dName').textContent = data.conductores.perfiles.nombre;
                document.getElementById('dMoto').textContent = data.conductores.modelo_moto;
                window.phone = data.conductores.perfiles.telefono;
            }
        }
    } else {
        f.style.display='block'; t.style.display='none';
        if(rutaLayer) mapa.removeLayer(rutaLayer);
    }
}

window.cancelar = async function() { if(confirm('Cancelar?')) await window.supabaseClient.from('carreras').update({estado:'cancelada_cliente'}).eq('id',carrera.id); };
window.llamar = function() { window.open(`tel:${window.phone}`); };
window.logout = async function() { await window.supabaseClient.auth.signOut(); window.location.href='login.html'; };
function sub() { window.supabaseClient.channel('cli').on('postgres_changes', {event:'*', schema:'public', table:'carreras', filter:`cliente_id=eq.${clienteId}`}, p=>{ if(p.new.estado==='completada') { alert('Llegaste!'); window.location.reload(); } else checkTrip(); }).subscribe(); }
async function loadHist() { const { data } = await window.supabaseClient.from('carreras').select('*').eq('cliente_id', clienteId).eq('estado','completada').limit(10); document.getElementById('histList').innerHTML = data.map(c=>`<div style="padding:10px;border-bottom:1px solid #eee"><b>${new Date(c.fecha_solicitud).toLocaleDateString()}</b> - L${c.precio}<br><small>${c.destino_direccion}</small></div>`).join(''); }
