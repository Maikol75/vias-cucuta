// ══════════════════════════════════════════════════════════════════
//  VíasCúcuta — Configuración de Firebase
//  Credenciales y proyecto único compartido por todas las vistas
// ══════════════════════════════════════════════════════════════════

export const firebaseConfig = {
    apiKey:            "AIzaSyAW15yvAjBHQR068JguNhaL_Tmtzoovmio",
    authDomain:        "vias-cucuta.firebaseapp.com",
    projectId:         "vias-cucuta",
    storageBucket:     "vias-cucuta.firebasestorage.app",
    messagingSenderId: "1002872048654",
    appId:             "1:1002872048654:web:e673afed3fc382ef80c05f",
    measurementId:     "G-9JWZMMBF2T"
};

// Nombre de la colección principal en Firestore
export const COLLECTION_REPORTES = "reportes";

// Carpeta de Storage donde se suben las fotos de los reportes
export const STORAGE_FOLDER_REPORTES = "reportes";

// Site key de reCAPTCHA v3 para Firebase App Check (protección anti-bots/spam
// al crear reportes). Mientras tenga el placeholder "TU_" de abajo, App Check
// queda desactivado y Firestore sigue funcionando exactamente igual que sin
// esta protección — no rompe nada dejarlo así.
//
// Para activarlo:
//   1. Firebase Console → App Check → Apps → Registrar tu app web → reCAPTCHA v3
//   2. Copia la "Site key" que te entrega Google reCAPTCHA y pégala abajo
//   3. En Firebase Console → App Check → Enforce, activa la aplicación para
//      Firestore (y Storage si también subes fotos por ahí)
export const RECAPTCHA_V3_SITE_KEY = "TU_RECAPTCHA_V3_SITE_KEY_AQUI";