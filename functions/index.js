/**
 * Cloud Functions para Geovisor ISER
 * =====================================
 * getNormativeAudit: Proxy seguro hacia la API de Gemini.
 * La API Key de Gemini se obtiene desde Firebase Secrets (--set-secrets GEMINI_API_KEY=...)
 * y nunca se expone en el frontend.
 *
 * Despliegue: firebase deploy --only functions
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── Secret: API Key de Gemini (almacenada en Firebase Secret Manager) ──
// Para configurar: firebase functions:secrets:set GEMINI_API_KEY
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

/**
 * getNormativeAudit — Cloud Function HTTPS
 * POST /api/getNormativeAudit
 *
 * Body esperado:
 * {
 *   "inventario": {
 *     "blockId": "ib",
 *     "blockName": "Bloque IB",
 *     "sede": "pamplona",
 *     "archivos": [...],
 *     "subcarpetas": [...],
 *     "totalArchivos": 25
 *   }
 * }
 *
 * Respuesta: JSON con puntaje, normas, tareas_pendientes, etc.
 */
exports.getNormativeAudit = onRequest(
  {
    secrets: [GEMINI_API_KEY],
    cors: true,           // Permite peticiones desde el Hosting de Firebase
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (req, res) => {
    // ── Validación de método ──
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método no permitido. Usa POST.' });
      return;
    }

    // ── Leer el inventario del body ──
    const { inventario } = req.body || {};
    if (!inventario || !inventario.archivos || !inventario.blockId) {
      res.status(400).json({ error: 'Body inválido. Se requiere { inventario: { blockId, archivos, subcarpetas } }' });
      return;
    }

    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      res.status(500).json({ error: 'GEMINI_API_KEY no configurada en Firebase Secrets.' });
      return;
    }

    // ── Pre-análisis local por keywords normativos ──
    const REQUISITOS_NORMATIVOS = {
      'NSR-10': {
        keywords: [
          'cimentacion', 'cimentación', 'fundacion', 'fundación',
          'viga', 'despiece', 'columna', 'memoria', 'calculo', 'cálculo',
          'estructural', 'placa', 'zapata', 'pedestal', 'refuerzo',
          'nsr', 'sismo', 'resistencia'
        ]
      },
      'NTC-6047': {
        keywords: [
          'accesibilidad', 'rampa', 'ntc', '6047',
          'discapacidad', 'movilidad', 'reducida', 'baranda',
          'señalizacion', 'señalización', 'braille', 'tactil', 'táctil',
          'matriz_accesibilidad', 'acceso_universal'
        ]
      },
      'RETIE': {
        keywords: [
          'electrico', 'eléctrico', 'carga', 'cuadro',
          'tablero', 'retie', 'acometida', 'circuito',
          'iluminacion', 'iluminación', 'subestacion', 'subestación',
          'transformador', 'potencia', 'diagrama_unifilar'
        ]
      }
    };

    const preAnalisis = {};
    Object.entries(REQUISITOS_NORMATIVOS).forEach(([norma, config]) => {
      const encontrados = inventario.archivos.filter(archivo => {
        const nombreLower = archivo.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const carpetaLower = (archivo.carpeta || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return config.keywords.some(kw => nombreLower.includes(kw) || carpetaLower.includes(kw));
      });
      preAnalisis[norma] = {
        encontrados: encontrados.map(a => a.nombre),
        count: encontrados.length,
        carpetas: [...new Set(encontrados.map(a => a.carpeta))]
      };
    });

    // ── Construir el prompt ──
    const listaArchivos = inventario.archivos
      .map(a => `  - [${a.carpeta || 'raíz'}] ${a.nombre} (${(a.extension || '').toUpperCase()}${a.size ? `, ${(a.size / 1024).toFixed(1)}KB` : ''})`)
      .join('\n');

    const listaCarpetas = (inventario.subcarpetas || []).join(', ');

    const prompt = `
Actúa como un INTERVENTOR TÉCNICO SENIOR DE PROYECTOS ISER (Instituto Superior de Educación Rural) en Colombia.

Tu tarea es realizar una AUDITORÍA DOCUMENTAL del bloque "${inventario.blockId}" ubicado en la sede "${inventario.sede || 'pamplona'}".

INVENTARIO DE ARCHIVOS ENCONTRADOS (${inventario.totalArchivos} archivos en ${(inventario.subcarpetas || []).length} carpetas):
${listaArchivos || 'Sin archivos registrados.'}

CARPETAS DETECTADAS: ${listaCarpetas || 'Ninguna'}

PRE-ANÁLISIS DE COINCIDENCIAS:
${Object.entries(preAnalisis).map(([norma, data]) =>
  `- ${norma}: ${data.count} archivo(s) potencialmente relacionados${data.count > 0 ? ': ' + data.encontrados.slice(0, 5).join(', ') : ''}`
).join('\n')}

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

IMPORTANTE: Responde SOLO con el JSON. Sin texto adicional, sin bloques de código markdown.
`;

    // ── Llamada a Gemini AI ──
    const genAI = new GoogleGenerativeAI(apiKey);
    const models = ['gemini-2.5-flash', 'gemini-1.5-flash-latest'];
    let lastError = null;

    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel(
          { model: modelName },
          { apiVersion: 'v1' }
        );
        const result = await model.generateContent(prompt);
        const rawText = result.response.text().trim();

        // Parsear JSON (manejar posible wrapper markdown)
        let jsonStr = rawText;
        const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonStr = jsonMatch[1].trim();

        try {
          const parsed = JSON.parse(jsonStr);

          // Determinar semáforo
          const puntaje = parsed.puntaje_global || 0;
          let nivel = 'rojo';
          let colorHex = '#EF4444';
          if (puntaje >= 85) { nivel = 'verde'; colorHex = '#10B981'; }
          else if (puntaje >= 60) { nivel = 'amarillo'; colorHex = '#F59E0B'; }

          res.status(200).json({
            ...parsed,
            nivel,
            colorHex,
            inventario_resumen: {
              totalArchivos: inventario.totalArchivos,
              totalCarpetas: (inventario.subcarpetas || []).length,
              blockId: inventario.blockId
            },
            timestamp: new Date().toISOString()
          });
          return;

        } catch (parseErr) {
          // Fallback si no se pudo parsear el JSON
          res.status(200).json({
            resumen_ejecutivo: rawText.substring(0, 500),
            normas: {},
            puntaje_global: 0,
            nivel: 'rojo',
            colorHex: '#EF4444',
            tareas_pendientes: [{ prioridad: 'CRITICA', descripcion: 'Error en el análisis. Reintentar auditoría.' }],
            inventario_resumen: {
              totalArchivos: inventario.totalArchivos,
              totalCarpetas: (inventario.subcarpetas || []).length,
              blockId: inventario.blockId
            },
            timestamp: new Date().toISOString(),
            _parseError: true
          });
          return;
        }

      } catch (modelErr) {
        console.warn(`Modelo ${modelName} falló:`, modelErr.message);
        lastError = modelErr;
      }
    }

    // Si todos los modelos fallaron
    res.status(500).json({ error: 'Todos los modelos de IA fallaron.', details: lastError?.message });
  }
);
