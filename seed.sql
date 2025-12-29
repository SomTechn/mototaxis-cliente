-- ============================================
-- DATOS DE PRUEBA - SISTEMA MOTOTAXIS V2
-- ============================================

-- NOTA: Estos usuarios se deben crear manualmente en Supabase Auth primero
-- o usar el sistema de registro de cada módulo

-- ============================================
-- USUARIOS DE PRUEBA
-- ============================================

-- Después de crear estos usuarios en Supabase Auth, ejecutar:

-- ADMIN (ID ficticio - reemplazar con el real)
INSERT INTO perfiles (id, nombre, telefono, rol) VALUES
('00000000-0000-0000-0000-000000000001', 'Admin Sistema', '9999-0000', 'admin');

-- CONDUCTORES (IDs ficticios - reemplazar con los reales)
INSERT INTO perfiles (id, nombre, apellido, telefono, rol) VALUES
('11111111-1111-1111-1111-111111111111', 'Carlos', 'Martínez', '9999-1111', 'conductor'),
('22222222-2222-2222-2222-222222222222', 'Luis', 'Hernández', '9999-2222', 'conductor'),
('33333333-3333-3333-3333-333333333333', 'José', 'García', '9999-3333', 'conductor');

INSERT INTO conductores (perfil_id, placa, modelo_moto, color, estado, latitud, longitud, acepta_colectivo) VALUES
('11111111-1111-1111-1111-111111111111', 'ABC-001', 'Honda CG 125', 'Roja', 'disponible', 14.0850, -87.2063, true),
('22222222-2222-2222-2222-222222222222', 'DEF-002', 'Yamaha FZ', 'Negra', 'disponible', 14.0680, -87.1900, true),
('33333333-3333-3333-3333-333333333333', 'GHI-003', 'Suzuki GN', 'Azul', 'inactivo', 14.0920, -87.2100, false);

-- CLIENTES (IDs ficticios - reemplazar con los reales)
INSERT INTO perfiles (id, nombre, apellido, telefono, rol) VALUES
('44444444-4444-4444-4444-444444444444', 'Ana', 'Rodríguez', '8888-1111', 'cliente'),
('55555555-5555-5555-5555-555555555555', 'María', 'González', '8888-2222', 'cliente'),
('66666666-6666-6666-6666-666666666666', 'Carmen', 'Díaz', '8888-3333', 'cliente');

INSERT INTO clientes (perfil_id, direccion_casa, direccion_casa_lat, direccion_casa_lng) VALUES
('44444444-4444-4444-4444-444444444444', 'Col. Palmira, Tegucigalpa', 14.0723, -87.1921),
('55555555-5555-5555-5555-555555555555', 'Col. Kennedy, Tegucigalpa', 14.0850, -87.2050),
('66666666-6666-6666-6666-666666666666', 'Barrio La Granja, SPS', 15.5048, -88.0250);

-- ============================================
-- CARRERAS DE EJEMPLO
-- ============================================

-- Carrera completada
INSERT INTO carreras (
    tipo, cliente_id, conductor_id,
    origen_direccion, origen_lat, origen_lng,
    destino_direccion, destino_lat, destino_lng,
    distancia_km, tiempo_estimado_min, precio,
    estado, fecha_solicitud, fecha_completado,
    calificacion_conductor, calificacion_cliente
) VALUES (
    'directo',
    (SELECT id FROM clientes WHERE perfil_id = '44444444-4444-4444-4444-444444444444'),
    (SELECT id FROM conductores WHERE perfil_id = '11111111-1111-1111-1111-111111111111'),
    'Centro Comercial Multiplaza', 14.0723, -87.1921,
    'Aeropuerto Toncontín', 14.0608, -87.2172,
    5.2, 20, 78.00,
    'completada',
    NOW() - INTERVAL '2 hours',
    NOW() - INTERVAL '1 hour',
    5, 5
);

