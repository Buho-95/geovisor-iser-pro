/**
 * Subida de archivos a Supabase Storage y registro en base de datos.
 * Integrado con FileManager mejorado - Drag & Drop, Vista Previa, Organización Inteligente
 */
import { dbPath, storageBasePath } from './core/config.js';
import { state } from './core/state.js';
import { isAdmin } from './services/auth.js';
import { getFileManager } from './file-manager.js';
import { estructuraPlanimetriaISER, formatearNombreCarpeta } from './planoteca-structure.js';
import { isStaging } from './core/env.js';
import { buildStoragePath, validateStoragePath, isJerarquiaPorSedeActiva } from './core/storage-routing.js';
import { resolveBloqueCanonical } from './core/structure-schema.js';
import { logUploadPath, logUploadDone } from './modules/diagnostics.js';

let folderCascadeInitialized = false;

function setSelectOptions(selectEl, options, placeholder) {
  if (!selectEl) return;
  const placeholderHtml = placeholder ? `<option value="">${placeholder}</option>` : '';
  selectEl.innerHTML = placeholderHtml + options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
}

function validateTipoVsExtension(file, tipoSeleccionado) {
  if (!tipoSeleccionado || tipoSeleccionado === 'otro') return;
  const name = file.name.toLowerCase();
  const extMap = {
    pdf: ['.pdf'],
    dwg: ['.dwg', '.dxf'],
    skp: ['.skp'],
    rvt: ['.rvt'],
    ifc: ['.ifc'],
    excel: ['.xlsx', '.xls'],
    img: ['.jpg', '.jpeg', '.png', '.gif']
  };
  const allowed = extMap[tipoSeleccionado];
  if (!allowed) return;
  const ok = allowed.some(ext => name.endsWith(ext));
  if (!ok) {
    throw new Error(`El archivo ${file.name} no coincide con el tipo seleccionado (${tipoSeleccionado}).`);
  }
}

function setSelectDisabled(selectEl, disabled) {
  if (!selectEl) return;
  selectEl.disabled = disabled;
  if (disabled) selectEl.value = '';
}

function updateHiddenFolderPath() {
  const l1 = document.getElementById('up-folder-l1')?.value || '';
  const l2 = document.getElementById('up-folder-l2')?.value || '';
  const l3 = document.getElementById('up-folder-l3')?.value || '';
  const hidden = document.getElementById('up-folder');
  if (!hidden) return;

  const parts = [];
  if (l1) parts.push(l1);
  if (l2 && l2 !== '__directo__') parts.push(l2);
  if (l3) parts.push(l3);
  hidden.value = parts.join('/');

  // Enable/disable drop zone based on folder selection
  const dropZone = document.getElementById('drop-zone');
  if (dropZone) {
    if (parts.length > 0 && l1) {
      dropZone.classList.remove('disabled');
    } else {
      dropZone.classList.add('disabled');
    }
  }
}

