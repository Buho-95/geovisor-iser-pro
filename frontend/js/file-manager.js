/**
 * Gestor de Archivos Mejorado - Drag & Drop, Vista Previa Avanzada, Organización Inteligente
 * Aplicando skills de Design System, UX Profesional y Microinteracciones
 */
import { state } from './core/state.js';
import { emit, EVENTS } from './core/events.js';

class FileManager {
  constructor() {
    this.dropZone = null;
    this.fileInput = null;
    this.previewContainer = null;
    this.previewList = null;
    this.selectedFiles = [];
    this.dragCounter = 0;

    this.init();
  }

  /**
   * Inicializa el gestor de archivos
   */
  init() {
    this.setupElements();
    this.setupDragAndDrop();
    this.setupFileInput();
    this.setupPreviewActions();
  }

  /**
   * Configura los elementos del DOM
   */
  setupElements() {
    this.dropZone = document.getElementById('drop-zone');
    this.fileInput = document.getElementById('up-file');
    this.previewContainer = document.getElementById('file-preview');
    this.previewList = document.getElementById('preview-list');
  }

  /**
   * Configura el sistema de Drag & Drop con feedback visual profesional
   */
  setupDragAndDrop() {
    if (!this.dropZone) return;

    // Prevenir comportamiento por defecto
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      this.dropZone.addEventListener(eventName, this.preventDefaults, false);
      document.body.addEventListener(eventName, this.preventDefaults, false);
    });

    // Highlight visual al arrastrar
    ['dragenter', 'dragover'].forEach(eventName => {
      this.dropZone.addEventListener(eventName, () => this.highlight(), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      this.dropZone.addEventListener(eventName, () => this.unhighlight(), false);
    });

    // Manejar drop de archivos
    this.dropZone.addEventListener('drop', (e) => this.handleDrop(e), false);

    // Click para seleccionar archivos
    this.dropZone.addEventListener('click', () => {
      this.fileInput.click();
    });
  }

  /**
   * Configura el input de archivos
   */
  setupFileInput() {
    if (!this.fileInput) return;

    this.fileInput.addEventListener('change', (e) => {
      this.handleFiles(e.target.files);
    });
  }

  /**
   * Configura las acciones de la vista previa
   */
  setupPreviewActions() {
    if (!this.previewList) return;

    // Event delegation para eliminar archivos
    this.previewList.addEventListener('click', (e) => {
      if (e.target.classList.contains('file-preview-remove')) {
        const index = parseInt(e.target.dataset.index);
        this.removeFile(index);
      }
    });
  }

  /**
   * Previene el comportamiento por defecto de los eventos drag
   */
  preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  /**
   * Aplica highlight visual cuando se arrastra sobre la zona
   */
  highlight() {
    this.dragCounter++;
    this.dropZone.classList.add('drag-over');
  }

  /**
   * Remueve highlight visual
   */
  unhighlight() {
    this.dragCounter--;
    if (this.dragCounter === 0) {
      this.dropZone.classList.remove('drag-over');
    }
  }

  /**
   * Maneja el drop de archivos
   */
  handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    this.handleFiles(files);
  }

  /**
   * Procesa los archivos seleccionados
   */
  handleFiles(files) {
    const validFiles = Array.from(files).filter(file => this.validateFile(file));

    if (validFiles.length === 0) {
      this.showNotification('No se encontraron archivos válidos', 'error');
      return;
    }

    // Agregar archivos a la selección
    validFiles.forEach(file => {
      if (!this.selectedFiles.find(f => f.name === file.name && f.size === file.size)) {
        this.selectedFiles.push(file);
      }
    });

    this.updatePreview();
    this.updateForm();
    this.showNotification(`${validFiles.length} archivo(s) agregado(s)`, 'success');
  }

  /**
   * Valida un archivo
   */
  validateFile(file) {
    const validTypes = [
      'application/pdf',
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/dwg',
      'application/x-dwg',
      'application/acad',
      'application/x-acad',
      'application/autocad-dwg',
      'image/vnd.dwg',
      'application/ifc',
      'application/x-ifc'
    ];

    const maxSize = 50 * 1024 * 1024; // 50MB
    const validExtensions = ['.pdf', '.dwg', '.dxf', '.rvt', '.ifc', '.xlsx', '.xls', '.csv', '.jpg', '.jpeg', '.png', '.gif', '.skp', '.glb', '.gltf'];

    // Validar por tipo MIME
    if (validTypes.includes(file.type)) return true;

    // Validar por extensión
    const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    if (validExtensions.includes(extension)) return true;

    // Validar tamaño
    if (file.size > maxSize) {
      this.showNotification(`El archivo ${file.name} excede el tamaño máximo de 50MB`, 'error');
      return false;
    }

    return true;
  }

  /**
   * Actualiza la vista previa de archivos
   */
  updatePreview() {
    if (!this.previewList || !this.previewContainer) return;

    if (this.selectedFiles.length === 0) {
      this.previewContainer.classList.add('hidden');
      return;
    }

    this.previewContainer.classList.remove('hidden');

    this.previewList.innerHTML = this.selectedFiles.map((file, index) =>
      this.createFilePreviewItem(file, index)
    ).join('');
  }

  /**
   * Crea el HTML para un item de vista previa
   */
  createFilePreviewItem(file, index) {
    const iconClass = this.getFileIconClass(file);
    const fileSize = this.formatFileSize(file.size);
    const fileType = this.getFileType(file);

    return `
      <div class="file-preview-item">
        <div class="file-preview-icon ${fileType}">
          <i class="ph ${iconClass}"></i>
        </div>
        <div class="file-preview-info">
          <div class="file-preview-name" title="${file.name}">${file.name}</div>
          <div class="file-preview-size">${fileSize}</div>
        </div>
        <button class="file-preview-remove" data-index="${index}" title="Eliminar archivo">
          <i class="ph ph-x"></i>
        </button>
      </div>
    `;
  }

  /**
   * Obtiene la clase de icono según el tipo de archivo
   */
  getFileIconClass(file) {
    const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

    const iconMap = {
      '.pdf': 'ph-file-pdf',
      '.dwg': 'ph-pencil-ruler',
      '.dxf': 'ph-pencil-ruler',
      '.skp': 'ph-cube',
      '.rvt': 'ph-cube',
      '.ifc': 'ph-cube',
      '.xlsx': 'ph-file-xls',
      '.xls': 'ph-file-xls',
      '.jpg': 'ph-image',
      '.jpeg': 'ph-image',
      '.png': 'ph-image',
      '.gif': 'ph-image',
      '.glb': 'ph-cube',
      '.gltf': 'ph-cube',
      '.csv': 'ph-file-xls'
    };

    return iconMap[extension] || 'ph-file';
  }

  /**
   * Obtiene el tipo de archivo para estilos
   */
  getFileType(file) {
    const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

    if (['.pdf'].includes(extension)) return 'pdf';
    if (['.dwg', '.dxf'].includes(extension)) return 'dwg';
    if (['.skp'].includes(extension)) return 'skp';
    if (['.rvt', '.ifc'].includes(extension)) return 'rvt';
    if (['.jpg', '.jpeg', '.png', '.gif'].includes(extension)) return 'img';
    if (['.xlsx', '.xls'].includes(extension)) return 'excel';
    if (['.csv'].includes(extension)) return 'csv';
    if (['.glb', '.gltf'].includes(extension)) return 'glb';

    return 'otro';
  }

  /**
   * Formatea el tamaño del archivo
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Elimina un archivo de la selección
   */
  removeFile(index) {
    this.selectedFiles.splice(index, 1);
    this.updatePreview();
    this.updateForm();
    this.showNotification('Archivo eliminado', 'info');
  }

  /**
   * Actualiza el formulario con los archivos seleccionados
   */
  updateForm() {
    if (!this.fileInput) return;

    // Crear DataTransfer para simular selección de archivos
    const dataTransfer = new DataTransfer();
    this.selectedFiles.forEach(file => {
      dataTransfer.items.add(file);
    });

    this.fileInput.files = dataTransfer.files;

    // Auto-detectar tipo de archivo si solo hay uno
    if (this.selectedFiles.length === 1) {
      const file = this.selectedFiles[0];
      const detectedType = this.detectFileType(file);
      const typeSelect = document.getElementById('up-type');

      if (typeSelect && detectedType) {
        typeSelect.value = detectedType;
      }

      // Auto-llenar nombre si está vacío
      const nameInput = document.getElementById('up-name');
      if (nameInput && !nameInput.value) {
        const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
        nameInput.value = baseName;
      }
    }

    // Actualizar botón de submit
    this.updateSubmitButton();
  }

  /**
   * Detecta automáticamente el tipo de archivo
   */
  detectFileType(file) {
    const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

    const typeMap = {
      '.pdf': 'pdf',
      '.dwg': 'dwg',
      '.dxf': 'dwg',
      '.skp': 'skp',
      '.rvt': 'rvt',
      '.ifc': 'ifc',
      '.xlsx': 'excel',
      '.xls': 'excel',
      '.csv': 'csv',
      '.glb': 'glb',
      '.gltf': 'glb',
      '.jpg': 'img',
      '.jpeg': 'img',
      '.png': 'img',
      '.gif': 'img'
    };

    return typeMap[extension] || 'otro';
  }

  /**
   * Actualiza el texto y estado del botón de submit
   */
  updateSubmitButton() {
    const submitBtn = document.getElementById('btn-submit-upload');
    if (!submitBtn) return;

    if (this.selectedFiles.length === 0) {
      submitBtn.innerHTML = '<i class="ph ph-cloud-arrow-up mr-1"></i> Subir Archivo al Servidor';
      submitBtn.disabled = true;
    } else if (this.selectedFiles.length === 1) {
      submitBtn.innerHTML = '<i class="ph ph-cloud-arrow-up mr-1"></i> Subir Archivo al Servidor';
      submitBtn.disabled = false;
    } else {
      submitBtn.innerHTML = `<i class="ph ph-cloud-arrow-up mr-1"></i> Subir ${this.selectedFiles.length} Archivos`;
      submitBtn.disabled = false;
    }
  }

  /**
   * Muestra una notificación al usuario
   */
  showNotification(message, type = 'info') {
    // Crear elemento de notificación
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <div class="notification-content">
        <i class="ph ${this.getNotificationIcon(type)}"></i>
        <span>${message}</span>
      </div>
    `;

    // Estilos para la notificación
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${this.getNotificationColor(type)};
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 10000;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 500;
      animation: slideInRight 0.3s ease-out;
      max-width: 300px;
    `;

    document.body.appendChild(notification);

    // Remover después de 3 segundos
    setTimeout(() => {
      notification.style.animation = 'slideOutRight 0.3s ease-out';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  /**
   * Obtiene el icono para la notificación
   */
  getNotificationIcon(type) {
    const icons = {
      success: 'ph-check-circle',
      error: 'ph-x-circle',
      info: 'ph-info',
      warning: 'ph-warning'
    };
    return icons[type] || 'ph-info';
  }

  /**
   * Obtiene el color para la notificación
   */
  getNotificationColor(type) {
    const colors = {
      success: '#10B981',
      error: '#EF4444',
      info: '#3B82F6',
      warning: '#F59E0B'
    };
    return colors[type] || '#3B82F6';
  }

  /**
   * Limpia la selección de archivos
   */
  clearSelection() {
    this.selectedFiles = [];
    this.updatePreview();
    this.updateForm();

    if (this.fileInput) {
      this.fileInput.value = '';
    }
  }

  /**
   * Obtiene los archivos seleccionados
   */
  getSelectedFiles() {
    return this.selectedFiles;
  }

  /**
   * Renderiza la lista de archivos de una ruta específica dentro de un contenedor in-situ.
   * Filtra desde state.archivosNube por bloque actual y carpeta.
   * @param {string} ruta - Ruta de carpeta (ej: '01_Arquitectonico/03_Entregables_PDF')
   * @param {HTMLElement} listContainer - Contenedor donde renderizar la lista
   * @param {HTMLElement} badgeContainer - Elemento badge para mostrar conteo
   */
  renderFilesList(ruta, listContainer, badgeContainer) {
    if (!listContainer) return;

    const blockId = state.currentBlockId;
    if (!blockId) {
      listContainer.innerHTML = '<div class="text-sm p-2" style="color:var(--text-muted);font-style:italic;">Selecciona un bloque primero</div>';
      return;
    }

    // Filter files from synced Firestore data
    const archivos = Array.isArray(state.archivosNube) ? state.archivosNube : [];
    const filtered = archivos.filter(f => {
      if (!f) return false;
      if (String(f.bloque || '') !== String(blockId)) return false;
      const folderPath = String(f.carpeta || '');
      return folderPath === ruta || folderPath.startsWith(ruta + '/');
    });

    if (badgeContainer) {
      badgeContainer.textContent = `${filtered.length} archivo${filtered.length !== 1 ? 's' : ''}`;
    }

    if (filtered.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align:center;padding:16px 8px;color:var(--text-muted);">
          <i class="ph ph-folder-dashed" style="font-size:2rem;display:block;margin-bottom:6px;"></i>
          <p style="font-size:0.78rem;margin:0;">Sin archivos en esta carpeta</p>
        </div>`;
      return;
    }

    // Sort by date descending
    filtered.sort((a, b) => {
      const dA = a.fechaCreacion?.toDate?.() || new Date(a.fechaCreacion || 0);
      const dB = b.fechaCreacion?.toDate?.() || new Date(b.fechaCreacion || 0);
      return dB - dA;
    });

    const iconMap = {
      pdf: { icon: 'ph-file-pdf', color: 'var(--danger)' },
      dwg: { icon: 'ph-pencil-ruler', color: 'var(--pink)' },
      skp: { icon: 'ph-cube', color: '#8b5cf6' },
      rvt: { icon: 'ph-cube', color: 'var(--cyan)' },
      ifc: { icon: 'ph-cube', color: 'var(--amber)' },
      excel: { icon: 'ph-file-xls', color: 'var(--green)' },
      csv: { icon: 'ph-file-xls', color: 'var(--green)' },
      glb: { icon: 'ph-cube', color: 'var(--cyan)' },
      img: { icon: 'ph-image', color: '#a855f7' },
    };

    let html = '<ul style="list-style:none;padding:0;margin:0;">';
    filtered.forEach(archivo => {
      const meta = iconMap[archivo.tipo] || { icon: 'ph-file', color: 'var(--text-muted)' };
      const fileJson = encodeURIComponent(JSON.stringify(archivo));
      const size = this.formatFileSize(archivo.tamaño || 0);
      const isAdmin = state.userRole === 'admin';
      const deleteBtn = isAdmin ? `
              <button data-delete-file="${fileJson}" style="
                padding:4px;font-size:0.9rem;background:none;border:none;
                color:var(--text-muted);cursor:pointer;" title="Eliminar"
                onmouseover="this.style.color='var(--danger)';"
                onmouseout="this.style.color='var(--text-muted)';">
                <i class="ph ph-trash"></i>
              </button>` : '';
      html += `
        <li style="margin-bottom:4px;">
          <div data-open-viewer="${fileJson}" style="
            display:flex;align-items:center;justify-content:space-between;
            padding:8px 10px;border-radius:6px;cursor:pointer;
            background:var(--midnight-mid);border:1px solid var(--border-subtle);
            transition:all 0.15s;" 
            onmouseover="this.style.borderColor='var(--border-active)';this.style.background='var(--surface-active)';"
            onmouseout="this.style.borderColor='var(--border-subtle)';this.style.background='var(--midnight-mid)';">
            <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
              <i class="ph-fill ${meta.icon}" style="color:${meta.color};font-size:1.1rem;flex-shrink:0;"></i>
              <span style="font-size:0.78rem;font-weight:500;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${archivo.nombre}</span>
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
              <span style="font-size:0.65rem;color:var(--text-muted);">${size}</span>
              ${isAdmin ? `<button data-doc-download="${fileJson}" style="
                padding:4px;font-size:0.9rem;background:none;border:none;
                color:var(--text-secondary);cursor:pointer;" title="Descargar"
                onmouseover="this.style.color='var(--cyan)';"
                onmouseout="this.style.color='var(--text-secondary)';">
                <i class="ph ph-cloud-arrow-down"></i>
              </button>` : ''}${deleteBtn}
            </div>
          </div>
        </li>`;
    });
    html += '</ul>';
    listContainer.innerHTML = html;
  }
}

// Agregar animaciones CSS para notificaciones
const style = document.createElement('style');
style.textContent = `
  @keyframes slideInRight {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  @keyframes slideOutRight {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }

  .notification-content {
    display: flex;
    align-items: center;
    gap: 8px;
  }
`;
document.head.appendChild(style);

// Exportar el gestor de archivos
export { FileManager };

// Crear instancia global
let fileManagerInstance = null;

export function initFileManager() {
  if (!fileManagerInstance) {
    fileManagerInstance = new FileManager();
  }
  return fileManagerInstance;
}

export function getFileManager() {
  return fileManagerInstance;
}
