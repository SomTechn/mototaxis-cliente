// ============================================
// CONFIGURACIÓN GLOBAL (shared/config.js)
// ============================================

const SUPABASE_CONFIG = {
    url: 'https://brtiamwcdlwfyyprlevw.supabase.co',
    anonKey: 'sb_publishable_g8ETwpbbpEFR64zacmx_cw_L3Yxg7Zt'
};

// Variable global para el cliente
window.supabaseClient = null;

// Inicialización Autoejecutable
(function initSupabase() {
    console.log('🔄 Iniciando configuración...');
    
    // Verificar si la librería de Supabase cargó
    if (typeof supabase === 'undefined') {
        console.error('❌ La librería de Supabase no se ha cargado.');
        return;
    }

    try {
        window.supabaseClient = window.supabase.createClient(
            SUPABASE_CONFIG.url, 
            SUPABASE_CONFIG.anonKey,
            {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            }
        );
        console.log('✅ Supabase cliente creado');
        window.dispatchEvent(new CustomEvent('supabaseReady'));
    } catch (error) {
        console.error('❌ Error creando cliente Supabase:', error);
        window.dispatchEvent(new CustomEvent('supabaseError', { detail: error }));
    }
})();

const MAP_CONFIG = {
    defaultCenter: [15.5048, -88.0250], // San Pedro Sula
    defaultZoom: 13,
    iconos: {
        origen: '📍',
        destino: '🏁',
        conductor: '🏍️'
    }
};

const PRICING_CONFIG = {
    precioBaseKm: 15,
    precioMinimo: 30,
    descuentoColectivo: 0.3, // 30%
    
    // Carga precios dinámicos de la BD
    async cargarDesdeDB() {
        if (!window.supabaseClient) return;
        try {
            const { data } = await window.supabaseClient
                .from('configuracion')
                .select('clave, valor');
            
            if (data) {
                data.forEach(item => {
                    if (item.clave === 'precio_base_km') this.precioBaseKm = parseFloat(item.valor);
                    if (item.clave === 'precio_minimo') this.precioMinimo = parseFloat(item.valor);
                });
            }
        } catch (e) { console.warn('Usando precios por defecto'); }
    },
    
    calcularPrecio(distanciaKm, esColectivo) {
        let precio = Math.max(distanciaKm * this.precioBaseKm, this.precioMinimo);
        if (esColectivo) precio = precio * (1 - this.descuentoColectivo);
        return Math.round(precio);
    }
};

const UTILS = {
    formatearMoneda(valor) {
        return 'L ' + parseFloat(valor).toFixed(2);
    },
    
    calcularDistancia(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radio tierra km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    },

    validarTelefono(telefono) {
        // Acepta 8 dígitos, con o sin guión
        const re = /^[0-9]{4}-?[0-9]{4}$/;
        return re.test(telefono);
    },

    mostrarNotificacion(titulo, mensaje, tipo = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${tipo}`;
        toast.innerHTML = `<strong>${titulo}</strong><p>${mensaje}</p>`;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
};

const AUTH = {
    usuario: null,
    async cerrarSesion() {
        if (window.supabaseClient) {
            await window.supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        }
    }
};

console.log('📦 Config.js cargado correctamente');
