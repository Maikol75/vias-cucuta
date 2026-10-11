// ══════════════════════════════════════════════════════════════════
//  MiVía — Configuración de Supabase
//  Credenciales y constantes compartidas por todas las vistas.
//  Son LOS MISMOS datos que usa la app móvil (lib/config.dart).
// ══════════════════════════════════════════════════════════════════

// Supabase > Project Settings > API > Project URL
export const SUPABASE_URL = "https://hjlgduznwglolnxoourt.supabase.co";

// Supabase > Project Settings > API > anon / public key
// Es pública por diseño: la seguridad real la dan las reglas RLS de la base de datos.
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqbGdkdXpud2dsb2xueG9vdXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3MjU4NjEsImV4cCI6MjEwNzMwMTg2MX0.JQBl1CnwSrcBC4wwobGGychU-gqUG8RyTFvNJEFZSN0";

// Login con nombre de usuario: "maikol_r" se convierte en "maikol_r@mivia.local".
// Debe ser EXACTAMENTE el mismo valor que `dominioInterno` en la app.
export const DOMINIO_INTERNO = "mivia.local";

// Bucket de Storage donde se guardan las fotos de los reportes.
export const BUCKET_FOTOS = "reportes-fotos";

// Las fotos se reducen en el navegador antes de subirlas
// (el bucket acepta máximo 2 MB por imagen).
export const FOTO_LADO_MAX_PX = 1280;
export const FOTO_CALIDAD_JPEG = 0.75;
