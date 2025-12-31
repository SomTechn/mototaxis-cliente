// ============================================
// MEJORAS EN SOLICITUD DE CARRERA (app.js)
// ============================================

async function solicitarCarrera() {
    if (!origenCoords || !destinoCoords) {
        mostrarNotificacion('Error', 'Selecciona origen y destino', 'danger');
        return;
    }

    const tipo = document.getElementById('tipoCarrera').value;
    const distancia = parseFloat(document.getElementById('resDistancia').textContent);
    const tiempo = parseInt(document.getElementById('resTiempo').textContent);
    
    // Usar la lógica de precios centralizada en config.js
    const precio = PRICING_CONFIG.calcularPrecio(distancia, tipo === 'colectivo');

    try {
        mostrarLoader();
        
        // 1. Crear la carrera
        const { data: carrera, error } = await window.supabaseClient
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
                precio: precio,
                estado: 'buscando' // Iniciamos en búsqueda inmediata
            })
            .select()
            .single();

        if (error) throw error;

        // 2. Notificar al sistema de despacho (RPC o Trigger)
        // Aquí podrías llamar a una función de Supabase que busque conductores
        // por ahora, el Realtime se encargará de mostrarle al conductor.

        cerrarModal();
        limpiarSeleccion();
        mostrarNotificacion('¡Solicitud Enviada!', 'Buscando el conductor más cercano...');
        
        carreraActiva = carrera;
        await cargarCarreraActiva();

    } catch (error) {
        console.error('Error:', error);
        mostrarError('No se pudo procesar la solicitud: ' + error.message);
    } finally {
        ocultarLoader();
    }
}

// Mejora en el seguimiento: Rotación de icono y suavizado
function actualizarConductorEnMapa(lat, lng, rumbo) {
    const motoIcon = L.divIcon({
        html: `<div style="transform: rotate(${rumbo || 0}deg); font-size: 25px;">🏍️</div>`,
        className: 'moto-marker',
        iconSize: [30, 30]
    });

    if (conductorMarker) {
        conductorMarker.setLatLng([lat, lng]);
        if (rumbo) conductorMarker.setIcon(motoIcon);
    } else {
        conductorMarker = L.marker([lat, lng], { icon: motoIcon }).addTo(mapa);
    }
    
    // Si el conductor está cerca (menos de 200m), avisar al cliente
    const dist = UTILS.calcularDistancia(lat, lng, origenCoords.lat, origenCoords.lng);
    if (dist < 0.2 && carreraActiva.estado === 'en_camino') {
        mostrarNotificacion('¡Tu mototaxi está llegando!', 'Sal al punto de encuentro', 'success');
    }
}