function setupFolderCascade() {
  const selectL1 = document.getElementById('up-folder-l1');
  const selectL2 = document.getElementById('up-folder-l2');
  const selectL3 = document.getElementById('up-folder-l3');

  if (!selectL1 || !selectL2 || !selectL3) return;

  const selectL1Value = selectL1.value;
  const selectL2Value = selectL2.value;
  const selectL3Value = selectL3.value;

  const l1Options = Object.keys(estructuraPlanimetriaISER).map(k => ({
    value: k,
    label: formatearNombreCarpeta(k)
  }));

  setSelectOptions(selectL1, l1Options, 'Selecciona una carpeta...');
  setSelectOptions(selectL2, [], 'Selecciona una opción...');
  setSelectOptions(selectL3, [], 'Selecciona una opción...');
  setSelectDisabled(selectL2, true);
  setSelectDisabled(selectL3, true);
  updateHiddenFolderPath();

  function onChangeL1() {
    const l1 = selectL1.value;
    setSelectOptions(selectL2, [], 'Selecciona una opción...');
    setSelectOptions(selectL3, [], 'Selecciona una opción...');
    setSelectDisabled(selectL2, true);
    setSelectDisabled(selectL3, true);

    if (!l1 || !estructuraPlanimetriaISER[l1]) {
      updateHiddenFolderPath();
      return;
    }

    const def = estructuraPlanimetriaISER[l1];
    if (def.tipo === 'directo') {
      updateHiddenFolderPath();
      return;
    }

    if (def.especialidades) {
      const l2Options = Object.keys(def.especialidades).map(k => ({
        value: k,
        label: formatearNombreCarpeta(k)
      }));
      setSelectOptions(selectL2, l2Options, 'Selecciona una especialidad...');
      setSelectDisabled(selectL2, false);
      updateHiddenFolderPath();
      return;
    }

    if (def.subcarpetas) {
      setSelectOptions(selectL2, [{ value: '__directo__', label: 'General' }], 'Selecciona una opción...');
      setSelectDisabled(selectL2, false);
      const l3Options = def.subcarpetas.map(s => ({
        value: s,
        label: formatearNombreCarpeta(s)
      }));
      setSelectOptions(selectL3, l3Options, 'Selecciona una subcarpeta...');
      setSelectDisabled(selectL3, false);
      updateHiddenFolderPath();
    }
  }

  function onChangeL2() {
    const l1 = selectL1.value;
    const l2 = selectL2.value;
    setSelectOptions(selectL3, [], 'Selecciona una opción...');
    setSelectDisabled(selectL3, true);

    if (!l1 || !estructuraPlanimetriaISER[l1]) {
      updateHiddenFolderPath();
      return;
    }

    const def = estructuraPlanimetriaISER[l1];
    if (!def.especialidades) {
      updateHiddenFolderPath();
      return;
    }

    if (!l2 || !Object.prototype.hasOwnProperty.call(def.especialidades, l2)) {
      updateHiddenFolderPath();
      return;
    }

    const subcarpetas = def.especialidades[l2];
    if (Array.isArray(subcarpetas) && subcarpetas.length > 0) {
      const l3Options = subcarpetas.map(s => ({ value: s, label: formatearNombreCarpeta(s) }));
      setSelectOptions(selectL3, l3Options, 'Selecciona una subcarpeta...');
      setSelectDisabled(selectL3, false);
    }

    updateHiddenFolderPath();
  }

  if (!folderCascadeInitialized) {
    selectL1.addEventListener('change', onChangeL1);
    selectL2.addEventListener('change', onChangeL2);
    selectL3.addEventListener('change', updateHiddenFolderPath);
    folderCascadeInitialized = true;
  }

  if (selectL1Value) {
    selectL1.value = selectL1Value;
    onChangeL1();
    if (selectL2Value) {
      selectL2.value = selectL2Value;
      onChangeL2();
      if (selectL3Value) {
        selectL3.value = selectL3Value;
        updateHiddenFolderPath();
      }
    }
  }
}

function resetUploadUI() {
  const btnSubmit = document.getElementById('btn-submit-upload');
  const progressContainer = document.getElementById('upload-progress-container');
  const progressBar = document.getElementById('upload-progress-bar');
  const progressText = document.getElementById('upload-percentage');
  btnSubmit.disabled = false;
  btnSubmit.innerHTML = '<i class="ph ph-cloud-arrow-up mr-1"></i> Subir Archivo al Servidor';
  progressContainer.classList.add('hidden');
  progressBar.style.width = '0%';
  progressText.innerText = '0%';
  document.getElementById('upload-status-text').innerText = 'Subiendo archivo pesado...';

  const selectL1 = document.getElementById('up-folder-l1');
  const selectL2 = document.getElementById('up-folder-l2');
  const selectL3 = document.getElementById('up-folder-l3');
  if (selectL1) selectL1.value = '';
  if (selectL2) {
    selectL2.value = '';
    selectL2.disabled = true;
  }
  if (selectL3) {
    selectL3.value = '';
    selectL3.disabled = true;
  }
  const hidden = document.getElementById('up-folder');
  if (hidden) hidden.value = '';

  // Limpiar selección de archivos
  const fileManager = getFileManager();
  if (fileManager) {
    fileManager.clearSelection();
  }
}

/**
 * Configura el modal de subida y el envío del formulario.
 */
