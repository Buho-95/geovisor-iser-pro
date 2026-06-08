'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const { getNormativeConfig } = require('./services/configService');
const { buildInventoryForBlock } = require('./services/inventory');
const { computeInventoryFingerprint } = require('./services/inventoryHash');
const { supabaseAdmin } = require('./services/supabase');
const {
  checkRateLimit,
  bodyTooLarge,
  verifyAnyUser,
  verifyAdmin,
  logStructured,
} = require('./middleware/auth');

// ─── Configuración ───────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TABLE_INV = 'inventario_bloques';

// Orígenes CORS permitidos
const ALLOWED_ORIGINS = [
  'http://localhost:5000',
  'http://localhost:3000',
  'http://127.0.0.1:5000',
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  process.env.FRONTEND_ORIGIN || null,
].filter(Boolean);

// Permite cualquier deployment de Vercel (production + preview) ya que
// todas las operaciones sensibles requieren JWT Supabase válido.
const VERCEL_ORIGIN_RE = /^https:\/\/[a-z0-9][a-z0-9-]*\.vercel\.app$/i;

const corsOptions = {
  origin: (origin, callback) => {
    // Sin origin → Postman / curl / mismo servidor (OK)
    if (!origin || ALLOWED_ORIGINS.includes(origin) || VERCEL_ORIGIN_RE.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS no permitido para origen: ${origin}`));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Geovisor-Env'],
  credentials: true,
};

// ─── App Express ─────────────────────────────────────────────────────
const app = express();
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // pre-flight
app.use(express.json({ limit: '600kb' }));
app.use(bodyTooLarge);

// ─── Health check ─────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', ts: new Date().toISOString() });
});

// ─── Helpers ─────────────────────────────────────────────────────────
function normalizeEnv(req) {
  const body = req.body || {};
  const raw = body.env || req.headers['x-geovisor-env'];
  if (typeof raw !== 'string') return 'production';
  const v = raw.toLowerCase().trim();
  return ['staging', 'production'].includes(v) ? v : 'production';
}

function preAnalisisFromInventario(inventario) {
  const normative = getNormativeConfig();
  const archivos = inventario.archivos || [];
  const REQUISITOS = normative.keywords;
  const out = {};
  Object.entries(REQUISITOS).forEach(([norma, keywords]) => {
    const encontrados = archivos.filter((archivo) => {
      const nombreLower = String(archivo.nombre || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      const carpetaLower = String(archivo.carpeta || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return keywords.some((kw) => nombreLower.includes(kw) || carpetaLower.includes(kw));
    });
    out[norma] = {
      encontrados: encontrados.map((a) => a.nombre),
      count: encontrados.length,
      carpetas: [...new Set(encontrados.map((a) => a.carpeta))],
    };
  });
  return out;
}

function semaforoFromScore(puntaje, thresholds) {
  const t = thresholds || getNormativeConfig().thresholds;
  let nivel = 'rojo';
  let colorHex = '#EF4444';
  if (puntaje >= t.semaforoVerde) {
    nivel = 'verde';
    colorHex = '#10B981';
  } else if (puntaje >= t.semaforoAmarillo) {
    nivel = 'amarillo';
    colorHex = '#F59E0B';
  }
  return { nivel, colorHex };
}

function redactInventarioForAnonymous(inventario) {
  if (!inventario || typeof inventario !== 'object') return inventario;
  const archivos = (inventario.archivos || []).map((a, idx) => {
    const copy = { ...a };
    delete copy.rutaCompleta;
    delete copy.storagePath;
    copy.id = `anon-${idx}-${String(copy.nombre || 'file').slice(0, 64)}`;
    return copy;
  });
  return { ...inventario, basePath: undefined, archivos };
}

// ─── Instancia de Gemini (lazy) ───────────────────────────────────────
let genAIInstance = null;

// ─── ENDPOINT: POST /api/getBlockInventory ───────────────────────────
app.post('/api/getBlockInventory', checkRateLimit, verifyAnyUser, async (req, res) => {
  const body = req.body || {};
  const blockId = body.blockId;
  const sede = body.sede || 'pamplona';
  const blockName = body.blockName || blockId;
  const env = normalizeEnv(req);
  const ctx = req.userCtx;

  if (!blockId || typeof blockId !== 'string' || blockId.length > 120) {
    return res.status(400).json({ error: 'blockId inválido' });
  }

  logStructured('getBlockInventory_start', {
    blockId, uid: ctx.uid, isAdmin: ctx.isAdmin, env
  });

  try {
    const inventario = await buildInventoryForBlock(blockId, blockName, sede, env);

    // Admins: guardar inventario indexado en Supabase (tabla inventario_bloques)
    if (ctx.isAdmin) {
      const { error: upsertErr } = await supabaseAdmin
        .from(TABLE_INV)
        .upsert({
          block_id: blockId,
          block_name: blockName,
          sede: inventario.sede,
          base_path: inventario.basePath,
          archivos: inventario.archivos,
          subcarpetas: inventario.subcarpetas,
          total_archivos: inventario.totalArchivos,
          scan_timestamp: inventario.scanTimestamp,
          archivo_hash: inventario.archivoHash,
          env,
          indexed_at: new Date().toISOString(),
          indexed_by_uid: ctx.uid,
        });

      if (upsertErr) {
        logStructured('inventario_upsert_warn', { blockId, message: upsertErr.message });
      }
    }

    const payloadInventario = ctx.isAnonymous
      ? redactInventarioForAnonymous(inventario)
      : inventario;

    logStructured('getBlockInventory_ok', {
      blockId,
      total: inventario.totalArchivos,
      anon: !!ctx.isAnonymous,
      env,
    });

    return res.status(200).json({ inventario: payloadInventario });
  } catch (e) {
    logStructured('getBlockInventory_err', { message: e.message, env });
    return res.status(500).json({ error: 'Error indexando almacenamiento', detail: e.message });
  }
});

// ─── ENDPOINT: POST /api/getNormativeAudit ───────────────────────────
app.post('/api/getNormativeAudit', checkRateLimit, verifyAdmin, async (req, res) => {
  const { inventario } = req.body || {};
  const env = normalizeEnv(req);
  const ctx = req.userCtx;

  if (!inventario || !Array.isArray(inventario.archivos) || !inventario.blockId) {
    return res.status(400).json({
      error: 'Body inválido. Se requiere { inventario: { blockId, archivos[] } }',
    });
  }

  // Validar / normalizar fingerprint
  const fp = computeInventoryFingerprint(inventario);
  if (inventario.archivoHash && inventario.archivoHash !== fp) {
    logStructured('audit_hash_mismatch', {
      blockId: inventario.blockId, fp, stored: inventario.archivoHash, env
    });
  }

  const apiKey = GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY no configurada en el entorno.' });
  }

  let normative;
  try {
    normative = getNormativeConfig();
  } catch (e) {
    logStructured('normative_config_handler_error', { message: e.message });
    return res.status(500).json({
      error: 'Configuración normativa no disponible',
      detail: e.message,
    });
  }

  const preAnalisis = preAnalisisFromInventario(inventario);

  const listaArchivos = inventario.archivos
    .map(
      (a) =>
        `  - [${a.carpeta || 'raíz'}] ${a.nombre} (${(a.extension || '').toUpperCase()}${
          a.size ? `, ${(a.size / 1024).toFixed(1)}KB` : ''
        })`
    )
    .join('\n');

  const listaCarpetas = (inventario.subcarpetas || []).join(', ');
  const th = normative.thresholds;

  const prompt = `
Actúa como un INTERVENTOR TÉCNICO SENIOR DE PROYECTOS ISER (Instituto Superior de Educación Rural) en Colombia.

Tu tarea es realizar una AUDITORÍA DOCUMENTAL del bloque "${inventario.blockId}" ubicado en la sede "${inventario.sede || 'pamplona'}".

INVENTARIO DE ARCHIVOS ENCONTRADOS (${inventario.totalArchivos} archivos en ${(inventario.subcarpetas || []).length} carpetas):
${listaArchivos || 'Sin archivos registrados.'}

CARPETAS DETECTADAS: ${listaCarpetas || 'Ninguna'}

PRE-ANÁLISIS DE COINCIDENCIAS:
${Object.entries(preAnalisis)
  .map(
    ([norma, data]) =>
      `- ${norma}: ${data.count} archivo(s) potencialmente relacionados${
        data.count > 0 ? ': ' + data.encontrados.slice(0, 5).join(', ') : ''
      }`
  )
  .join('\n')}

INSTRUCCIONES DE AUDITORÍA:
Compara este inventario contra los REQUISITOS MÍNIMOS de cada normativa colombiana:

1. **NSR-10 (Norma Sismo Resistente):**
   - Busca: Planos de cimentación, despiece de vigas/columnas, memorias de cálculo estructural, planos de refuerzo.
   - Evalúa si los documentos estructurales son suficientes.

2. **NTC 6047 (Accesibilidad para personas con movilidad reducida):**
   - Busca: Planos de accesibilidad, diseño de rampas, matrices de cumplimiento, señalización inclusiva.
   - Verifica si hay documentación de accesibilidad universal.

3. **RETIE (Reglamento Técnico de Instalaciones Eléctricas):**
   - Busca: Cuadros de cargas, diagramas unifilares, planos eléctricos, certificaciones.
   - Evalúa completitud eléctrica.

FORMATO DE RESPUESTA OBLIGATORIO (JSON puro, sin markdown):
{
  "resumen_ejecutivo": "Párrafo de 3-4 líneas con hallazgos principales.",
  "normas": {
    "NSR-10": {
      "encontrados": ["lista de documentos encontrados relevantes"],
      "faltantes_criticos": ["lista de documentos faltantes críticos"],
      "puntaje": 0-100,
      "observacion": "Observación breve"
    },
    "NTC-6047": {
      "encontrados": ["..."],
      "faltantes_criticos": ["..."],
      "puntaje": 0-100,
      "observacion": "..."
    },
    "RETIE": {
      "encontrados": ["..."],
      "faltantes_criticos": ["..."],
      "puntaje": 0-100,
      "observacion": "..."
    }
  },
  "puntaje_global": 0-100,
  "tareas_pendientes": [
    {"prioridad": "CRITICA|ALTA|MEDIA", "descripcion": "Tarea específica a realizar"}
  ]
}

IMPORTANTE: Responde SOLO con el JSON válido RFC 8259. Sin texto adicional, sin bloques de código markdown, sin comentarios.
`;

  if (!genAIInstance) {
    genAIInstance = new GoogleGenerativeAI(apiKey);
  }

  const models = ['gemini-2.5-flash', 'gemini-1.5-flash-latest'];
  let lastError = null;

  for (const modelName of models) {
    try {
      const model = genAIInstance.getGenerativeModel({ model: modelName }, { apiVersion: 'v1' });
      const result = await model.generateContent(prompt);
      const rawText = result.response.text().trim();

      let jsonStr = rawText;
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1].trim();

      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (parseErr) {
        logStructured('audit_parse_fail', {
          blockId: inventario.blockId,
          sample: rawText.substring(0, 200),
        });
        return res.status(502).json({
          error: 'La respuesta del modelo no es JSON válido',
          detail: parseErr.message,
          rawPreview: rawText.substring(0, 400),
        });
      }

      const puntaje = Number(parsed.puntaje_global) || 0;
      const { nivel, colorHex } = semaforoFromScore(puntaje, th);

      logStructured('audit_ok', { blockId: inventario.blockId, puntaje, nivel, model: modelName, env });

      return res.status(200).json({
        ...parsed,
        nivel,
        colorHex,
        env,
        inventario_resumen: {
          totalArchivos: inventario.totalArchivos,
          totalCarpetas: (inventario.subcarpetas || []).length,
          blockId: inventario.blockId,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (modelErr) {
      logStructured('audit_model_attempt_failed', {
        model: modelName,
        message: String(modelErr.message || modelErr).slice(0, 300),
      });
      lastError = modelErr;
    }
  }

  logStructured('audit_models_failed', { message: lastError?.message });
  return res.status(503).json({
    error: 'Servicio de IA no disponible temporalmente',
    detail: lastError?.message || 'unknown',
  });
});

// ─── Endpoint de config normativa (público para el cliente) ──────────
app.get('/api/normativeConfig', (_req, res) => {
  try {
    const cfg = getNormativeConfig();
    return res.status(200).json(cfg);
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo cargar la configuración normativa' });
  }
});

// ─── Arranque del servidor ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    event: 'server_start',
    port: PORT,
    supabase_url: process.env.SUPABASE_URL || 'https://scglhxbysycuqqzgzxhe.supabase.co',
    gemini_key_present: !!GEMINI_API_KEY,
  }));
});

module.exports = app;
