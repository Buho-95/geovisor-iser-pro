/**
 * Módulo de Mantenimiento — Diagnóstico técnico asistido por IA.
 * Recopila contexto de archivos, genera diagnósticos simulados,
 * y exporta informes oficiales en PDF con jsPDF.
 */
import { state, setCurrentBlock } from './core/state.js';
import { getCampusData } from './campus-data.js';
import { storage } from './services/firebase.js';
import { getFilesInPath } from './services/fileMapper.js';
import { guardarEstadoBloque } from './services/firestore.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { on, EVENTS } from './core/events.js';
import { Logger } from './core/logger.js';

// ─── DOM References ───
let formEl, bloqueSelect, estadoSelect, fechaInput;
let diagnosticoArea, recomendacionesArea;
let btnIA, btnPDF, spinnerOverlay;
let contextSummary, contextList;
let chartDist = null;
let chartEstado = null;

// ─── Relevant folders for AI context ───
const AI_CONTEXT_PATHS = [
  { path: '01_Arquitectonico', label: 'Arquitectónico' },
  { path: '02_Estructural', label: 'Estructural' },
  { path: '03_Electricos_y_Red_de_Datos', label: 'Eléctricos y Redes' },
  { path: '04_Hidrosanitarios', label: 'Hidrosanitarios' },
  { path: '06_Documentos', label: 'Documentos' },
  { path: '07_Matriz_Accesibilidad_NTC_6047', label: 'Accesibilidad' },
  { path: '08_Registro_Fotografico', label: 'Fotografías' }
];

// ─── GEMINI API KEY ───
// TODO: Pegar la API Key de Google AI Studio aquí.
const GEMINI_API_KEY = "AIzaSyBtW6xf9FLNN7j8wwy9jpg0PUuOaz6Vz-8";

/**
 * Get file context for AI analysis from specific folders.
 * @param {string} blockId
 * @returns {{ files: Array, summary: string }}
 */
function getContextForAI(blockId) {
  const campusData = getCampusData();
  const blockName = campusData?.[blockId]?.name || blockId;
  const allContextFiles = [];

  AI_CONTEXT_PATHS.forEach(({ path, label }) => {
    const files = getFilesInPath(blockId, path);
    files.forEach(f => {
      allContextFiles.push({
        nombre: f.nombre || f.name || 'Sin nombre',
        carpeta: label,
        tipo: f.tipo || 'desconocido',
        url: f.url,
        tamaño: f.tamaño,
        tipoMime: f.tipoMime,
        fecha: f.fechaSubida || f.fechaCreacion || f.fecha || '--'
      });
    });
  });

  const summary = allContextFiles.length > 0
    ? `Se encontraron ${allContextFiles.length} archivo(s) relevantes en ${blockName}.`
    : `No se encontraron archivos de contexto para ${blockName}.`;

  return { files: allContextFiles, summary, blockName };
}

/**
 * Generate a diagnosis using Google Gemini SDK.
 */
