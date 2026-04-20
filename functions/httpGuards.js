'use strict';

const admin = require('firebase-admin');

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 30;
const rateBuckets = new Map();
const TEMP_ADMIN_EMAILS = ['pedrojtrillos.arq@gmail.com'];

function getClientKey(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) {
    return xf.split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

/**
 * Rate limit por IP (best-effort en entorno serverless).
 */
function checkRateLimit(req, res) {
  const key = getClientKey(req);
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || now - b.start > RATE_WINDOW_MS) {
    b = { start: now, count: 0 };
    rateBuckets.set(key, b);
  }
  b.count += 1;
  if (b.count > RATE_MAX) {
    res.status(429).json({ error: 'Demasiadas solicitudes. Intenta más tarde.' });
    return false;
  }
  return true;
}

const MAX_BODY_BYTES = 600 * 1024;

function bodyTooLarge(req) {
  const cl = req.headers['content-length'];
  if (cl && Number(cl) > MAX_BODY_BYTES) return true;
  try {
    const raw = typeof req.rawBody !== 'undefined' ? req.rawBody : null;
    if (raw && raw.length > MAX_BODY_BYTES) return true;
  } catch (_) { /* noop */ }
  return false;
}

async function verifyBearerAndAdmin(req) {
  const authHeader = req.headers.authorization || '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return { error: 'Se requiere Authorization: Bearer <idToken>', status: 401 };
  }
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(m[1]);
  } catch (e) {
    return { error: 'Token inválido o expirado', status: 401 };
  }
  if (decoded.firebase?.sign_in_provider === 'anonymous') {
    return { error: 'Los visitantes anónimos no pueden ejecutar esta acción', status: 403 };
  }
  const email = String(decoded.email || '').toLowerCase();
  if (TEMP_ADMIN_EMAILS.includes(email)) {
    return { uid: decoded.uid, email: decoded.email || null, isAdmin: true, fallback: 'email' };
  }
  const snap = await admin.firestore().doc(`usuarios_iser/${decoded.uid}`).get();
  if (!snap.exists || snap.data().role !== 'admin') {
    return { error: 'Solo administradores autorizados', status: 403 };
  }
  return { uid: decoded.uid, email: decoded.email || null, isAdmin: true };
}

/**
 * Cualquier usuario autenticado (incl. anónimo). Usado para inventario solo lectura.
 */
async function verifyBearerAnyUser(req) {
  const authHeader = req.headers.authorization || '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return { error: 'Se requiere Authorization: Bearer <idToken>', status: 401 };
  }
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(m[1]);
  } catch (e) {
    return { error: 'Token inválido o expirado', status: 401 };
  }
  const anon = decoded.firebase?.sign_in_provider === 'anonymous';
  const snap = await admin.firestore().doc(`usuarios_iser/${decoded.uid}`).get();
  const role = snap.exists ? snap.data().role : anon ? 'visitor' : 'viewer';
  const isAdmin = role === 'admin';
  return { uid: decoded.uid, email: decoded.email || null, isAnonymous: anon, role, isAdmin };
}

function logStructured(event, payload) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...payload }));
}

module.exports = {
  checkRateLimit,
  bodyTooLarge,
  verifyBearerAndAdmin,
  verifyBearerAnyUser,
  logStructured,
  MAX_BODY_BYTES,
};
