// ══════════════════════════════════════════════════════════════════
//  VíasCúcuta — Servicio de Geocodificación
//  Convierte texto (direcciones, lugares) en coordenadas lat/lng
//  usando Nominatim (OpenStreetMap) — gratis, sin API key.
// ══════════════════════════════════════════════════════════════════

// Bounding box que cubre Cúcuta y su área metropolitana
// Formato: oeste,sur,este,norte (lon,lat,lon,lat)
const CUCUTA_VIEWBOX = "-72.65,7.78,-72.40,7.98";

// Endpoint público de Nominatim
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Mapeo de tipos OSM a icono y etiqueta legible en español
const TYPE_META = {
    university:    { icon: "🎓", label: "Universidad" },
    college:       { icon: "🎓", label: "Institución educativa" },
    school:        { icon: "🏫", label: "Colegio" },
    hospital:      { icon: "🏥", label: "Hospital" },
    clinic:        { icon: "🏥", label: "Clínica" },
    pharmacy:      { icon: "💊", label: "Farmacia" },
    restaurant:    { icon: "🍽️", label: "Restaurante" },
    cafe:          { icon: "☕", label: "Café" },
    bar:           { icon: "🍺", label: "Bar" },
    fast_food:     { icon: "🍔", label: "Comida rápida" },
    bank:          { icon: "🏦", label: "Banco" },
    atm:           { icon: "🏧", label: "Cajero" },
    fuel:          { icon: "⛽", label: "Gasolinera" },
    supermarket:   { icon: "🛒", label: "Supermercado" },
    mall:          { icon: "🛍️", label: "Centro comercial" },
    shop:          { icon: "🏪", label: "Tienda" },
    hotel:         { icon: "🏨", label: "Hotel" },
    park:          { icon: "🌳", label: "Parque" },
    stadium:       { icon: "🏟️", label: "Estadio" },
    church:        { icon: "⛪", label: "Iglesia" },
    place_of_worship: { icon: "⛪", label: "Lugar de culto" },
    bus_station:   { icon: "🚌", label: "Terminal de buses" },
    airport:       { icon: "✈️", label: "Aeropuerto" },
    police:        { icon: "👮", label: "Policía" },
    fire_station:  { icon: "🚒", label: "Bomberos" },
    library:       { icon: "📚", label: "Biblioteca" },
    primary:       { icon: "🛣️", label: "Vía principal" },
    secondary:     { icon: "🛣️", label: "Vía secundaria" },
    tertiary:      { icon: "🛣️", label: "Vía" },
    residential:   { icon: "🏘️", label: "Calle residencial" },
    living_street: { icon: "🏘️", label: "Calle peatonal" },
    pedestrian:    { icon: "🚶", label: "Peatonal" },
    house:         { icon: "🏠", label: "Vivienda" },
    administrative:{ icon: "🏛️", label: "Zona administrativa" },
    suburb:        { icon: "🏘️", label: "Barrio" },
    neighbourhood: { icon: "🏘️", label: "Vecindario" },
    city:          { icon: "🌆", label: "Ciudad" },
    town:          { icon: "🌆", label: "Población" },
    village:       { icon: "🏘️", label: "Pueblo" }
};

const DEFAULT_META = { icon: "📍", label: "Ubicación" };

/**
 * Busca coordenadas a partir de un texto (calle, lugar, edificio, etc.).
 * Sesga los resultados a Cúcuta, Colombia. Deduplica y enriquece resultados.
 *
 * @param {string} query   Texto a buscar
 * @param {number} limit   Máximo de sugerencias a devolver (default 5)
 * @returns {Promise<Array>} Array de objetos enriquecidos
 */
export async function geocodeAddress(query, limit = 5) {
    const trimmed = query.trim();
    if (trimmed.length < 3) return [];

    // Pedimos más resultados de los necesarios para tener margen tras deduplicar
    const params = new URLSearchParams({
        q:              trimmed,
        format:         "json",
        limit:          String(limit * 2),
        countrycodes:   "co",
        viewbox:        CUCUTA_VIEWBOX,
        bounded:        "1",
        addressdetails: "1"
    });

    try {
        const res = await fetch(`${NOMINATIM_URL}?${params}`, {
            headers: { "Accept-Language": "es" }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const formatted = data.map(formatResult);
        return deduplicate(formatted).slice(0, limit);
    } catch (err) {
        console.error("Error en geocodificación:", err);
        return [];
    }
}

/** Da formato uniforme al resultado de Nominatim, agrega icono y etiqueta */
function formatResult(item) {
    const parts    = (item.display_name || "").split(",").map(s => s.trim());
    const mainName = parts[0] || "Ubicación";
    const subName  = parts.slice(1, 4).join(", ") || "";

    // Nominatim entrega `type` (ej: "university") y `class` (ej: "amenity"). Probamos ambos.
    const meta = TYPE_META[item.type] || TYPE_META[item.class] || DEFAULT_META;

    return {
        lat:         parseFloat(item.lat),
        lng:         parseFloat(item.lon),
        displayName: item.display_name,
        mainName,
        subName,
        type:        item.type || "",
        icon:        meta.icon,
        typeLabel:   meta.label
    };
}

/**
 * Quita duplicados — Nominatim a veces devuelve el mismo lugar múltiples veces
 * (un nodo + un way + una relation OSM apuntando al mismo edificio).
 * Considera duplicados si comparten nombre y están a < 30m.
 */
function deduplicate(results) {
    const unique = [];
    for (const r of results) {
        const isDup = unique.some(u =>
            u.mainName.toLowerCase() === r.mainName.toLowerCase()
            && distMeters(u.lat, u.lng, r.lat, r.lng) < 30
        );
        if (!isDup) unique.push(r);
    }
    return unique;
}

/** Distancia simple entre dos puntos GPS (Haversine) */
function distMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return R * 2 * Math.asin(Math.sqrt(a));
}