async function generateAIDiagnosis(blockId, context) {
  if (!GEMINI_API_KEY) {
    throw new Error('La API Key de Gemini no está configurada.');
  }

  const campusData = getCampusData();
  const blockInfo = campusData?.[blockId]?.info || {};
  const blockName = campusData?.[blockId]?.name || blockId;
  const estado = estadoSelect?.value || 'regular';
  const fecha = fechaInput?.value || 'No registrada';

  // Actualizar UI del spinner si existe
  const spinnerText = document.querySelector('.mant-spinner-text');
  if (spinnerText) spinnerText.textContent = "Extrayendo y analizando contenido de documentos técnicos...";

  const parts = [];
  let textoEstructurado = `
Actúa como un Auditor Técnico de Infraestructura del ISER evaluando el bloque: ${blockName}.
Estado general reportado: ${estado.toUpperCase()}. Fecha de inspección: ${fecha}.
Datos de construcción: Área ${blockInfo.area || '--'} m², Recintos ${blockInfo.rooms || '--'}, Sistema ${blockInfo.construction || '--'}.

INSTRUCCIÓN ESPECIAL DE CONTENIDO:
Analiza el contenido de estos documentos técnicos (PDF/Excel) adjuntos y las metadata de los modelos 3D. 
No te limites a los nombres de los archivos; busca datos específicos de áreas, materiales, observaciones y cumplimiento de normas dentro de ellos. 
Para los archivos 3D (.rvt, .dwg), evalúa la actualización de los modelos basándote en su fecha y tamaño.

Documentos disponibles en el sistema:
`;

  // Helpers de Extracción
  const fetchAsBase64 = async (url) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });
    } catch { return null; }
  };

  const extractExcel = async (url) => {
    try {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: 'array' });
      return window.XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]).substring(0, 3000);
    } catch { return null; }
  };

  // ── Multi-Norm Audit Flags ──
  let hasElectrico = false;
  let hasRedes = false;
  let hasArquitectura = false;

  let extractPDFsCount = 0;
  
  for (const f of context.files) {
    const sizeMB = f.tamaño ? (f.tamaño / (1024 * 1024)).toFixed(2) + ' MB' : 'Desconocido';
    const dateObj = typeof f.fecha?.toDate === 'function' ? f.fecha.toDate() : new Date(f.fecha);
    const dateStr = !isNaN(dateObj) ? dateObj.toLocaleDateString() : f.fecha;
    const fNameUpper = f.nombre.toUpperCase();
    
    textoEstructurado += `- [${f.carpeta}] ${f.nombre} (${f.tipo.toUpperCase()} | ${sizeMB} | Modif: ${dateStr})\n`;
    
    // Check for audit categories
    if (fNameUpper.includes('ELEC_') || f.carpeta === 'Eléctricos y Redes') hasElectrico = true;
    if (fNameUpper.includes('DATA_') || fNameUpper.includes('RED') || f.carpeta === 'Eléctricos y Redes') hasRedes = true;
    if (f.carpeta === 'Arquitectónico' || f.carpeta === 'Estructural') hasArquitectura = true;
    
    if (f.tipo.toUpperCase() === 'PDF' && f.url && extractPDFsCount < 3) {
      extractPDFsCount++;
      const b64 = await fetchAsBase64(f.url);
      if (b64) {
        parts.push({
          inlineData: {
            data: b64,
            mimeType: "application/pdf"
          }
        });
      } else {
        textoEstructurado += `  *(Note: Fallo al extraer PDF)*\n`;
      }
    } else if (f.tipo.toUpperCase() === 'EXCEL' && f.url && window.XLSX) {
      const csv = await extractExcel(f.url);
      if (csv) {
        textoEstructurado += `--- Contenido extraído de ${f.nombre} ---\n${csv}\n----------------------------------------\n`;
      }
    } else if (['RVT','DWG','SKP','IFC'].includes(f.tipo.toUpperCase())) {
      textoEstructurado += `  *(Modelo BIM. Evaluar vigencia según fecha ${dateStr} y peso ${sizeMB})*\n`;
    }
  } // <-- FIX: Cierra el for loop

  textoEstructurado += `
Tu tarea es proveer un análisis estructurado actuando como un Auditor Senior de Infraestructura y Obras Civiles en Colombia. 
Debes entregar la respuesta EXACTAMENTE en el formato solicitado, usando las etiquetas [TEXTO] y [JSON_DATA].

REGLAS DE AUDITORÍA MULTINORMA:
1. Documentos con prefijo MATRIZ_: Revisa al detalle la matriz Excel NTC 6047. ES OBLIGATORIO BUSCAR MEDIDAS explícitas (ej: puertas o pasadizos < 90cm). Si encuentras medidas < 90cm, reporta explícitamente el incumplimiento de la NTC 6047.
2. ${hasElectrico ? "Documentos con prefijo ELEC_: Revisar normatividad RETIE en detalle y mencionar si cumple." : "ALERTA LEGAL: Falta documentación para validar normatividad eléctrica (RETIE)."}
3. ${hasRedes ? "Documentos con prefijo DATA_: Revisar normatividad RITEL en detalle y mencionar si cumple." : "ALERTA LEGAL: Falta documentación para validar normatividad de telecomunicaciones (RITEL)."}
4. ${hasArquitectura ? "Documentos con prefijo ARQ_: Revisar normatividad NSR-10 (Títulos J, K y estructural)." : "ALERTA LEGAL: Falta documentación para validar normatividad NSR-10."}

FORMATO REQUERIDO:

[TEXTO]
(Redacta un Informe Técnico Profesional narrativo de 3 a 4 párrafos evaluando la NTC 6047, NSR-10, RETIE y RITEL según aplique comparando con los datos extraídos. Si falta documentación, incluye explícitamente el texto de ALERTA LEGAL indicado arriba. Cita las normas explícitamente. No uses comillas ni bloques de código.)

[JSON_DATA]
{
  "score_accesibilidad": XX,
  "score_infraestructura": YY,
  "color_sugerido": "#HEX",
  "radar_scores": {
    "Accesibilidad": 0,
    "Eléctrico": 0,
    "Redes": 0,
    "Estructura": 0,
    "Documentación": 0
  }
}
IMPORTANTE PARA EL JSON: Asigna valores numéricos reales (0-100) en todos los scores y en TODAS las 5 claves de \`radar_scores\`. El 'color_sugerido' DEBE SER: Verde (#10B981) si el promedio es > 85%, Amarillo (#F59E0B) si es 60-85%, y Rojo (#EF4444) si es < 60%.
`;

  parts.unshift(textoEstructurado); // Agregar el texto como primer parte

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    
    // Parse response robustly using [TEXTO] and [INICIO_DATOS]
    const parseResponse = (text) => {
      let narrative = text; // MUESTRA TODO EL TEXTO por defecto si el parser falla
      let jsonStr = "{}";

      const textIndex = text.indexOf('[TEXTO]');
      const dataIndex = text.indexOf('[JSON_DATA]');

      if (textIndex !== -1 && dataIndex !== -1 && textIndex < dataIndex) {
        narrative = text.substring(textIndex + '[TEXTO]'.length, dataIndex).trim();
        jsonStr = text.substring(dataIndex + '[JSON_DATA]'.length).trim();
      } else if (dataIndex !== -1) {
        narrative = text.substring(0, dataIndex).trim();
        jsonStr = text.substring(dataIndex + '[JSON_DATA]'.length).trim();
      }

      // Cleanup JSON string in case it has markdown ticks
      const jsonMatch = jsonStr.match(/```json\n([\s\S]*?)\n```/) || jsonStr.match(/```\n([\s\S]*?)\n```/);
      const cleanJsonStr = jsonMatch ? jsonMatch[1] : jsonStr;
      
      let parsedJson = {};
      try {
        parsedJson = JSON.parse(cleanJsonStr);
      } catch(e) {
        Logger.warn("Fallo al parsear JSON devuelto por Gemini:", e, cleanJsonStr);
      }
      // Aseguramos que el diagnóstico nunca salga vacío
      if (!narrative || narrative.trim() === '') {
        narrative = text; // Si falló al sacar el texto, devolvemos todo el raw
      }
      return { diagnostico_texto: narrative, ...parsedJson };
    };

    // Intento 1: Modelo más reciente (Gemini 2.5 Flash)
    try {
      const model = genAI.getGenerativeModel(
        { model: "gemini-2.5-flash" },
        { apiVersion: "v1" }
      );
      const result = await model.generateContent(parts);
      return parseResponse(result.response.text());
    } catch (e1) {
      Logger.warn("Gemini 2.5 Flash falló, intentando fallback a 1.5-flash-latest...", e1);
      
      // Intento 2: Fallback al modelo 1.5 Flash Latest
      const fallbackModel = genAI.getGenerativeModel(
        { model: "gemini-1.5-flash-latest" },
        { apiVersion: "v1" }
      );
      const result = await fallbackModel.generateContent(parts);
      return parseResponse(result.response.text());
    }
  } catch (error) {
    Logger.error("Gemini SDK Error Final:", error);
    throw new Error("Error procesando analítica predictiva. Revisa consola.");
  }
}