export function setupUpload() {
  setupFolderCascade();

  document.getElementById('btn-open-upload').addEventListener('click', () => {
    // Guard: require a block to be selected before opening upload
    if (!state.currentBlockId) {
      // Show notification using FileManager if available, otherwise inline toast
      const fm = getFileManager();
      if (fm) {
        fm.showNotification('Por favor, selecciona un bloque en el mapa primero', 'warning');
      } else {
        alert('Por favor, selecciona un bloque en el mapa primero');
      }
      return;
    }

    setupFolderCascade();

    document.getElementById('upload-modal').classList.add('activo');
  });

  document.getElementById('btn-cerrar-upload').addEventListener('click', () => {
    document.getElementById('upload-modal').classList.remove('activo');
    resetUploadUI();
  });

  document.getElementById('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.user || !state.currentBlockId || !isAdmin()) return;

    const fileManager = getFileManager();
    const selectedFiles = fileManager ? fileManager.getSelectedFiles() : [];

    if (selectedFiles.length === 0) {
      fileManager?.showNotification('Por favor selecciona al menos un archivo', 'error');
      return;
    }

    const btnSubmit = document.getElementById('btn-submit-upload');
    const progressContainer = document.getElementById('upload-progress-container');
    const progressBar = document.getElementById('upload-progress-bar');
    const progressText = document.getElementById('upload-percentage');

    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Subiendo al servidor...';
    progressContainer.classList.remove('hidden');

    // Auto-detect file type from extension (no manual type selector)
    const carpeta = document.getElementById('up-folder').value;

    if (!carpeta) {
      fileManager?.showNotification('Selecciona una ubicación válida (carpeta/subcarpeta).', 'error');
      resetUploadUI();
      return;
    }

    try {
      // Subir archivos con tipo auto-detectado
      const uploadPromises = selectedFiles.map((file, index) => {
        const autoType = detectFileType(file);
        return uploadSingleFile(file, autoType, carpeta, index, selectedFiles.length);
      });

      const results = await Promise.all(uploadPromises);

      // Verificar si todos se subieron correctamente
      const successfulUploads = results.filter(r => r.success);
      const failedUploads = results.filter(r => !r.success);

      if (successfulUploads.length > 0) {
        const message = successfulUploads.length === 1
          ? '¡Documento subido con éxito!'
          : `¡${successfulUploads.length} documentos subidos con éxito!`;

        fileManager?.showNotification(message, 'success');

        // Emisión única del evento (bootstrap ya lo escucha para invalidar
        // caches del dashboard y re-renderizar). El listener es idempotente,
        // así que emitimos 1 sola vez por batch.
        try {
          window.dispatchEvent(new CustomEvent('geovisor:file-uploaded', {
            detail: {
              count: successfulUploads.length,
              failed: failedUploads.length,
              carpeta,
              sedeId: state?.currentSede || null,
              bloqueId: state?.currentBlockId || null,
              files: successfulUploads.map(r => r.fileName),
            },
          }));
        } catch { /* noop */ }

        // Limpiar formulario solo si todos fueron exitosos
        if (failedUploads.length === 0) {
          document.getElementById('upload-form').reset();
          // NOTA: el cierre del modal (classList.remove 'activo') lo hace
          // ahora el módulo upload-modal-enhance.js tras mostrar el estado
          // de éxito, para dar feedback visual y auto-cerrar en 1.5 s.
          // Si el enhancer no está cargado, el listener legacy de abajo
          // se queda dormido y el modal se cierra al siguiente click.
        }
      }

      if (failedUploads.length > 0) {
        fileManager?.showNotification(`${failedUploads.length} archivo(s) no pudieron subirse`, 'error');
        try {
          window.dispatchEvent(new CustomEvent('geovisor:file-upload-error', {
            detail: {
              failed: failedUploads.length,
              success: successfulUploads.length,
              files: failedUploads.map(r => r.fileName),
              message: 'No se pudieron subir todos los archivos. Revisa tu conexión.',
            },
          }));
        } catch { /* noop */ }
      }

    } catch (error) {
      console.error('Error en proceso de subida:', error);
      fileManager?.showNotification('Hubo un problema al subir. Revisa tu conexión a internet.', 'error');
      try {
        window.dispatchEvent(new CustomEvent('geovisor:file-upload-error', {
          detail: { error: String(error?.message || error), message: 'Hubo un problema al subir. Revisa tu conexión.' },
        }));
      } catch { /* noop */ }
    } finally {
      resetUploadUI();
    }
  });
}

/**
 * Sube un archivo individual al servidor (Supabase)
 */
