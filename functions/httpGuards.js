'use strict';

const admin = require('firebase-admin');

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 30;
const RATE_MAX_UID = 40;
const rateBuckets = new Map();
const rateBucketsUid = new Map();
const TEMP_ADMIN_EMAILS = ['pedrojtrillos.arq@gmail.com'];

function logStructured(event, payload) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...payload }));
}

function extractBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return { error: 'Unauthorized - No token', status: 401 };
  }
  const idToken = authHeader.split('Bearer ')[1];
  if (!idToken) {
    return { error: 'Unauthorized - No token', status: 401 };
  }
  return { idToken };
}

function truncateEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const at = email.indexOf('@');
  if (at <= 1) return '***';
  return `${email[0]}***@${email.slice(at + 1)}`;
}

async function verifyFirebaseIdToken(req) {
  const extracted = extractBearerToken(req);
  if (extracted.error) return extracted;

  const { idToken } = extracted;

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    return { decodedToken };
  } catch (error) {
    logStructured('auth_verify_failed', {
      code: error.code || 'unknown',
      message: error.message ? String(error.message).slice(0, 200) : 'verify_error',
    });
    return { error: 'Unauthorized - Invalid token', status: 401 };
  }
}

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
    logStructured('rate_limit_ip', { key, count: b.count, max: RATE_MAX });
    res.status(429).json({ error: 'Demasiadas solicitudes. Intenta más tarde.' });
    return false;
  }
  return true;
}

/**
 * Rate limit adicional por UID (tras autenticación).
 */
function checkRateLimitUid(req, res, uid) {
  const key = uid && String(uid).length ? `uid:${uid}` : `uid:unknown`;
  const now = Date.now();
  let b = rateBucketsUid.get(key);
  if (!b || now - b.start > RATE_WINDOW_MS) {
    b = { start: now, count: 0 };
    rateBucketsUid.set(key, b);
  }
  b.count += 1;
  if (b.count > RATE_MAX_UID) {
    logStructured('rate_limit_uid', { key, count: b.count, max: RATE_MAX_UID });
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
  const verified = await verifyFirebaseIdToken(req);
  if (verified.error) return verified;
  const decoded = verified.decodedToken;
  if (decoded.firebase?.sign_in_provider === 'anonymous') {
    return { error: 'Los visitantes anónimos no pueden ejecutar esta acción', status: 403 };
  }
  const email = String(decoded.email || '').toLowerCase();
  if (TEMP_ADMIN_EMAILS.includes(email)) {
    logStructured('rbac_admin_fallback_email', {
      uid: decoded.uid,
      email: truncateEmail(email),
      hint: 'usar_custom_claims_o_usuarios_iser',
    });
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
  const verified = await verifyFirebaseIdToken(req);
  if (verified.error) return verified;
  const decoded = verified.decodedToken;
  const anon = decoded.firebase?.sign_in_provider === 'anonymous';
  let role = anon ? 'visitor' : 'viewer';
  try {
    const snap = await admin.firestore().doc(`usuarios_iser/${decoded.uid}`).get();
    if (snap.exists) role = snap.data().role || role;
  } catch (e) {
    logStructured('usuarios_iser_read_warn', { message: String(e.message || e).slice(0, 200) });
  }
  const isAdmin = role === 'admin';
  return { uid: decoded.uid, email: decoded.email || null, isAnonymous: anon, role, isAdmin };
}

module.exports = {
  checkRateLimit,
  checkRateLimitUid,
  bodyTooLarge,
  verifyBearerAndAdmin,
  verifyBearerAnyUser,
  logStructured,
  MAX_BODY_BYTES,
};