/**
 * Render Chart.js graphs based on Gemini JSON analytics
 */
function renderMantCharts(data) {
  const container = document.getElementById('mant-charts-container');
  if (!data || !data.radar_scores) {
    if (container) container.style.display = 'none';
    return;
  }
  if (container) container.style.display = 'block';

  const ctxRadar = document.getElementById('mant-chart-radar');
  if (chartDist) chartDist.destroy();
  if (ctxRadar) {
    chartDist = new Chart(ctxRadar, {
      type: 'radar',
      data: {
        labels: Object.keys(data.radar_scores),
        datasets: [{
          label: 'Score Técnico',
          data: Object.values(data.radar_scores),
          backgroundColor: 'rgba(16, 185, 129, 0.2)', // Green tinted for branding
          borderColor: 'rgba(16, 185, 129, 1)',
          pointBackgroundColor: 'rgba(16, 185, 129, 1)',
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: 'rgba(16, 185, 129, 1)'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            angleLines: { color: 'rgba(255, 255, 255, 0.1)' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' },
            pointLabels: { color: 'rgba(255, 255, 255, 0.8)', font: { size: 12, family: 'Inter' } },
            ticks: { display: false, min: 0, max: 100 }
          }
        },
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Evaluación Técnica de Infraestructura', color: 'rgba(255, 255, 255, 0.9)' }
        }
      }
    });
  }
}