async function uploadSingleFile(file, tipoArchivo, carpeta, index, totalFiles) {
  const { uploadToSupabaseStorage, getSupabaseClient } = await import('./services/supabase.js');
  let fileName = file.name;

  // Igual prefijado que en Firebase
  if (carpeta) {
    let prefix = '';
    const upperCarpeta = carpeta.toUpperCase();
    if (upperCarpeta.includes('ELECTRICOS')) prefix = 'ELEC_';
    else if (upperCarpeta.includes('REDES_DE_DATOS')) prefix = 'DATA_';
    else if (upperCarpeta.includes('ACCESIBILIDAD_NTC_6047')) prefix = 'MATRIZ_';
    else if (upperCarpeta.includes('ARQUITECTONICO') || upperCarpeta.includes('ESTRUCTURAL')) prefix = 'ARQ_';
    if (prefix && !fileName.toUpperCase().startsWith(prefix)) fileName = prefix + fileName;
  }

  const sedeId = state?.currentSede || 'pamplona';
  const bloqueId = state?.currentBlockId || 'sin_bloque';
  // Ruta: sedes/{sede}/{bloque}/{carpeta}/{archivo}
  const rutaStorage = `sedes/${sedeId}/${bloqueId}/${carpeta}/${fileName}`;

  logUploadPath(rutaStorage, { sedeId, bloqueId: state?.currentBlockId, carpeta, fileName, tipoArchivo, isStaging });

  const progressBar = document.getElementById('upload-progress-bar');
  const progressText = document.getElementById('upload-percentage');
  const statusText = document.getElementById('upload-status-text');
  if (statusText) statusText.innerText = totalFiles === 1 ? `Subiendo ${fileName}...` : `Subiendo archivo ${index + 1} de ${totalFiles}...`;

  try {
    const { url: urlDescarga, storagePath } = await uploadToSupabaseStorage(
      rutaStorage,
      file,
      (pct) => {
        if (progressBar) progressBar.style.width = pct + '%';
        if (progressText) progressText.innerText = Math.round(pct) + '%';
      }
    );

    const [disciplinaRaw, ...subRest] = String(carpeta || '').split('/').filter(Boolean);
    const subcarpetaRaw = subRest.join('/') || null;
    const anioMatch = fileName.match(/(20\d{2})/);
    const anio = anioMatch ? parseInt(anioMatch[1], 10) : null;

    // Registrar en la tabla archivos_iser de Supabase
    const sb = getSupabaseClient();
    const docId = `${bloqueId}_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { error: dbErr } = await sb.from('archivos_iser').upsert({
      id: docId,
      bloque: bloqueId,
      sede: sedeId,
      nombre: fileName,
      tipo: tipoArchivo,
      carpeta,
      url: urlDescarga,
      storage_path: rutaStorage,
      fecha_creacion: new Date().toISOString(),
      subido_por: state.user?.email || 'desconocido',
      tamanio: file.size,
      tipo_mime: file.type,
      ia: {
        disciplina: disciplinaRaw || null,
        subcarpeta: subcarpetaRaw,
        tipoArchivo,
        anio,
        entorno: isStaging ? 'staging' : 'production',
        schemaVersion: '1.0.0',
      },
    });

    if (dbErr) throw new Error(dbErr.message);

    logUploadDone(rutaStorage, { fileName, sedeId, bloqueId });
    return { success: true, fileName };
  } catch (error) {
    console.error('Error subiendo a Supabase:', error);
    return { success: false, error, fileName };
  }
}

/**
/**
 * Valida y prepara archivos para subida múltiple
 */
function validateFiles(files) {
  const validFiles = [];
  const maxSize = 50 * 1024 * 1024; // 50MB por archivo
  const maxTotalSize = 500 * 1024 * 1024; // 500MB total
  const maxFiles = 10; // Máximo 10 archivos por vez

  let totalSize = 0;

  for (const file of files) {
    // Validar tamaño individual
    if (file.size > maxSize) {
      throw new Error(`El archivo ${file.name} excede el tamaño máximo de 50MB`);
    }

    totalSize += file.size;

    // Validar tamaño total
    if (totalSize > maxTotalSize) {
      throw new Error('El tamaño total de los archivos excede el máximo de 500MB');
    }

    validFiles.push(file);
  }

  // Validar cantidad de archivos
  if (validFiles.length > maxFiles) {
    throw new Error(`No se pueden subir más de ${maxFiles} archivos a la vez`);
  }

  return validFiles;
}

/**
 * Detecta automáticamente el tipo de archivo basado en el nombre y MIME
 */
function detectFileType(file) {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  // PDF
  if (type.includes('pdf') || name.endsWith('.pdf')) return 'pdf';

  // AutoCAD
  if (type.includes('dwg') || name.endsWith('.dwg') ||
    type.includes('dxf') || name.endsWith('.dxf')) return 'dwg';

  // SketchUp
  if (type.includes('skp') || name.endsWith('.skp')) return 'skp';

  // Revit
  if (type.includes('rvt') || name.endsWith('.rvt')) return 'rvt';

  // IFC
  if (type.includes('ifc') || name.endsWith('.ifc')) return 'ifc';

  // 3D Models (GLB/GLTF)
  if (name.endsWith('.glb') || name.endsWith('.gltf') ||
    type.includes('model/gltf')) return 'glb';

  // Excel
  if (type.includes('excel') || type.includes('spreadsheet') ||
    name.endsWith('.xlsx') || name.endsWith('.xls')) return 'excel';

  // CSV
  if (type.includes('csv') || name.endsWith('.csv')) return 'csv';

  // Imágenes
  if (type.includes('image') ||
    name.endsWith('.jpg') || name.endsWith('.jpeg') ||
    name.endsWith('.png') || name.endsWith('.gif')) return 'img';

  return 'otro';
}

/**
 * Formatea el tamaño del archivo para mostrar
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Muestra una notificación de progreso
 */
function showProgressNotification(current, total, fileName) {
  const fileManager = getFileManager();
  if (fileManager) {
    fileManager.showNotification(`Subiendo ${fileName} (${current}/${total})`, 'info');
  }
}
