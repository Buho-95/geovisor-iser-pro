'use strict';

const { supabaseAdmin } = require('../services/supabase');

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 120;
const RATE_MAX_UID = 100;
const rateBuckets = new Map();
const rateBucketsUid = new Map();

// Emails de admin de respaldo (configurable vía env var ADMIN_EMAILS, separados por coma)
// Solo actúa si la tabla usuarios_iser no devuelve un perfil con role='admin'.
const ADMIN_EMAILS_ENV = process.env.ADMIN_EMAILS || '';
const FALLBACK_ADMIN_EMAILS = ADMIN_EMAILS_ENV
  ? ADMIN_EMAILS_ENV.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  : [];

function logStructured(event, payload) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...payload }));
}

function extractBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return { error: 'Unauthorized - No token', status: 401 };
  }
  const token = authHeader.split('Bearer ')[1];
  if (!token) {
    return { error: 'Unauthorized - No token', status: 401 };
  }
  return { token };
}

function truncateEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const at = email.indexOf('@');
  if (at <= 1) return '***';
  return `${email[0]}***@${email.slice(at + 1)}`;
}

/**
 * Verifica el token JWT usando Supabase Auth.
 */
async function verifySupabaseToken(req) {
  const extracted = extractBearerToken(req);
  if (extracted.error) return extracted;

  const { token } = extracted;

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      logStructured('auth_verify_failed', {
        message: error ? error.message : 'No user found'
      });
      return { error: 'Unauthorized - Invalid token', status: 401 };
    }
    
    req.supabaseUser = user;
    return { user };
  } catch (error) {
    logStructured('auth_verify_failed', {
      message: error.message || 'verify_error'
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
 * Rate limit por IP.
 */
function checkRateLimit(req, res, next) {
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
    return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta más tarde.' });
  }
  next();
}

const MAX_BODY_BYTES = 600 * 1024;

function bodyTooLarge(req, res, next) {
  const cl = req.headers['content-length'];
  if (cl && Number(cl) > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Cuerpo de solicitud demasiado grande.' });
  }
  next();
}

/**
 * Middleware para requerir usuario autenticado (cualquiera: admin, editor, viewer, anonymous)
 */
async function verifyAnyUser(req, res, next) {
  const verified = await verifySupabaseToken(req);
  if (verified.error) {
    return res.status(verified.status).json({ error: verified.error });
  }
  
  const user = verified.user;
  const isAnonymous = user.is_anonymous || user.app_metadata?.provider === 'anonymous' || !user.email;
  
  // Rate limit adicional por UID
  const uid = user.id;
  const now = Date.now();
  let b = rateBucketsUid.get(uid);
  if (!b || now - b.start > RATE_WINDOW_MS) {
    b = { start: now, count: 0 };
    rateBucketsUid.set(uid, b);
  }
  b.count += 1;
  if (b.count > RATE_MAX_UID) {
    logStructured('rate_limit_uid', { uid, count: b.count, max: RATE_MAX_UID });
    return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta más tarde.' });
  }

  let role = isAnonymous ? 'visitor' : 'viewer';
  let isAdmin = false;

  try {
    // Buscar el rol del usuario en la tabla de perfiles usuarios_iser
    const { data: profile } = await supabaseAdmin
      .from('usuarios_iser')
      .select('role')
      .eq('uid', uid)
      .single();

    if (profile) {
      role = profile.role || role;
    }
  } catch (e) {
    logStructured('usuarios_iser_read_warn', { message: e.message });
  }

  const email = user.email || '';
  if (FALLBACK_ADMIN_EMAILS.length > 0 && FALLBACK_ADMIN_EMAILS.includes(email.toLowerCase())) {
    role = 'admin';
  }

  isAdmin = role === 'admin';

  req.userCtx = {
    uid,
    email: email || null,
    isAnonymous,
    role,
    isAdmin
  };

  next();
}

/**
 * Middleware para requerir rol Administrador
 */
async function verifyAdmin(req, res, next) {
  const verified = await verifySupabaseToken(req);
  if (verified.error) {
    return res.status(verified.status).json({ error: verified.error });
  }

  const user = verified.user;
  const isAnonymous = user.is_anonymous || user.app_metadata?.provider === 'anonymous' || !user.email;
  
  if (isAnonymous) {
    return res.status(403).json({ error: 'Los visitantes anónimos no pueden ejecutar esta acción' });
  }

  const email = user.email || '';
  let isAdmin = false;

  try {
    const { data: profile } = await supabaseAdmin
      .from('usuarios_iser')
      .select('role')
      .eq('uid', user.id)
      .single();

    if (profile && profile.role === 'admin') {
      isAdmin = true;
    }
  } catch (e) {
    logStructured('usuarios_iser_read_warn', { message: e.message });
  }

  if (!isAdmin && FALLBACK_ADMIN_EMAILS.length > 0 && FALLBACK_ADMIN_EMAILS.includes(email.toLowerCase())) {
    isAdmin = true;
  }

  if (!isAdmin) {
    return res.status(403).json({ error: 'Solo administradores autorizados' });
  }

  req.userCtx = {
    uid: user.id,
    email: email || null,
    isAnonymous: false,
    role: 'admin',
    isAdmin: true
  };

  next();
}

module.exports = {
  checkRateLimit,
  bodyTooLarge,
  verifyAnyUser,
  verifyAdmin,
  logStructured
};
