-- ============================================
-- SISTEMA DE MOTOTAXIS V2 - SCHEMA COMPLETO
-- ============================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ============================================
-- TABLA DE USUARIOS (Usando Auth de Supabase)
-- ============================================

-- Esta tabla se sincroniza automáticamente con auth.users de Supabase
CREATE TABLE perfiles (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    apellido VARCHAR(100),
    telefono VARCHAR(20),
    foto_url TEXT,
    rol VARCHAR(20) NOT NULL CHECK (rol IN ('admin', 'conductor', 'cliente')),
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLA DE CONDUCTORES (info adicional)
-- ============================================

CREATE TABLE conductores (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    perfil_id UUID REFERENCES perfiles(id),
    placa VARCHAR(20) NOT NULL,
    modelo_moto VARCHAR(100),
    color VARCHAR(50),
    año INTEGER,
    
    -- Estado y ubicación
    estado VARCHAR(20) DEFAULT 'inactivo' CHECK (estado IN ('disponible', 'ocupado', 'inactivo', 'en_carrera')),
    latitud DECIMAL(10, 8),
    longitud DECIMAL(11, 8),
    rumbo DECIMAL(5, 2), -- 0-360 grados
    velocidad DECIMAL(5, 2), -- km/h
    ultima_actualizacion TIMESTAMP DEFAULT NOW(),
    
    -- Estadísticas
    total_carreras INTEGER DEFAULT 0,
    calificacion_promedio DECIMAL(3, 2) DEFAULT 5.0,
    
    -- Preferencias
    acepta_colectivo BOOLEAN DEFAULT TRUE,
    radio_operacion_km DECIMAL(5, 2) DEFAULT 10,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLA DE CLIENTES (info adicional)
-- ============================================

CREATE TABLE clientes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    perfil_id UUID REFERENCES perfiles(id),
    
    -- Direcciones guardadas
    direccion_casa TEXT,
    direccion_casa_lat DECIMAL(10, 8),
    direccion_casa_lng DECIMAL(11, 8),
    
    direccion_trabajo TEXT,
    direccion_trabajo_lat DECIMAL(10, 8),
    direccion_trabajo_lng DECIMAL(11, 8),
    
    -- Estadísticas
    total_carreras INTEGER DEFAULT 0,
    calificacion_promedio DECIMAL(3, 2) DEFAULT 5.0,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLA DE CARRERAS (antes pedidos)
-- ============================================

CREATE TABLE carreras (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    numero_carrera VARCHAR(50) UNIQUE,
    
    -- Tipo de carrera
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('directo', 'colectivo')),
    
    -- Relaciones
    cliente_id UUID REFERENCES clientes(id),
    conductor_id UUID REFERENCES conductores(id),
    
    -- Origen
    origen_direccion TEXT NOT NULL,
    origen_lat DECIMAL(10, 8) NOT NULL,
    origen_lng DECIMAL(11, 8) NOT NULL,
    
    -- Destino
    destino_direccion TEXT NOT NULL,
    destino_lat DECIMAL(10, 8) NOT NULL,
    destino_lng DECIMAL(11, 8) NOT NULL,
    
    -- Información del viaje
    distancia_km DECIMAL(10, 2),
    tiempo_estimado_min INTEGER,
    precio DECIMAL(10, 2),
    
    -- Para carreras colectivas
    asientos_disponibles INTEGER DEFAULT 1,
    pasajeros_actuales INTEGER DEFAULT 0,
    
    -- Estado de la carrera
    estado VARCHAR(30) DEFAULT 'solicitada' CHECK (estado IN (
        'solicitada',      -- Cliente solicita
        'buscando',        -- Sistema buscando conductor
        'asignada',        -- Conductor asignado
        'aceptada',        -- Conductor aceptó
        'rechazada',       -- Conductor rechazó
        'en_camino',       -- Conductor va por cliente
        'en_curso',        -- Cliente a bordo
        'completada',      -- Viaje terminado
        'cancelada_cliente', -- Cliente canceló
        'cancelada_conductor' -- Conductor canceló
    )),
    
    -- Fechas y tiempos
    fecha_solicitud TIMESTAMP DEFAULT NOW(),
    fecha_asignacion TIMESTAMP,
    fecha_aceptacion TIMESTAMP,
    fecha_inicio TIMESTAMP,
    fecha_llegada_origen TIMESTAMP,
    fecha_abordaje TIMESTAMP,
    fecha_completado TIMESTAMP,
    fecha_cancelacion TIMESTAMP,
    
    -- Calificaciones
    calificacion_conductor INTEGER CHECK (calificacion_conductor BETWEEN 1 AND 5),
    calificacion_cliente INTEGER CHECK (calificacion_cliente BETWEEN 1 AND 5),
    comentario_conductor TEXT,
    comentario_cliente TEXT,
    
    -- Notas y razones
    notas TEXT,
    razon_cancelacion TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLA DE SOLICITUDES COLECTIVAS
-- ============================================

CREATE TABLE solicitudes_colectivas (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Cliente que solicita unirse
    cliente_id UUID REFERENCES clientes(id),
    carrera_colectiva_id UUID REFERENCES carreras(id),
    
    -- Su ruta específica
    origen_direccion TEXT NOT NULL,
    origen_lat DECIMAL(10, 8) NOT NULL,
    origen_lng DECIMAL(11, 8) NOT NULL,
    
    destino_direccion TEXT NOT NULL,
    destino_lat DECIMAL(10, 8) NOT NULL,
    destino_lng DECIMAL(11, 8) NOT NULL,
    
    -- Estado de la solicitud
    estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptada', 'rechazada', 'completada')),
    
    -- Precio individual
    precio DECIMAL(10, 2),
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLA DE UBICACIONES EN TIEMPO REAL
-- ============================================

CREATE TABLE ubicaciones_tiempo_real (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    conductor_id UUID REFERENCES conductores(id),
    carrera_id UUID REFERENCES carreras(id),
    
    latitud DECIMAL(10, 8) NOT NULL,
    longitud DECIMAL(11, 8) NOT NULL,
    velocidad DECIMAL(5, 2),
    rumbo DECIMAL(5, 2),
    precision DECIMAL(10, 2), -- en metros
    
    timestamp TIMESTAMP DEFAULT NOW(),
    
    -- Índice geoespacial
    ubicacion GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
        ST_SetSRID(ST_MakePoint(longitud, latitud), 4326)
    ) STORED
);

-- ============================================
-- TABLA DE CIUDADES/ZONAS
-- ============================================

CREATE TABLE ciudades (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    latitud DECIMAL(10, 8) NOT NULL,
    longitud DECIMAL(11, 8) NOT NULL,
    radio_km DECIMAL(10, 2) DEFAULT 10,
    activo BOOLEAN DEFAULT TRUE,
    
    -- Precios por zona
    precio_base_km DECIMAL(10, 2) DEFAULT 15,
    precio_minimo DECIMAL(10, 2) DEFAULT 30,
    precio_colectivo_descuento DECIMAL(3, 2) DEFAULT 0.3, -- 30% descuento
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insertar ciudades base
INSERT INTO ciudades (nombre, latitud, longitud, radio_km) VALUES
('Tegucigalpa', 14.0723, -87.1921, 15),
('San Pedro Sula', 15.5048, -88.0250, 12),
('Choloma', 15.6100, -87.9500, 10),
('La Ceiba', 15.7833, -86.8000, 10);

-- ============================================
-- TABLA DE NOTIFICACIONES
-- ============================================

CREATE TABLE notificaciones (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    perfil_id UUID REFERENCES perfiles(id),
    
    tipo VARCHAR(50) NOT NULL, -- nueva_carrera, carrera_asignada, carrera_completada, etc.
    titulo VARCHAR(200) NOT NULL,
    mensaje TEXT NOT NULL,
    
    -- Datos adicionales (JSON)
    datos JSONB,
    
    leida BOOLEAN DEFAULT FALSE,
    fecha_lectura TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLA DE CONFIGURACIÓN DEL SISTEMA
-- ============================================

CREATE TABLE configuracion (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    clave VARCHAR(100) UNIQUE NOT NULL,
    valor TEXT,
    tipo VARCHAR(20) DEFAULT 'string' CHECK (tipo IN ('string', 'number', 'boolean', 'json')),
    descripcion TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Configuración inicial
INSERT INTO configuracion (clave, valor, tipo, descripcion) VALUES
('precio_base_km', '15', 'number', 'Precio base por kilómetro en Lempiras'),
('precio_minimo', '30', 'number', 'Precio mínimo de carrera en Lempiras'),
('descuento_colectivo', '0.3', 'number', 'Descuento para carreras colectivas (0.3 = 30%)'),
('radio_busqueda_conductores', '5', 'number', 'Radio en km para buscar conductores disponibles'),
('tiempo_espera_aceptacion', '60', 'number', 'Segundos que conductor tiene para aceptar'),
('max_pasajeros_colectivo', '3', 'number', 'Máximo de pasajeros en carrera colectiva');

-- ============================================
-- ÍNDICES PARA OPTIMIZACIÓN
-- ============================================

CREATE INDEX idx_perfiles_rol ON perfiles(rol);
CREATE INDEX idx_conductores_estado ON conductores(estado);
CREATE INDEX idx_conductores_ubicacion ON conductores(latitud, longitud);
CREATE INDEX idx_carreras_estado ON carreras(estado);
CREATE INDEX idx_carreras_tipo ON carreras(tipo);
CREATE INDEX idx_carreras_conductor ON carreras(conductor_id);
CREATE INDEX idx_carreras_cliente ON carreras(cliente_id);
CREATE INDEX idx_carreras_fecha ON carreras(fecha_solicitud);
CREATE INDEX idx_ubicaciones_conductor ON ubicaciones_tiempo_real(conductor_id);
CREATE INDEX idx_ubicaciones_timestamp ON ubicaciones_tiempo_real(timestamp);
CREATE INDEX idx_ubicaciones_geo ON ubicaciones_tiempo_real USING GIST(ubicacion);
CREATE INDEX idx_notificaciones_perfil ON notificaciones(perfil_id, leida);

-- ============================================
-- FUNCIONES Y TRIGGERS
-- ============================================

-- Función para actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers para updated_at
CREATE TRIGGER update_perfiles_updated_at BEFORE UPDATE ON perfiles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conductores_updated_at BEFORE UPDATE ON conductores 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clientes_updated_at BEFORE UPDATE ON clientes 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_carreras_updated_at BEFORE UPDATE ON carreras 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Función para generar número de carrera
CREATE OR REPLACE FUNCTION generar_numero_carrera()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.numero_carrera IS NULL THEN
        NEW.numero_carrera := 'CAR-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(NEXTVAL('carreras_seq')::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE SEQUENCE IF NOT EXISTS carreras_seq START 1;

CREATE TRIGGER trigger_generar_numero_carrera
    BEFORE INSERT ON carreras
    FOR EACH ROW
    EXECUTE FUNCTION generar_numero_carrera();

-- Función para crear perfil automáticamente
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO perfiles (id, nombre, rol)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'nombre', NEW.raw_user_meta_data->>'rol');
    RETURN NEW;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- Trigger para crear perfil cuando se registra usuario
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user();

-- ============================================
-- FUNCIONES ÚTILES
-- ============================================

-- Buscar conductores cercanos disponibles
CREATE OR REPLACE FUNCTION buscar_conductores_cercanos(
    p_lat DECIMAL,
    p_lng DECIMAL,
    p_radio_km DECIMAL DEFAULT 5
)
RETURNS TABLE (
    conductor_id UUID,
    nombre VARCHAR,
    distancia_km DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id,
        p.nombre,
        CAST(
            ST_Distance(
                ST_MakePoint(p_lng, p_lat)::geography,
                ST_MakePoint(c.longitud, c.latitud)::geography
            ) / 1000 AS DECIMAL(10, 2)
        ) as distancia_km
    FROM conductores c
    JOIN perfiles p ON c.perfil_id = p.id
    WHERE 
        c.estado = 'disponible'
        AND c.latitud IS NOT NULL
        AND c.longitud IS NOT NULL
        AND ST_DWithin(
            ST_MakePoint(p_lng, p_lat)::geography,
            ST_MakePoint(c.longitud, c.latitud)::geography,
            p_radio_km * 1000
        )
    ORDER BY distancia_km ASC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Habilitar RLS en todas las tablas
ALTER TABLE perfiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE conductores ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE carreras ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_colectivas ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;

-- Políticas para PERFILES
CREATE POLICY "Usuarios pueden ver su propio perfil"
    ON perfiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Usuarios pueden actualizar su propio perfil"
    ON perfiles FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Admins pueden ver todos los perfiles"
    ON perfiles FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM perfiles
            WHERE id = auth.uid() AND rol = 'admin'
        )
    );

-- Políticas para CONDUCTORES
CREATE POLICY "Conductores pueden ver su propia info"
    ON conductores FOR ALL
    USING (
        perfil_id = auth.uid()
    );

CREATE POLICY "Clientes y admins pueden ver conductores"
    ON conductores FOR SELECT
    USING (true); -- Todos pueden ver conductores

-- Políticas para CLIENTES
CREATE POLICY "Clientes pueden ver su propia info"
    ON clientes FOR ALL
    USING (
        perfil_id = auth.uid()
    );

-- Políticas para CARRERAS
CREATE POLICY "Usuarios pueden ver sus propias carreras"
    ON carreras FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM clientes WHERE id = carreras.cliente_id AND perfil_id = auth.uid()
        ) OR
        EXISTS (
            SELECT 1 FROM conductores WHERE id = carreras.conductor_id AND perfil_id = auth.uid()
        ) OR
        EXISTS (
            SELECT 1 FROM perfiles WHERE id = auth.uid() AND rol = 'admin'
        )
    );

CREATE POLICY "Clientes pueden crear carreras"
    ON carreras FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM clientes WHERE id = carreras.cliente_id AND perfil_id = auth.uid()
        )
    );