/**
 * Render file context summary in the UI.
 */
function renderContextSummary(blockId) {
  const context = getContextForAI(blockId);

  if (context.files.length === 0) {
    contextSummary.style.display = 'none';
    return;
  }

  contextSummary.style.display = '';

  // Group by folder label
  const groups = {};
  context.files.forEach(f => {
    if (!groups[f.carpeta]) groups[f.carpeta] = [];
    groups[f.carpeta].push(f);
  });

  let html = '';
  Object.entries(groups).forEach(([label, files]) => {
    html += `<div class="mant-ctx-group">
      <span class="mant-ctx-label">${label}</span>
      <span class="mant-ctx-count">${files.length} archivo(s)</span>
    </div>`;
  });

  contextList.innerHTML = html;
}

const LOGO_ISER_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="; // Pega aquí el código base64 completo o ignóralo. El espacio se mantendrá.

/**
 * Generate PDF report using jsPDF.
 */
function generatePDF() {
  const fecha = new Date().toLocaleDateString('es-CO');
  
  try {
    if (typeof window.jspdf === 'undefined' && typeof window.jsPDF === 'undefined') {
      console.error('Librería jsPDF no cargada');
      alert('Error crítico: La librería jsPDF no ha sido cargada correctamente.');
      return;
    }

  // 1. CAPTURA DEL CANVAS 3D
  let imgData3D = null;
  try {
      const canvas3D = document.querySelector('#viewer-container canvas') || document.querySelector('canvas');
      if (canvas3D) {
          imgData3D = canvas3D.toDataURL('image/jpeg', 0.9);
      }
  } catch (e) {
      Logger.warn("No se pudo extraer el Canvas 3D. Usando fallback.", e);
      imgData3D = null;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  // Usar exclusivamente el ID del bloque del estado (Evita capturar 'admin' accidentalmente)
  const blockId = state.currentBlockId || 'bloque-desconocido';
  
  const campusData = getCampusData() || {};
  const blockName = campusData?.[blockId]?.name || blockId || 'Nombre no disponible';
  const blockInfo = campusData?.[blockId]?.info || {};
  const context = getContextForAI(blockId) || { files: [] };
  const estadoData = state.estadosBloques?.[blockId] || {};
  
  const marginX = 20;
  const maxWidth = 170;
  const maxPageY = 270;
  
  // ── Header & Logo ──
  if (LOGO_ISER_BASE64) doc.addImage(LOGO_ISER_BASE64, 'PNG', 20, 15, 35, 15);

  doc.setTextColor(46, 125, 50); // ISER Green
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Instituto Superior de Educación Rural', marginX + 40, 20);
  doc.text('Informe de Gestión y Cumplimiento', marginX + 40, 26);

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Fecha de generación: ' + fecha, marginX + 40, 32);

  let currentY = 45;

  // ── Resumen Inicial Sombreado ──
  doc.setFillColor(245, 245, 245);
  doc.rect(marginX, currentY, maxWidth, 25, 'F');
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`RESUMEN TÉCNICO - ${blockName.toUpperCase()}`, marginX + 5, currentY + 7);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const scoreBadge = estadoData.score_infraestructura ? `${estadoData.score_infraestructura}%` : 'N/A';
  doc.text(`Área: ${blockInfo.area || '--'} m²`, marginX + 5, currentY + 14);
  doc.text(`Sistema Constructivo: ${blockInfo.construction || '--'}`, marginX + 70, currentY + 14);
  doc.text(`Recintos: ${blockInfo.rooms || '--'}`, marginX + 5, currentY + 20);
  
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(46, 125, 50);
  doc.text(`Score Global Normativo: ${scoreBadge}`, marginX + 70, currentY + 20);

  currentY += 35;

  // ── INYECCIÓN EN EL PDF (jsPDF) - Fotografía del modelo 3D ──
  if (imgData3D) {
    const snapWidth = 100;
    const snapHeight = 60;
    const snapX = (210 - snapWidth) / 2;
    doc.addImage(imgData3D, 'JPEG', snapX, currentY, snapWidth, snapHeight);
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.rect(snapX, currentY, snapWidth, snapHeight);
    currentY += snapHeight + 10;
  }

  // ── Diagnóstico ──
  if (currentY > maxPageY) { doc.addPage(); currentY = 20; }

  doc.setTextColor(46, 125, 50);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Desarrollo del Análisis Normativo', marginX, currentY);
  currentY += 8;

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const diagText = estadoData.diagnostico_texto || 'Sin diagnóstico generado. Ejecute la auditoría de IA.';
  const diagLines = diagText.split('\n');
  const splitDiag = doc.splitTextToSize(diagLines, maxWidth);
  // Interlineado base = 1.2 in jsPDF is often just standard rendering with spacing if we use lines spacing or draw line by line, splitTextToSize uses normal spacing which is close to 1.15.
  doc.text(splitDiag, marginX, currentY);
  currentY += (splitDiag.length * 5) + 8;

  // ── Detalle Normativo ──
  if (estadoData.normas && typeof doc.autoTable === 'function') {
    Object.entries(estadoData.normas).forEach(([norma, data]) => {
      if (currentY + 25 > maxPageY) { doc.addPage(); currentY = 20; }
      
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      
      const normaLimpia = norma.replace(/[%!&🛡️⚠️]/g, '').trim();
      doc.text('NORMA: ' + normaLimpia + ' (PUNTAJE: ' + (data.puntaje || 0) + ')', marginX, currentY);
      
      let detectadosStr = (data.encontrados || []).length ? data.encontrados.join('\n') : 'Ninguno';
      let faltantesStr = (data.faltantes_criticos || []).length ? data.faltantes_criticos.join('\n') : 'Ninguno';
      
      detectadosStr = detectadosStr.replace(/[%!&🛡️⚠️]/g, '');
      faltantesStr = faltantesStr.replace(/[%!&🛡️⚠️]/g, '');

      doc.autoTable({
        startY: currentY + 4,
        head: [['ESTADO OK', 'FALTANTES CRITICOS']],
        body: [[detectadosStr, faltantesStr]],
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 3, font: 'helvetica' },
        headStyles: { fontStyle: 'bold', textColor: [30, 30, 30] },
        columnStyles: {
          0: { textColor: [21, 128, 61], cellWidth: maxWidth / 2 },
          1: { textColor: [220, 38, 38], cellWidth: maxWidth / 2 }
        },
        margin: { left: marginX, right: marginX }
      });
      currentY = doc.lastAutoTable.finalY + 10;
    });
  } else if (!estadoData.normas) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('No hay datos normativos detallados disponibles.', marginX, currentY);
    currentY += 10;
  }

  // ── Plan de Acción (Tareas Pendientes) ──
  if (estadoData.tareas_pendientes && estadoData.tareas_pendientes.length > 0 && typeof doc.autoTable === 'function') {
    if (currentY + 30 > maxPageY) { doc.addPage(); currentY = 20; }
    
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(46, 125, 50);
    doc.text('Plan de Acción Priorizado', marginX, currentY);
    
    const bodyTareas = estadoData.tareas_pendientes.map(t => [t.prioridad, t.descripcion]);
    doc.autoTable({
      startY: currentY + 6,
      head: [['Prioridad', 'Descripción de la Tarea']],
      body: bodyTareas,
      styles: { fontSize: 10, cellPadding: 4, font: 'helvetica' },
      headStyles: { fillColor: [46, 125, 50], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 248, 240] },
      margin: { left: marginX, right: marginX }
    });
    currentY = doc.lastAutoTable.finalY + 15;
  } else if (estadoData.tareas_pendientes && estadoData.tareas_pendientes.length > 0) {
    // Fallback if autotable plugin fails
    doc.setFontSize(10);
    doc.text('Tareas pendientes registradas, pero falta AutoTable plugin para renderizar.', marginX, currentY + 10);
    currentY += 15;
  }

  // ── File Table (Summary Format) ──
  if (context.files.length > 0) {
    let tableY = currentY + 10;
    if (tableY + 30 > maxPageY) {
      doc.addPage();
      tableY = 20;
    }

    const folderGroups = {};
    context.files.forEach(f => {
      if (!folderGroups[f.carpeta]) folderGroups[f.carpeta] = [];
      folderGroups[f.carpeta].push(f);
    });

    const tableData = [];
    Object.entries(folderGroups).forEach(([folder, files]) => {
      const count = files.length;
      if (count < 5) {
        tableData.push([{ content: folder, rowSpan: count }, files[0].nombre, 'Disponible']);
        for (let i = 1; i < count; i++) {
          tableData.push([files[i].nombre, 'Disponible']);
        }
      } else {
        tableData.push([folder, `${count} archivo(s) en total`, 'Completo']);
      }
    });

    doc.autoTable({
      startY: tableY,
      head: [['Categoría / Carpeta', 'Documentación Detectada', 'Estado']],
      body: tableData,
      styles: { fontSize: 10, cellPadding: 4, font: 'helvetica' },
      headStyles: { fillColor: [46, 125, 50], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 248, 240] },
      margin: { left: marginX, right: marginX }
    });
  }

  // ── Sign Off ──
  if (typeof doc.lastAutoTable !== 'undefined' && doc.lastAutoTable !== null && doc.lastAutoTable.finalY) {
    currentY = doc.lastAutoTable.finalY + 15;
  }

  if (currentY > 260) { 
    doc.addPage(); 
    currentY = 20; 
  } else {
    currentY += 15; // Padding extra para alejar del contenido anterior
  }
  
  const sigWidth = 70;
  const sigX = 210 - marginX - sigWidth;
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.setLineDash([2, 2], 0);
  doc.line(sigX, currentY, sigX + sigWidth, currentY);
  doc.setLineDash([]); // Reset dash pattern
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('Arq. Pedro Johan Trillos Pérez', 210 - marginX, currentY + 6, { align: 'right' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Docente ISER', 210 - marginX, currentY + 11, { align: 'right' });

  // ── Footer ──
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(
      `ISER-Geovisor CDE Institucional | Página ${i} de ${pageCount}`,
      105, 287,
      { align: 'center' }
    );
  }

    doc.save(`Reporte_Auditoria_Tecnica_${blockId}.pdf`);
  } catch (error) {
    console.error("Error al exportar PDF:", error);
    alert("Hubo un error al generar el PDF. Verifica la consola para más detalles.");
  }
}

