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

// ══════════════════════════════════════════════════════════════════
//  Firebase App Check — protección anti-bots/spam (opcional)
//
//  Hoy el único freno contra spam es un rate-limit en localStorage,
//  que cualquiera evade abriendo una ventana de incógnito. App Check
//  con reCAPTCHA v3 resuelve esto sin necesitar un backend propio:
//  Firebase verifica cada petición a Firestore por su cuenta.
//
//  Cómo activarla (mientras dejes el placeholder de abajo, NO CAMBIA
//  NADA — reportes-service.js y admin-service.js detectan que no está
//  configurada y simplemente no la inicializan):
//
//  1. Firebase Console → Build → App Check → "Apps" → registra esta
//     app web con el proveedor "reCAPTCHA v3" → te da una site key.
//  2. Pega esa site key abajo, reemplazando "TU_RECAPTCHA_SITE_KEY_AQUI".
//  3. Mientras pruebes en localhost, App Check bloqueará las peticiones
//     porque no reconoce ese dominio. Para probar en desarrollo:
//       a) Abre la consola del navegador — vas a ver un mensaje con un
//          "App Check debug token".
//       b) Cópialo en Firebase Console → App Check → esta app →
//          "Manage debug tokens" → Add debug token.
//  4. Solo cuando confirmes que reportar (index.html) y el panel
//     (admin.html) siguen funcionando bien con la site key puesta,
//     activa "Enforce" en Firestore dentro de App Check.
//     ⚠️ No actives "Enforce" antes de probar con el debug token:
//     mientras no lo hagas, sigue sin protección pero nada se rompe;
//     si activas "Enforce" sin haber probado, puedes bloquear el mapa
//     público para todo el mundo (lectura incluida).
// ══════════════════════════════════════════════════════════════════
export const RECAPTCHA_V3_SITE_KEY = "TU_RECAPTCHA_SITE_KEY_AQUI";