CREATE POLICY "Conductores pueden actualizar carreras asignadas"
    ON carreras FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM conductores WHERE id = carreras.conductor_id AND perfil_id = auth.uid()
        )
    );

-- Políticas para NOTIFICACIONES
CREATE POLICY "Usuarios pueden ver sus notificaciones"
    ON notificaciones FOR SELECT
    USING (perfil_id = auth.uid());

CREATE POLICY "Usuarios pueden actualizar sus notificaciones"
    ON notificaciones FOR UPDATE
    USING (perfil_id = auth.uid());

-- ============================================
-- VISTAS ÚTILES
-- ============================================

CREATE OR REPLACE VIEW vista_carreras_completa AS
SELECT 
    c.*,
    -- Info del cliente
    pc.nombre as nombre_cliente,
    pc.telefono as telefono_cliente,
    cl.calificacion_promedio as calificacion_cliente_promedio,
    -- Info del conductor
    pcon.nombre as nombre_conductor,
    pcon.telefono as telefono_conductor,
    con.placa as placa_conductor,
    con.calificacion_promedio as calificacion_conductor_promedio,
    con.latitud as conductor_lat,
    con.longitud as conductor_lng
FROM carreras c
LEFT JOIN clientes cl ON c.cliente_id = cl.id
LEFT JOIN perfiles pc ON cl.perfil_id = pc.id
LEFT JOIN conductores con ON c.conductor_id = con.id
LEFT JOIN perfiles pcon ON con.perfil_id = pcon.id;

CREATE OR REPLACE VIEW vista_conductores_disponibles AS
SELECT 
    c.*,
    p.nombre,
    p.telefono,
    p.foto_url
FROM conductores c
JOIN perfiles p ON c.perfil_id = p.id
WHERE c.estado = 'disponible' AND p.activo = true;