/**
 * Initialize the Mantenimiento module.
 */
function initMantenimiento() {
  formEl = document.getElementById('mant-form');
  bloqueSelect = document.getElementById('mant-bloque');
  estadoSelect = document.getElementById('mant-estado');
  fechaInput = document.getElementById('mant-fecha');
  diagnosticoArea = document.getElementById('mant-diagnostico');
  recomendacionesArea = document.getElementById('mant-recomendaciones');
  btnIA = document.getElementById('mant-btn-ia');
  btnPDF = document.getElementById('mant-btn-pdf');
  spinnerOverlay = document.getElementById('mant-spinner-overlay');
  contextSummary = document.getElementById('mant-context-summary');
  contextList = document.getElementById('mant-context-list');

  if (!bloqueSelect) return;

  try {
    // Populate block selector from campus data
    const campusData = getCampusData();
    if (campusData && Object.keys(campusData).length > 0) {
      Object.entries(campusData).forEach(([id, data]) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = data.name || id;
        bloqueSelect.appendChild(opt);
      });
    } else {
      const opt = document.createElement('option');
      opt.textContent = "Error: campusData está vacío";
      bloqueSelect.appendChild(opt);
    }
  } catch (err) {
    Logger.error("Error poblando bloques en Mantenimiento:", err);
    bloqueSelect.innerHTML = `<option value="">Error interno: ${err.message}</option>`;
  }

  // Set today's date as default
  if (fechaInput) {
    fechaInput.value = new Date().toISOString().slice(0, 10);
  }

  // ── Block selection change ──
  bloqueSelect.addEventListener('change', () => {
    const blockId = bloqueSelect.value;
    const hasBlock = !!blockId;
    btnIA.disabled = !hasBlock;
    btnPDF.disabled = !hasBlock;
    diagnosticoArea.value = '';

    // FORCE MAP CENTER (Reverse Sync)
    if (hasBlock && state.currentBlockId !== blockId) {
      setCurrentBlock(blockId);
    }

    if (hasBlock) {
      renderContextSummary(blockId);

      const existingState = state.estadosBloques?.[blockId];
      if (existingState) {
        diagnosticoArea.value = existingState.diagnostico_texto || '';
        renderMantCharts({ radar_scores: existingState.radar_scores });

        // Sincronización en el Dashboard
        const dashTextContainer = document.getElementById('audit-resumen');
        if (dashTextContainer) {
          const textoLimpiado = (existingState.diagnostico_texto || "Sin datos de auditoría.").replace(/[%!&🛡️⚠️]/g, '');
          dashTextContainer.innerHTML = textoLimpiado;
          dashTextContainer.style.overflowY = 'auto';
          dashTextContainer.style.maxHeight = '250px';
          dashTextContainer.style.paddingRight = '8px';
          dashTextContainer.style.textAlign = 'justify';
        }
      } else {
        renderMantCharts(null);
        const dashTextContainer = document.getElementById('audit-resumen');
        if (dashTextContainer) dashTextContainer.innerHTML = 'Sin datos de auditoría.';
      }
    } else {
      contextSummary.style.display = 'none';
      renderMantCharts(null); // Clear charts on change
    }
  });

  // Sync with global block selection
  on(EVENTS.BLOCK_SELECTED, (id) => {
    if (bloqueSelect && id && bloqueSelect.value !== id) {
      bloqueSelect.value = id;
      bloqueSelect.dispatchEvent(new Event('change'));
    }
  });

  // Real-time updates from Firestore
  on('ESTADOS_BLOQUES_CHANGED', () => {
    if (bloqueSelect && bloqueSelect.value) {
      bloqueSelect.dispatchEvent(new Event('change'));
    }
  });

  // ── Generate AI Diagnosis ──
  document.addEventListener('click', async (e) => {
    const targetBtnIA = e.target.closest('#mant-btn-ia');
    if (!targetBtnIA) return;
    e.preventDefault();

    // Re-query in case the DOM was rebuilt
    const currentBloqueSelect = document.getElementById('mant-bloque');
    const currentDiagnosticoArea = document.getElementById('mant-diagnostico');
    const currentSpinnerOverlay = document.getElementById('mant-spinner-overlay');

    const blockId = currentBloqueSelect ? currentBloqueSelect.value : null;
    if (!blockId) return;

    if (!GEMINI_API_KEY) {
      alert("Atención: Debes configurar la API_KEY de Gemini en mantenimiento.js para generar sugerencias reales.");
      return;
    }

    if (currentSpinnerOverlay) currentSpinnerOverlay.style.display = 'flex';
    targetBtnIA.disabled = true;
    targetBtnIA.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Analizando con IA...';
    
    // UI Feedback requested by user
    if (currentDiagnosticoArea) {
      currentDiagnosticoArea.value = "⏳ Analizando documentos bajo NSR-10, RETIE y NTC 6047... Por favor, espera.";
    }

    try {
      const context = getContextForAI(blockId);
      const diagnosisData = await generateAIDiagnosis(blockId, context);
      
      if (currentDiagnosticoArea) {
        currentDiagnosticoArea.value = diagnosisData.diagnostico_texto || "No se generó texto de diagnóstico.";
      }
      
      // Sincronización de Diagnóstico en Dashboard (Regla de Oro)
      const dashTextContainer = document.getElementById('audit-resumen');
      if (dashTextContainer) {
        const textoLimpiado = (diagnosisData.diagnostico_texto || "No se generó texto.").replace(/[%!&🛡️⚠️]/g, '');
        dashTextContainer.innerHTML = textoLimpiado;
        dashTextContainer.style.overflowY = 'auto';
        dashTextContainer.style.maxHeight = '250px';
        dashTextContainer.style.paddingRight = '8px';
        dashTextContainer.style.textAlign = 'justify';
      }

      renderMantCharts(diagnosisData);

      // Guardar el estado y color en Firestore
      try {
        await guardarEstadoBloque(blockId, {
          diagnostico_texto: diagnosisData.diagnostico_texto || "No se generó texto de diagnóstico.",
          score_accesibilidad: diagnosisData.score_accesibilidad,
          score_infraestructura: diagnosisData.score_infraestructura,
          color_sugerido: diagnosisData.color_sugerido,
          radar_scores: diagnosisData.radar_scores,
          timestamp: Date.now()
        });
        Logger.info("Estado de bloque sincronizado en Firestore correctamente.");
      } catch (err) {
        Logger.error("No se pudo guardar el estado en Firestore:", err);
      }
    } catch (errApi) {
      Logger.error("Gemini Execution Error:", errApi);
      // Explicit error rendering requested
      if (currentDiagnosticoArea) {
        currentDiagnosticoArea.value = "Error de conexión con la IA: " + (errApi.message || "Fallo desconocido.");
      }
    } finally {
      if (currentSpinnerOverlay) currentSpinnerOverlay.style.display = 'none';
      const spinnerText = document.querySelector('.mant-spinner-text');
      if (spinnerText) spinnerText.textContent = "Analizando planos y fotografías del bloque...";
      targetBtnIA.innerHTML = '<i class="ph ph-robot"></i> Generar Diagnóstico con IA';
    }
  });

  Logger.info('Módulo de Mantenimiento inicializado.');
}

// Global event listener for PDF generation (Event Delegation as requested)
document.addEventListener('click', (e) => {
  if (e.target.closest('#btn-generate-pdf')) {
    const blockId = state.currentBlockId;
    
    if (!blockId || blockId === 'admin' || blockId === 'visitor') {
      alert("Por favor, selecciona un bloque en el mapa antes de generar el reporte.");
      return;
    }
    
    console.log("Iniciando exportación para:", blockId);
    generatePDF();
  }
});

// Global exposure as requested by user to avoid Export Syntax Errors
window.initMantenimiento = initMantenimiento;