-- Carrera en curso
INSERT INTO carreras (
    tipo, cliente_id, conductor_id,
    origen_direccion, origen_lat, origen_lng,
    destino_direccion, destino_lat, destino_lng,
    distancia_km, tiempo_estimado_min, precio,
    estado, fecha_solicitud, fecha_inicio
) VALUES (
    'directo',
    (SELECT id FROM clientes WHERE perfil_id = '55555555-5555-5555-5555-555555555555'),
    (SELECT id FROM conductores WHERE perfil_id = '22222222-2222-2222-2222-222222222222'),
    'Hospital San Felipe', 14.0950, -87.2050,
    'UNAH', 14.0850, -87.1650,
    4.8, 18, 72.00,
    'en_curso',
    NOW() - INTERVAL '30 minutes',
    NOW() - INTERVAL '15 minutes'
);

-- Carrera solicitada (pendiente)
INSERT INTO carreras (
    tipo, cliente_id,
    origen_direccion, origen_lat, origen_lng,
    destino_direccion, destino_lat, destino_lng,
    distancia_km, tiempo_estimado_min, precio,
    estado
) VALUES (
    'directo',
    (SELECT id FROM clientes WHERE perfil_id = '66666666-6666-6666-6666-666666666666'),
    'Mercado Guamilito, SPS', 15.5048, -88.0250,
    'Mall Multiplaza, SPS', 15.5100, -88.0350,
    2.5, 12, 50.00,
    'solicitada'
);

-- Carrera colectiva
INSERT INTO carreras (
    tipo, cliente_id, conductor_id,
    origen_direccion, origen_lat, origen_lng,
    destino_direccion, destino_lat, destino_lng,
    distancia_km, tiempo_estimado_min, precio,
    estado, asientos_disponibles, pasajeros_actuales
) VALUES (
    'colectivo',
    (SELECT id FROM clientes WHERE perfil_id = '44444444-4444-4444-4444-444444444444'),
    (SELECT id FROM conductores WHERE perfil_id = '11111111-1111-1111-1111-111111111111'),
    'Estadio Nacional', 14.0890, -87.1950,
    'Mall Cascadas', 14.0950, -87.1850,
    3.5, 15, 36.75, -- 30% descuento aplicado
    'aceptada', 3, 1
);

-- ============================================
-- UBICACIONES EN TIEMPO REAL
-- ============================================

INSERT INTO ubicaciones_tiempo_real (conductor_id, latitud, longitud, velocidad) VALUES
((SELECT id FROM conductores WHERE perfil_id = '11111111-1111-1111-1111-111111111111'), 14.0850, -87.2063, 25.0),
((SELECT id FROM conductores WHERE perfil_id = '22222222-2222-2222-2222-222222222222'), 14.0680, -87.1900, 30.0);

-- ============================================
-- VERIFICACIÓN
-- ============================================

-- Ver resumen de datos
SELECT 
    'Perfiles' as tabla,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE rol = 'admin') as admins,
    COUNT(*) FILTER (WHERE rol = 'conductor') as conductores,
    COUNT(*) FILTER (WHERE rol = 'cliente') as clientes
FROM perfiles
UNION ALL
SELECT 'Carreras', COUNT(*), 
    COUNT(*) FILTER (WHERE estado = 'completada'),
    COUNT(*) FILTER (WHERE estado = 'en_curso'),
    COUNT(*) FILTER (WHERE estado = 'solicitada')
FROM carreras;

-- Ver conductores con sus datos
SELECT 
    p.nombre,
    c.placa,
    c.estado,
    c.latitud,
    c.longitud
FROM conductores c
JOIN perfiles p ON c.perfil_id = p.id;

-- Ver carreras activas
SELECT 
    numero_carrera,
    tipo,
    estado,
    origen_direccion,
    destino_direccion,
    precio
FROM carreras
WHERE estado NOT IN ('completada', 'cancelada_cliente', 'cancelada_conductor');
