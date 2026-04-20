/**
 * Cloud Functions — Geovisor ISER PRO
 * getBlockInventory: índice de Storage (Admin SDK) → Firestore + respuesta
 * getNormativeAudit: proxy Gemini con Auth + rol admin
 */
'use strict';

const path = require('path');
const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const normative = require(path.join(__dirname, '..', 'frontend', 'shared', 'normative-config.json'));
const { buildInventoryForBlock, STORAGE_BASE } = require('./storageInventory');
const { computeInventoryFingerprint } = require('./inventoryHash');
const {
  checkRateLimit,
  bodyTooLarge,
  verifyBearerAndAdmin,
  verifyBearerAnyUser,
  logStructured,
} = require('./httpGuards');

if (!admin.apps.length) {
  admin.initializeApp();
}

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

let genAIInstance = null;

const COL_INV = 'inventario_bloques';

function preAnalisisFromInventario(inventario) {
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
  const t = thresholds || normative.thresholds;
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

async function handleGetBlockInventory(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido. Usa POST.' });
    return;
  }
  if (!checkRateLimit(req, res)) return;
  if (bodyTooLarge(req)) {
    res.status(413).json({ error: 'Cuerpo de solicitud demasiado grande.' });
    return;
  }

  const ctx = await verifyBearerAnyUser(req);
  if (ctx.error) {
    res.status(ctx.status).json({ error: ctx.error });
    return;
  }

  const body = req.body || {};
  const blockId = body.blockId;
  const sede = body.sede || 'pamplona';
  const blockName = body.blockName || blockId;

  if (!blockId || typeof blockId !== 'string' || blockId.length > 120) {
    res.status(400).json({ error: 'blockId inválido' });
    return;
  }

  logStructured('getBlockInventory_start', { blockId, uid: ctx.uid, isAdmin: ctx.isAdmin });

  try {
    const inventario = await buildInventoryForBlock(blockId, blockName, sede);
    if (ctx.isAdmin) {
      const doc = {
        ...inventario,
        indexedAt: admin.firestore.FieldValue.serverTimestamp(),
        indexedByUid: ctx.uid,
      };
      await admin.firestore().collection(COL_INV).doc(blockId).set(doc, { merge: true });
    }
    logStructured('getBlockInventory_ok', { blockId, total: inventario.totalArchivos });
    res.status(200).json({ inventario });
  } catch (e) {
    logStructured('getBlockInventory_err', { message: e.message, stack: e.stack });
    res.status(500).json({ error: 'Error indexando almacenamiento', detail: e.message });
  }
}

async function handleGetNormativeAudit(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido. Usa POST.' });
    return;
  }
  if (!checkRateLimit(req, res)) return;
  if (bodyTooLarge(req)) {
    res.status(413).json({ error: 'Cuerpo de solicitud demasiado grande.' });
    return;
  }

  const ctx = await verifyBearerAndAdmin(req);
  if (ctx.error) {
    res.status(ctx.status).json({ error: ctx.error });
    return;
  }

  const { inventario } = req.body || {};
  if (!inventario || !Array.isArray(inventario.archivos) || !inventario.blockId) {
    res.status(400).json({
      error: 'Body inválido. Se requiere { inventario: { blockId, archivos[] } }',
    });
    return;
  }

  const fp = computeInventoryFingerprint(inventario);
  if (inventario.archivoHash && inventario.archivoHash !== fp) {
    logStructured('audit_hash_mismatch', { blockId: inventario.blockId, fp, stored: inventario.archivoHash });
  }

  const apiKey = GEMINI_API_KEY.value();
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY no configurada en Firebase Secrets.' });
    return;
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
  const genAI = genAIInstance;
  const models = ['gemini-2.5-flash', 'gemini-1.5-flash-latest'];
  let lastError = null;

  for (const modelName of models) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName }, { apiVersion: 'v1' });
      const result = await model.generateContent(prompt);
      const rawText = result.response.text().trim();

      let jsonStr = rawText;
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1].trim();

      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (parseErr) {
        logStructured('audit_parse_fail', { blockId: inventario.blockId, sample: rawText.substring(0, 200) });
        res.status(502).json({
          error: 'La respuesta del modelo no es JSON válido',
          detail: parseErr.message,
          rawPreview: rawText.substring(0, 400),
        });
        return;
      }

      const puntaje = Number(parsed.puntaje_global) || 0;
      const { nivel, colorHex } = semaforoFromScore(puntaje, th);

      res.status(200).json({
        ...parsed,
        nivel,
        colorHex,
        inventario_resumen: {
          totalArchivos: inventario.totalArchivos,
          totalCarpetas: (inventario.subcarpetas || []).length,
          blockId: inventario.blockId,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    } catch (modelErr) {
      console.warn(`Modelo ${modelName} falló:`, modelErr.message);
      lastError = modelErr;
    }
  }

  logStructured('audit_models_failed', { message: lastError?.message });
  res.status(503).json({
    error: 'Servicio de IA no disponible temporalmente',
    detail: lastError?.message || 'unknown',
  });
}

const fnOpts = {
  cors: true,
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 120,
};

exports.getBlockInventory = onRequest(fnOpts, handleGetBlockInventory);

exports.getNormativeAudit = onRequest(
  {
    ...fnOpts,
    secrets: [GEMINI_API_KEY],
  },
  handleGetNormativeAudit
);
