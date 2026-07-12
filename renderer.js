/**
 * ZXDrawer Renderer Logic
 */

const SPECTRUM_PALETTE = [
    ['#000000', '#0000D7', '#D70000', '#D700D7', '#00D700', '#00D7D7', '#D7D700', '#D7D7D7'], // Normal
    ['#000000', '#0000FF', '#FF0000', '#FF00FF', '#00FF00', '#00FFFF', '#FFFF00', '#FFFFFF']  // Bright
];

// Localized strings are loaded from JSON files in /locales/*.json
const FALLBACK_TRANSLATIONS = {
    en: {
        'tool.grid': 'Grid',
        'tool.draw.title': 'Draw Mode (P)',
        'tool.select.title': 'Select Blocks (S)',
        'tool.text.title': 'Text Tool (T)',
        'tool.resize.title': 'Resize',
        'tool.flip.h': 'Flip Horizontal (H)',
        'tool.flip.v': 'Flip Vertical (V)',
        'tool.invert.pixels': 'Invert Pixels',
        'tool.invert.attrs': 'Invert Attributes (swap ink/paper)',
        'label.ink': 'Ink Color',
        'label.paper': 'Paper Color',
        'label.bright': 'Bright',
        'label.flash': 'Flash',
        'panel.animation': 'Animation Preview',
        'panel.currentAttr': 'Current Attribute'
    }
};

class ZXDrawer {
    constructor() {
        this.zoom = 4;
        this.gridVisible = true;
        this.pixelGridVisible = false;
        this.flashInverted = false;
        this.currentTool = 'draw';
        
        // Selection/Clipboard
        this.selection = null; // { x, y, w, h } in blocks
        this.clipboard = null; // { pixels, attributes, w, h }
        this.isPasting = false;
        this.pastePos = { bx: 0, by: 0 };

        // Undo / Redo
        this.undoStack = [];
        this.redoStack = [];

        // Current file
        this.currentFilePath = null;

        // Animation viewer
        this.animInterval = null;
        this.animCurrentFrame = 0;
        
        // State
        this.pixels = null; // Uint8Array (0 or 1)
        this.attributes = null; // Uint8Array (attribute bytes)
        
        // Active Selection
        this.ink = 7;
        this.paper = 0;
        this.bright = 0;
        this.flash = 0;

        this.useCurrentAttr = false;
        this.savedAttr = { ink: 7, paper: 0, bright: 0, flash: 0 };

        // DOM elements
        this.canvas = document.getElementById('main-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.gridCanvas = document.getElementById('grid-canvas');
        this.gridCtx = this.gridCanvas.getContext('2d');
        this.selCanvas = document.getElementById('selection-canvas');
        this.selCtx = this.selCanvas.getContext('2d');
        this.canvasWrapper = document.getElementById('canvas-wrapper');
        
        this.init();
    }

    init() {
        this.resetData(256, 192);
        this.setupEventListeners();
        this.setupPalettes();
        this.setupAnimationViewer();
        // Apply translations synchronously before first render to avoid flash of untranslated text.
        // setupI18n also wires the lang-select onchange for subsequent switches.
        this.setupI18n();
        this.setupRecentFiles();
        this.setupDragAndDrop();
        this.render();
        this.updateUI();

        // Start Flash timer
        setInterval(() => {
            this.flashInverted = !this.flashInverted;
            this.render();
            this.renderAnimFrame();
        }, 1000);
    }

    // Drag & drop files onto the window to open
    setupDragAndDrop() {
        try {
            window.addEventListener('dragover', (e) => { e.preventDefault(); });
            window.addEventListener('drop', async (e) => {
                e.preventDefault();
                try {
                    const files = (e.dataTransfer && e.dataTransfer.files) ? e.dataTransfer.files : null;
                    if (!files || files.length === 0) return;
                    for (let i = 0; i < files.length; i++) {
                        const f = files[i];
                        // path is provided by Electron file drag
                        const p = f.path || f.name;
                        if (!p) continue;
                        const lower = p.toLowerCase();
                        if (lower.endsWith('.zxp') || lower.endsWith('.scr') || lower.endsWith('.chr') || lower.endsWith('.ch8')) {
                            const file = await window.electronAPI.loadFilePath(p);
                            if (file) {
                                if (file.type === 'scr') {
                                    this.importFromSCR(file.content);
                                    this.currentFilePath = file.filePath;
                                    this.setDirty(false);
                                    this.render();
                                    try { if (p) { this.addRecentFile(p); window.electronAPI.addRecentFile(p); } } catch(e) {}
                                } else if (file.type === 'chr' || file.type === 'ch8') {
                                    this.importFromCHR(file.content);
                                    this.currentFilePath = file.filePath;
                                    this.setDirty(false);
                                    this.render();
                                    try { if (p) { this.addRecentFile(p); window.electronAPI.addRecentFile(p); } } catch(e) {}
                                } else if (file.type === 'bas') {
                                    this._pendingBasContent = file.content;
                                    this._pendingBasFilePath = file.filePath;
                                    this.openImportBasModal();
                                } else {
                    this.importFromZXP(file.content);
                this.currentFilePath = file.filePath;
                this.setDirty(false);
                                    this.render();
                                    try { if (p) { this.addRecentFile(p); window.electronAPI.addRecentFile(p); } } catch(e) {}
                                }
                            }
                            // open only first supported file by default
                            break;
                        }
                    }
                } catch (err) { console.warn('drop handler failed', err); }
            });
        } catch (e) { /* noop */ }
    }

    // Recent files management (store in localStorage, max 10)
    setupRecentFiles() {
        try {
            this.renderRecentList();
            const sel = document.getElementById('recent-select');
            if (sel) {
                sel.onchange = async (e) => {
                    const val = sel.value;
                    if (!val) return;
                    // Load via main process
                    const file = await window.electronAPI.loadFilePath(val);
                    if (file) {
                        if (file.type === 'scr') {
                            this.importFromSCR(file.content);
                        } else if (file.type === 'chr' || file.type === 'ch8') {
                            this.importFromCHR(file.content);
                } else {
                    this.importFromZXP(file.content);
                }
                this.currentFilePath = file.filePath;
                        this.render();
                        this.addRecentFile(val);
                    } else {
                        const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.invalid_zxp']) ? this._currentLocaleMap['alert.invalid_zxp'] : 'Failed to open file.';
                        alert(msg);
                    }
                    // reset selection to placeholder
                    this.renderRecentList();
                };
            }
        } catch (e) { /* noop */ }
    }

    getRecentFiles() {
        try {
            const raw = localStorage.getItem('zxdrawer_recent_files');
            if (!raw) return [];
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return [];
            return arr;
        } catch (e) { return []; }
    }

    saveRecentFiles(arr) {
        try { localStorage.setItem('zxdrawer_recent_files', JSON.stringify(arr)); } catch (e) {}
    }

    addRecentFile(filePath) {
        if (!filePath) return;
        const arr = this.getRecentFiles().filter(p => p !== filePath);
        arr.unshift(filePath);
        while (arr.length > 10) arr.pop();
        this.saveRecentFiles(arr);
        this.renderRecentList();
    }

    renderRecentList() {
        try {
            const sel = document.getElementById('recent-select');
            if (!sel) return;
            const arr = this.getRecentFiles();
            sel.innerHTML = '';
            if (!arr || arr.length === 0) {
                const opt = document.createElement('option'); opt.value = ''; opt.text = (this._currentLocaleMap && this._currentLocaleMap['label.recent']) ? (this._currentLocaleMap['label.recent'] + ':') : 'Recent:'; opt.disabled = true; sel.appendChild(opt);
                const empty = document.createElement('option'); empty.value = ''; empty.text = 'No recent files'; empty.disabled = true; sel.appendChild(empty);
                return;
            }
            const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.text = (this._currentLocaleMap && this._currentLocaleMap['label.recent']) ? (this._currentLocaleMap['label.recent'] + ':') : 'Recent:'; placeholder.disabled = true; sel.appendChild(placeholder);
            for (let i = 0; i < arr.length; i++) {
                const p = arr[i];
                const opt = document.createElement('option');
                opt.value = p;
                // show filename and truncated path
                const base = p.split(/[/\\]/).pop();
                opt.text = `${base} — ${p}`;
                sel.appendChild(opt);
            }
        } catch (e) { /* noop */ }
    }

    resetData(w, h) {
        this.width = w;
        this.height = h;
        this.pixels = new Uint8Array(w * h);
        this.attributes = new Uint8Array((w / 8) * (h / 8));
        
        // Default attribute: Ink 7, Paper 0 (White on Black)
        for(let i=0; i < this.attributes.length; i++) {
            this.attributes[i] = 0x38; // 00 111 000 (Flash 0, Bright 0, Paper 7, Ink 0) -> Wait
            // Spectrum attributes: F B P P P I I I
            // Paper 7 (111), Ink 0 (000) -> 00 111 000 = 0x38. Actually Paper 0, Ink 7 is 00 000 111 = 0x07.
            // Let's use 0x07 as default (Paper 0, Ink 7).
            this.attributes[i] = 0x07;
        }

        this.canvas.width = w;
        this.canvas.height = h;
        this.gridCanvas.width = w;
        this.gridCanvas.height = h;
        this.selCanvas.width = w;
        this.selCanvas.height = h;
        this.updateZoom();
    }

    resizeData(newW, newH) {
        const oldW = this.width;
        const oldH = this.height;
        const oldPixels = this.pixels;
        const oldAttributes = this.attributes;
        
        this.width = newW;
        this.height = newH;
        this.pixels = new Uint8Array(newW * newH);
        this.attributes = new Uint8Array((newW / 8) * (newH / 8));
        
        for(let i=0; i < this.attributes.length; i++) {
            this.attributes[i] = 0x07;
        }

        const copyW = Math.min(oldW, newW);
        const copyH = Math.min(oldH, newH);
        
        for (let y = 0; y < copyH; y++) {
            for (let x = 0; x < copyW; x++) {
                this.pixels[y * newW + x] = oldPixels[y * oldW + x];
            }
        }
        
        const copyAttrW = Math.min(oldW / 8, newW / 8);
        const copyAttrH = Math.min(oldH / 8, newH / 8);
        const newAttrW = newW / 8;
        const oldAttrW = oldW / 8;
        
        for (let y = 0; y < copyAttrH; y++) {
            for (let x = 0; x < copyAttrW; x++) {
                this.attributes[y * newAttrW + x] = oldAttributes[y * oldAttrW + x];
            }
        }

        this.canvas.width = newW;
        this.canvas.height = newH;
        this.gridCanvas.width = newW;
        this.gridCanvas.height = newH;
        this.selCanvas.width = newW;
        this.selCanvas.height = newH;
        this.updateZoom();
    }

    setupPalettes() {
        const inkGrid = document.getElementById('ink-palette');
        const paperGrid = document.getElementById('paper-palette');

        const createSwatches = (container, type) => {
            container.innerHTML = '';
            for (let i = 0; i < 8; i++) {
                const swatch = document.createElement('div');
                swatch.className = 'color-swatch';
                swatch.style.backgroundColor = SPECTRUM_PALETTE[0][i];
                swatch.dataset.index = i;
                if ((type === 'ink' && this.ink === i) || (type === 'paper' && this.paper === i)) {
                    swatch.classList.add('active');
                }
                swatch.onclick = () => {
                    // Toggle selection: click again to deselect (use existing block attribute)
                    if (type === 'ink') {
                        if (this.ink === i) this.ink = null; else this.ink = i;
                    } else {
                        if (this.paper === i) this.paper = null; else this.paper = i;
                    }
                    document.querySelectorAll(`#${type}-palette .color-swatch`).forEach(s => s.classList.remove('active'));
                    // mark active if selected
                    if ((type === 'ink' && this.ink === i) || (type === 'paper' && this.paper === i)) {
                        swatch.classList.add('active');
                    }
                    this.updateUI();
                };
                container.appendChild(swatch);
            }
        };

        createSwatches(inkGrid, 'ink');
        createSwatches(paperGrid, 'paper');
    }

    setupEventListeners() {
        // Zoom
        document.getElementById('zoom-in').onclick = () => { this.zoom = Math.min(16, this.zoom + 1); this.updateZoom(); };
        document.getElementById('zoom-out').onclick = () => { if(this.zoom > 1) this.zoom--; this.updateZoom(); };
        // Sidebar zoom/grid proxies
        const zinSb = document.getElementById('zoom-in-sb');
        const zoutSb = document.getElementById('zoom-out-sb');
        const gridSb = document.getElementById('grid-toggle-sb');
        if (zinSb) zinSb.onclick = () => { this.zoom = Math.min(16, this.zoom + 1); this.updateZoom(); };
        if (zoutSb) zoutSb.onclick = () => { if(this.zoom > 1) this.zoom--; this.updateZoom(); };
        if (gridSb) gridSb.onclick = () => {
            this.gridVisible = !this.gridVisible;
            document.getElementById('grid-toggle').classList.toggle('active', this.gridVisible);
            gridSb.classList.toggle('active', this.gridVisible);
            this.drawGrid();
        };
        const pixelGridSb = document.getElementById('pixel-grid-toggle-sb');
        if (pixelGridSb) pixelGridSb.onclick = () => {
            this.pixelGridVisible = !this.pixelGridVisible;
            pixelGridSb.classList.toggle('active', this.pixelGridVisible);
            this.drawGrid();
        };

        document.getElementById('canvas-container').addEventListener('wheel', (e) => {
            e.preventDefault();
            const container = document.getElementById('canvas-container');
            const rect = container.getBoundingClientRect();
            
            // Calculate absolute mouse position relative to the canvas content
            const mouseX = e.clientX - rect.left + container.scrollLeft;
            const mouseY = e.clientY - rect.top + container.scrollTop;
            
            const oldZoom = this.zoom;

            if (e.deltaY < 0) {
                this.zoom = Math.min(16, this.zoom + 1);
            } else {
                this.zoom = Math.max(1, this.zoom - 1);
            }
            
            if (this.zoom !== oldZoom) {
                this.updateZoom();
                
                // Adjust scroll position to keep the content under the mouse cursor
                const zoomRatio = this.zoom / oldZoom;
                container.scrollLeft = mouseX * zoomRatio - (e.clientX - rect.left);
                container.scrollTop = mouseY * zoomRatio - (e.clientY - rect.top);
            }
        }, { passive: false });
        
        // Tools
        document.getElementById('tool-draw').onclick = () => this.setTool('draw');
        document.getElementById('tool-select').onclick = () => this.setTool('select');
        document.getElementById('tool-text').onclick = () => this.setTool('text');
        
        document.getElementById('copy-btn').onclick = () => this.copySelection();
        document.getElementById('paste-btn').onclick = () => this.startPaste();

        // Grid Toggle
        document.getElementById('grid-toggle').onclick = (e) => {
            this.gridVisible = !this.gridVisible;
            e.target.classList.toggle('active', this.gridVisible);
            this.drawGrid();
        };

        // Mods
        // Use Current Attributes Toggle
        const useCurrentAttrToggle = document.getElementById('use-current-attr-toggle');
        if (useCurrentAttrToggle) {
            useCurrentAttrToggle.onchange = (e) => {
                this.useCurrentAttr = e.target.checked;
                if (this.useCurrentAttr) {
                    this.savedAttr = { ink: this.ink, paper: this.paper, bright: this.bright, flash: this.flash };
                    this.ink = null;
                    this.paper = null;
                    this.bright = null;
                    this.flash = null;
                } else {
                    this.ink = this.savedAttr.ink;
                    this.paper = this.savedAttr.paper;
                    this.bright = this.savedAttr.bright;
                    this.flash = this.savedAttr.flash;
                }
                this.updateUI();
            };
        }

        // 3-position selects: keep / on / off
        document.getElementById('bright-toggle').onchange = (e) => {
            const v = e.target.value;
            this.bright = (v === 'keep') ? null : (v === '1' ? 1 : 0);
            this.updateUI();
        };
        document.getElementById('flash-toggle').onchange = (e) => {
            const v = e.target.value;
            this.flash = (v === 'keep') ? null : (v === '1' ? 1 : 0);
            this.updateUI();
        };

        // Undo / Redo
        document.getElementById('undo-btn').onclick = () => this.undo();
        document.getElementById('redo-btn').onclick = () => this.redo();

        // Flip
        document.getElementById('flip-h-btn').onclick = () => this.flipSelection('h');
        document.getElementById('flip-v-btn').onclick = () => this.flipSelection('v');
        // Rotate selection 90 degrees clockwise
        const rotBtn = document.getElementById('rotate-btn');
        if (rotBtn) rotBtn.onclick = () => this.rotateSelection90();

        // Invert
        document.getElementById('invert-pixels-btn').onclick = () => this.invertPixels();
        document.getElementById('invert-attrs-btn').onclick = () => this.invertAttrs();

        // Masks
        document.getElementById('generate-masks-btn').onclick = () => this.openMasksModal();
        const editMaskBtn = document.getElementById('edit-mask-btn');
        if (editMaskBtn) editMaskBtn.onclick = () => this.openMaskEditor();

        // Canvas Painting
        let isDrawing = false;
        
        const handlePaint = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = Math.floor((e.clientX - rect.left) / this.zoom);
            const y = Math.floor((e.clientY - rect.top) / this.zoom);
            
            if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
                const bx = Math.floor(x / 8);
                const by = Math.floor(y / 8);

                if (this.isPasting && this.clipboard) {
                    this.saveHistory();
                    this.executePaste(this.pastePos.bx, this.pastePos.by);
                    isDrawing = false; // Stop drawing after paste
                    return;
                }

                if (this.currentTool === 'draw') {
                    const attrIdx = by * (this.width / 8) + bx;
                    // Update pixels
                    if (e.buttons & 1) { // Left click
                        this.pixels[y * this.width + x] = 1;
                                this.attributes[attrIdx] = this.computeAttrByte(attrIdx);
                    } else if (e.buttons & 2) { // Right click
                        this.pixels[y * this.width + x] = 0;
                                this.attributes[attrIdx] = this.computeAttrByte(attrIdx);
                    }
                } else if (this.currentTool === 'select') {
                    if (isDrawing) {
                        const startBX = Math.floor(this.dragStart.x / 8);
                        const startBY = Math.floor(this.dragStart.y / 8);
                        const endBX = Math.floor(x / 8);
                        const endBY = Math.floor(y / 8);
                        
                        this.selection = {
                            x: Math.min(startBX, endBX),
                            y: Math.min(startBY, endBY),
                            w: Math.abs(startBX - endBX) + 1,
                            h: Math.abs(startBY - endBY) + 1
                        };
                        this.drawSelection();
                    }
                }
                
                this.render();
                this.updateStatus(x, y);
            }
        };

        this.canvasWrapper.onmousedown = (e) => { 
            const rect = this.canvas.getBoundingClientRect();
            this.dragStart = {
                x: Math.floor((e.clientX - rect.left) / this.zoom),
                y: Math.floor((e.clientY - rect.top) / this.zoom)
            };
            if (e.button === 2) e.preventDefault();
            isDrawing = true;
            if (this.currentTool === 'text' && e.button === 0) {
                isDrawing = false;
                const px = Math.floor((e.clientX - rect.left) / this.zoom);
                const py = Math.floor((e.clientY - rect.top) / this.zoom);
                this.openTextModal(px, py);
                return;
            }
            if (this.currentTool === 'draw' && !this.isPasting) this.saveHistory();
            handlePaint(e); 
        };
        this.canvasWrapper.oncontextmenu = (e) => e.preventDefault();
        window.onmousemove = (e) => { 
            const rect = this.canvas.getBoundingClientRect();
            const x = Math.floor((e.clientX - rect.left) / this.zoom);
            const y = Math.floor((e.clientY - rect.top) / this.zoom);

            if (this.isPasting) {
                let bx = Math.floor(x / 8);
                let by = Math.floor(y / 8);
                if (this.clipboard) {
                    bx = Math.max(0, Math.min(bx, Math.floor(this.width / 8) - this.clipboard.w));
                    by = Math.max(0, Math.min(by, Math.floor(this.height / 8) - this.clipboard.h));
                }
                this.pastePos = { bx, by };
                this.drawSelection();
            }

            if (isDrawing) handlePaint(e); 
            
            // Update status even if not drawing
            if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
                this.updateStatus(x, y);
            }
        };
        window.onmouseup = () => { isDrawing = false; };

        // Modal triggers
        document.getElementById('size-settings').onclick = () => {
            // Open size modal for resizing; prefill with current canvas size
            const modal = document.getElementById('size-modal');
            document.getElementById('width-input').value = this.width || 256;
            document.getElementById('height-input').value = this.height || 192;
            // Set preset select to match current dims if possible
            try {
                const preset = document.getElementById('preset-select');
                let matched = false;
                for (let i = 0; i < preset.options.length; i++) {
                    const opt = preset.options[i];
                    const ow = parseInt(opt.dataset.w);
                    const oh = parseInt(opt.dataset.h);
                    if (!isNaN(ow) && !isNaN(oh) && ow === (this.width || 256) && oh === (this.height || 192)) { preset.selectedIndex = i; matched = true; break; }
                }
                if (!matched) preset.value = 'custom';
            } catch (e) { /* ignore if element missing */ }
            modal.dataset.purpose = 'resize';
            modal.classList.remove('hidden');
        };
        document.getElementById('modal-cancel').onclick = () => {
             document.getElementById('size-modal').classList.add('hidden');
        };
        document.getElementById('modal-apply').onclick = () => {
            const w = parseInt(document.getElementById('width-input').value);
            const h = parseInt(document.getElementById('height-input').value);
            const modal = document.getElementById('size-modal');
            if (w % 8 === 0 && h % 8 === 0 && w > 0 && h > 0) {
                const purpose = modal.dataset.purpose || 'resize';
                if (purpose === 'new') {
                    // Creating a new image: reset data, clear history and file path
                    this.resetData(w, h);
                    this.undoStack = [];
                    this.redoStack = [];
                    this.currentFilePath = null;
                    this.setDirty(false);
                } else {
                    // Resize (preserving previous image data)
                    this.saveHistory();
                    this.resizeData(w, h);
                }
                this.render();
                modal.classList.add('hidden');
            } else {
                const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.size_multiple']) ? this._currentLocaleMap['alert.size_multiple'] : 'Size must be a multiple of 8.';
                alert(msg);
            }
        };

        // Preset select wiring: when user picks a preset, update width/height inputs but allow manual override
        try {
            const presetSel = document.getElementById('preset-select');
            if (presetSel) {
                presetSel.onchange = (e) => {
                    const opt = presetSel.options[presetSel.selectedIndex];
                    const ow = parseInt(opt.dataset.w);
                    const oh = parseInt(opt.dataset.h);
                    if (!isNaN(ow) && !isNaN(oh)) {
                        document.getElementById('width-input').value = ow;
                        document.getElementById('height-input').value = oh;
                    }
                };
            }
        } catch (e) { /* noop */ }

        // File I/O
        document.getElementById('import-image-btn').onclick = () => this.triggerImageImport();

        const buildSavePayload = () => {
            let scrBytes = null;
            try { scrBytes = Array.from(this.generateScrBytes()); } catch(e) {}
            return {
                zxp: this.exportToZXP(),
                scr: scrBytes
            };
        };

        document.getElementById('save-btn').onclick = async () => {
            if (this.currentFilePath) {
                try {
                    if (this.currentFilePath.toLowerCase().endsWith('.scr')) {
                        const scrBytes = this.generateScrBytes();
                        await window.electronAPI.saveFileDirect(this.currentFilePath, Array.from(scrBytes));
                    } else if (this.currentFilePath.toLowerCase().endsWith('.chr') || this.currentFilePath.toLowerCase().endsWith('.ch8')) {
                        const chrBytes = this.generateChrBytes();
                        await window.electronAPI.saveFileDirect(this.currentFilePath, Array.from(chrBytes));
                    } else {
                        const zxpContent = this.exportToZXP();
                        await window.electronAPI.saveFileDirect(this.currentFilePath, zxpContent);
                    }
                    this.setDirty(false);
                    try { this.addRecentFile(this.currentFilePath); window.electronAPI.addRecentFile(this.currentFilePath); } catch(e) {}
                } catch (e) {
                    alert(e.message || 'Save failed.');
                }
            } else {
                const filePath = await window.electronAPI.saveFile(buildSavePayload(), 'my_graphic.zxp');
                if (filePath) { this.currentFilePath = filePath; this.setDirty(false); }
                try { if (filePath) { this.addRecentFile(filePath); window.electronAPI.addRecentFile(filePath); } } catch(e) {}
            }
        };

        document.getElementById('saveas-btn').onclick = async () => {
            const filePath = await window.electronAPI.saveFile(buildSavePayload(), this.currentFilePath || 'my_graphic.zxp');
            if (filePath) { this.currentFilePath = filePath; this.setDirty(false); }
            try { if (filePath) { this.addRecentFile(filePath); window.electronAPI.addRecentFile(filePath); } } catch(e) {}
        };

        document.getElementById('load-btn').onclick = async () => {
            const file = await window.electronAPI.loadFile();
            if (file) {
                if (file.type === 'scr') {
                    this.importFromSCR(file.content);
                    this.currentFilePath = file.filePath;
                    this.setDirty(false);
                    this.render();
                    try { if (file.filePath) { this.addRecentFile(file.filePath); window.electronAPI.addRecentFile(file.filePath); } } catch(e) {}
                } else if (file.type === 'chr' || file.type === 'ch8') {
                    this.importFromCHR(file.content);
                    this.currentFilePath = file.filePath;
                    this.setDirty(false);
                    this.render();
                    try { if (file.filePath) { this.addRecentFile(file.filePath); window.electronAPI.addRecentFile(file.filePath); } } catch(e) {}
                } else if (file.type === 'bas') {
                    this._pendingBasContent = file.content;
                    this._pendingBasFilePath = file.filePath;
                    this.openImportBasModal();
                } else {
                    this.importFromZXP(file.content);
                    this.currentFilePath = file.filePath;
                    this.setDirty(false);
                    this.render();
                    try { if (file.filePath) { this.addRecentFile(file.filePath); window.electronAPI.addRecentFile(file.filePath); } } catch(e) {}
                }
            }
        };

        document.getElementById('new-btn').onclick = () => {
            // Open size modal for creating a new image. Defaults to ZX Spectrum size.
            const modal = document.getElementById('size-modal');
            document.getElementById('width-input').value = 256;
            document.getElementById('height-input').value = 192;
            try { const preset = document.getElementById('preset-select'); if (preset) preset.value = 'spectrum'; } catch(e) {}
            modal.dataset.purpose = 'new';
            modal.classList.remove('hidden');
        };

        // About modal
        document.getElementById('about-close').onclick = () => {
            document.getElementById('about-modal').classList.add('hidden');
        };
        try {
            document.querySelectorAll('#about-modal a[id^="supporter-"]').forEach(link => {
                link.onclick = (e) => {
                    e.preventDefault();
                    window.electronAPI.openExternal(e.currentTarget.href);
                };
            });
        } catch(e) {}
        // Populate about modal version when opened
        const aboutModal = document.getElementById('about-modal');
        const showAbout = () => {
            try {
                if (window.electronAPI && typeof window.electronAPI.getAppVersion === 'function') {
                    const v = window.electronAPI.getAppVersion();
                    if (v) document.getElementById('about-version').textContent = 'v' + v;
                }
            } catch (e) { console.warn('getAppVersion failed', e); }
            aboutModal.classList.remove('hidden');
        };
        // override menu event to populate version
        window.electronAPI.onMenuEvent('menu-about',  () => showAbout());

        // Native menu events from main process
        window.electronAPI.onMenuEvent('menu-import-image', () => this.triggerImageImport());
        window.electronAPI.onMenuEvent('menu-import-boriel-putchars', () => this.triggerBasImport());
        window.electronAPI.onMenuEvent('menu-new',    () => document.getElementById('new-btn').click());
        window.electronAPI.onMenuEvent('menu-open',   () => document.getElementById('load-btn').click());
        // File opened from Recent menu
        window.electronAPI.onMenuEvent('menu-open-file', (ev, file) => {
            try {
                if (!file) return;
                if (file.type === 'scr') {
                    this.importFromSCR(file.content);
                    this.currentFilePath = file.filePath;
                    this.setDirty(false);
                    this.render();
                    try { if (file.filePath) { this.addRecentFile(file.filePath); window.electronAPI.addRecentFile(file.filePath); } } catch(e) {}
                } else if (file.type === 'chr' || file.type === 'ch8') {
                    this.importFromCHR(file.content);
                    this.currentFilePath = file.filePath;
                    this.setDirty(false);
                    this.render();
                    try { if (file.filePath) { this.addRecentFile(file.filePath); window.electronAPI.addRecentFile(file.filePath); } } catch(e) {}
                } else if (file.type === 'bas') {
                    this._pendingBasContent = file.content;
                    this._pendingBasFilePath = file.filePath;
                    this.openImportBasModal();
                } else {
                    this.importFromZXP(file.content);
                    this.currentFilePath = file.filePath;
                    this.setDirty(false);
                    this.render();
                    try { if (file.filePath) { this.addRecentFile(file.filePath); window.electronAPI.addRecentFile(file.filePath); } } catch(e) {}
                }
            } catch (e) { console.warn('menu-open-file handler failed', e); }
        });
        window.electronAPI.onMenuEvent('menu-save',   () => document.getElementById('save-btn').click());
        window.electronAPI.onMenuEvent('menu-saveas', () => document.getElementById('saveas-btn').click());
        window.electronAPI.onMenuEvent('menu-about',  () => document.getElementById('about-modal').classList.remove('hidden'));
        window.electronAPI.onMenuEvent('menu-undo',   () => this.undo());
        window.electronAPI.onMenuEvent('menu-redo',   () => this.redo());
        window.electronAPI.onMenuEvent('menu-copy',   () => this.copySelection());
        window.electronAPI.onMenuEvent('menu-paste',  () => this.startPaste());
        window.electronAPI.onMenuEvent('menu-export-png', () => this.exportPng());
        window.electronAPI.onMenuEvent('menu-export-boriel-putchars', () => this.exportBorielPutChars());
        window.electronAPI.onMenuEvent('menu-export-boriel-gusprites', () => this.exportBorielGuSprites());
        window.electronAPI.onMenuEvent('menu-export-data', () => this.exportData());
        window.electronAPI.onMenuEvent('menu-export-scr', () => this.exportScr());
        window.electronAPI.onMenuEvent('menu-export-chr', () => this.exportToCHR());
        window.electronAPI.onMenuEvent('menu-export-ch8', () => this.exportToCH8());
        window.electronAPI.onMenuEvent('menu-export-sp1', () => this.exportToSP1());
        window.electronAPI.onMenuEvent('menu-export-cyd-json', () => this.exportToCYDJson());
        window.electronAPI.onMenuEvent('menu-import-chr', () => document.getElementById('load-btn').click());
        window.electronAPI.onMenuEvent('menu-import-ch8', () => document.getElementById('load-btn').click());

        // Shortcuts
        window.onkeydown = (e) => {
            // DevTools shortcut: Ctrl+Shift+I (or Cmd+Shift+I on mac)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyI') {
                try { window.electronAPI.openDevTools(); } catch (err) { console.error('openDevTools failed', err); }
                return;
            }
            // Delete: clear selected area (fill with zeros)
            if (e.key === 'Delete') {
                e.preventDefault();
                this.clearSelection();
                return;
            }
            if (e.ctrlKey && e.code === 'KeyS' && !e.shiftKey) {
                e.preventDefault();
                document.getElementById('save-btn').click();
            } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyS') {
                e.preventDefault();
                document.getElementById('saveas-btn').click();
            } else if (e.ctrlKey && e.code === 'KeyC') {
                e.preventDefault();
                this.copySelection();
            } else if (e.ctrlKey && e.code === 'KeyV') {
                e.preventDefault();
                this.startPaste();
            } else if (e.ctrlKey && e.code === 'KeyZ') {
                e.preventDefault();
                this.undo();
            } else if ((e.ctrlKey && e.code === 'KeyY') || (e.ctrlKey && e.shiftKey && e.code === 'KeyZ')) {
                e.preventDefault();
                this.redo();
            } else if (!e.ctrlKey && e.key.toLowerCase() === 'h') {
                this.flipSelection('h');
            } else if (!e.ctrlKey && e.key.toLowerCase() === 'v') {
                this.flipSelection('v');
            } else if (!e.ctrlKey && e.key.toLowerCase() === 't') {
                this.setTool('text');
            } else if (e.key === 'Escape') {
                this.isPasting = false;
                this.selection = null;
                this.drawSelection();
                this.canvasWrapper.style.cursor = 'crosshair';
            } else if (e.key.toLowerCase() === 'p') {
                this.setTool('draw');
            } else if (e.key.toLowerCase() === 's') {
                this.setTool('select');
            }
        };
    }

    // ── Text Tool ────────────────────────────────────────────────────────────
    openTextModal(px, py) {
        this._textStampX = px;
        this._textStampY = py;
        const modal = document.getElementById('text-modal');
        modal.classList.remove('hidden');

        const updatePreview = () => {
            const text      = document.getElementById('text-input').value || 'A';
            const size      = parseInt(document.getElementById('text-size').value) || 16;
            const font      = document.getElementById('text-font').value;
            const bold      = document.getElementById('text-bold').checked ? 'bold ' : '';
            const italic    = document.getElementById('text-italic').checked ? 'italic ' : '';
            const threshold = parseInt(document.getElementById('text-threshold').value);
            document.getElementById('text-threshold-val').textContent = threshold;

            const offscreen = document.createElement('canvas');
            const octx = offscreen.getContext('2d');
            octx.font = `${italic}${bold}${size}px ${font}`;
            const metrics = octx.measureText(text);
            const w = Math.ceil(metrics.width) + 2;
            const h = size + 4;
            offscreen.width  = w;
            offscreen.height = h;
            octx.fillStyle = '#000';
            octx.fillRect(0, 0, w, h);
            octx.font = `${italic}${bold}${size}px ${font}`;
            octx.fillStyle = '#fff';
            octx.textBaseline = 'top';
            octx.fillText(text, 1, 1);

            // Binarize preview. Compute scale based on available preview width so it fits responsively.
            const prev = document.getElementById('text-preview-canvas');
            const panelW = (prev.clientWidth && prev.clientWidth > 0) ? prev.clientWidth : 220;
            const scale = Math.max(1, Math.floor(panelW / w));
            prev.width  = w * scale;
            prev.height = h * scale;
            const pctx = prev.getContext('2d');
            const imgD = octx.getImageData(0, 0, w, h);
            const out  = pctx.createImageData(prev.width, prev.height);
            for (let j = 0; j < h; j++) {
                for (let i = 0; i < w; i++) {
                    const r = imgD.data[(j * w + i) * 4];     // red = brightness
                    const on = r > threshold;
                    const v = on ? 255 : 0;
                    for (let sy = 0; sy < scale; sy++) {
                        for (let sx = 0; sx < scale; sx++) {
                            const idx = ((j * scale + sy) * prev.width + (i * scale + sx)) * 4;
                            out.data[idx] = v; out.data[idx+1] = v; out.data[idx+2] = v; out.data[idx+3] = 255;
                        }
                    }
                }
            }
            pctx.putImageData(out, 0, 0);
            this._textOffscreen = offscreen;
        };

        // Wire live preview inputs
        ['text-input','text-size','text-font','text-bold','text-italic','text-threshold'].forEach(id => {
            document.getElementById(id).oninput = updatePreview;
            document.getElementById(id).onchange = updatePreview;
        });
        updatePreview();

        document.getElementById('text-cancel').onclick = () => {
            modal.classList.add('hidden');
        };

        document.getElementById('text-apply').onclick = () => {
            modal.classList.add('hidden');
            const threshold = parseInt(document.getElementById('text-threshold').value);
            this.stampText(this._textOffscreen, this._textStampX, this._textStampY, threshold);
        };
    }

    stampText(offscreen, startX, startY, threshold) {
        if (!offscreen) return;
        this.saveHistory();
        const octx = offscreen.getContext('2d');
        const w = offscreen.width;
        const h = offscreen.height;
        const imgD = octx.getImageData(0, 0, w, h);
        const cols = this.width / 8;

        for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
                const tx = startX + i;
                const ty = startY + j;
                if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) continue;
                const r = imgD.data[(j * w + i) * 4];  // red = brightness
                if (r > threshold) {
                    this.pixels[ty * this.width + tx] = 1;
                    const attrIdx = Math.floor(ty / 8) * cols + Math.floor(tx / 8);
                    this.attributes[attrIdx] = this.computeAttrByte(attrIdx);
                }
            }
        }
        this.render();
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Flip ─────────────────────────────────────────────────────────────────
    flipSelection(dir) {
        if (!this.selection) return;
        this.saveHistory();

        const { x, y, w, h } = this.selection;
        const pw = w * 8;
        const ph = h * 8;
        const cols = this.width / 8;

        if (dir === 'h') {
            // Flip pixels horizontally (mirror each row)
            for (let j = 0; j < ph; j++) {
                const row = y * 8 + j;
                for (let i = 0; i < Math.floor(pw / 2); i++) {
                    const a = row * this.width + (x * 8 + i);
                    const b = row * this.width + (x * 8 + pw - 1 - i);
                    [this.pixels[a], this.pixels[b]] = [this.pixels[b], this.pixels[a]];
                }
            }
            // Flip attributes horizontally
            for (let j = 0; j < h; j++) {
                for (let i = 0; i < Math.floor(w / 2); i++) {
                    const a = (y + j) * cols + (x + i);
                    const b = (y + j) * cols + (x + w - 1 - i);
                    [this.attributes[a], this.attributes[b]] = [this.attributes[b], this.attributes[a]];
                }
            }
        } else {
            // Flip pixels vertically (mirror each column)
            for (let j = 0; j < Math.floor(ph / 2); j++) {
                for (let i = 0; i < pw; i++) {
                    const a = (y * 8 + j) * this.width + (x * 8 + i);
                    const b = (y * 8 + ph - 1 - j) * this.width + (x * 8 + i);
                    [this.pixels[a], this.pixels[b]] = [this.pixels[b], this.pixels[a]];
                }
            }
            // Flip attributes vertically
            for (let j = 0; j < Math.floor(h / 2); j++) {
                for (let i = 0; i < w; i++) {
                    const a = (y + j) * cols + (x + i);
                    const b = (y + h - 1 - j) * cols + (x + i);
                    [this.attributes[a], this.attributes[b]] = [this.attributes[b], this.attributes[a]];
                }
            }
        }

        this.render();
    }

    rotateSelection90() {
        if (!this.selection) {
            const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.no_selection_rotate']) ? this._currentLocaleMap['alert.no_selection_rotate'] : 'No selection to rotate.';
            alert(msg);
            return;
        }
        this.saveHistory();
        const { x: selX, y: selY, w: selW, h: selH } = this.selection;
        const oldPW = selW * 8, oldPH = selH * 8;

        // Read original pixels into temp
        const src = new Uint8Array(oldPW * oldPH);
        for (let j = 0; j < oldPH; j++) {
            for (let i = 0; i < oldPW; i++) {
                const gx = selX * 8 + i;
                const gy = selY * 8 + j;
                if (gx >= 0 && gx < this.width && gy >= 0 && gy < this.height) {
                    src[j * oldPW + i] = this.pixels[gy * this.width + gx];
                } else {
                    src[j * oldPW + i] = 0;
                }
            }
        }

        // Destination dims (rotated)
        const dstW = oldPH, dstH = oldPW;
        const dst = new Uint8Array(dstW * dstH);
        // Map: original (i,j) -> new (ni = j, nj = oldPW-1 - i)
        for (let j = 0; j < oldPH; j++) {
            for (let i = 0; i < oldPW; i++) {
                const v = src[j * oldPW + i];
                const ni = j;
                const nj = (oldPW - 1) - i;
                if (ni >= 0 && ni < dstW && nj >= 0 && nj < dstH) dst[nj * dstW + ni] = v;
            }
        }

        // Write dst back into canvas at same block origin, cropping if necessary
        const writeW = Math.min(dstW, this.width - selX * 8);
        const writeH = Math.min(dstH, this.height - selY * 8);
        for (let j = 0; j < writeH; j++) {
            for (let i = 0; i < writeW; i++) {
                const gx = selX * 8 + i;
                const gy = selY * 8 + j;
                this.pixels[gy * this.width + gx] = dst[j * dstW + i];
            }
        }

        // Rotate attributes grid (blocks)
        const oldCols = selW, oldRows = selH;
        const newCols = oldRows, newRows = oldCols;
        const srcAttrs = new Uint8Array(oldCols * oldRows);
        for (let by = 0; by < oldRows; by++) for (let bx = 0; bx < oldCols; bx++) {
            const gx = selX + bx;
            const gy = selY + by;
            srcAttrs[by * oldCols + bx] = this.attributes[gy * (this.width / 8) + gx];
        }
        const dstAttrs = new Uint8Array(newCols * newRows);
        for (let by = 0; by < oldRows; by++) {
            for (let bx = 0; bx < oldCols; bx++) {
                const attr = srcAttrs[by * oldCols + bx];
                const nbx = by;
                const nby = (oldCols - 1) - bx;
                dstAttrs[nby * newCols + nbx] = attr;
            }
        }

        // Write rotated attributes back (clamp to canvas blocks)
        const totalCols = this.width / 8;
        for (let nby = 0; nby < newRows; nby++) {
            for (let nbx = 0; nbx < newCols; nbx++) {
                const gx = selX + nbx;
                const gy = selY + nby;
                if (gx >= 0 && gx < totalCols && gy >= 0 && gy < (this.height/8)) {
                    this.attributes[gy * totalCols + gx] = dstAttrs[nby * newCols + nbx] || 0;
                }
            }
        }

        // Update selection dimensions (blocks) to swapped
        this.selection.w = newCols;
        this.selection.h = newRows;

        this.render();
        this.drawSelection();
    }

    invertPixels() {
        this.saveHistory();
        const cols = this.width / 8;
        if (this.selection) {
            const { x, y, w, h } = this.selection;
            for (let j = 0; j < h * 8; j++) {
                for (let i = 0; i < w * 8; i++) {
                    const idx = (y * 8 + j) * this.width + (x * 8 + i);
                    this.pixels[idx] = this.pixels[idx] ? 0 : 1;
                }
            }
        } else {
            for (let i = 0; i < this.pixels.length; i++) {
                this.pixels[i] = this.pixels[i] ? 0 : 1;
            }
        }
        this.render();
    }

    invertAttrs() {
        this.saveHistory();
        const cols = this.width / 8;
        const swapInkPaper = (attr) => {
            const f = (attr >> 7) & 1;
            const b = (attr >> 6) & 1;
            const paper = (attr >> 3) & 0x07;
            const ink = attr & 0x07;
            return (f << 7) | (b << 6) | (ink << 3) | paper;
        };
        if (this.selection) {
            const { x, y, w, h } = this.selection;
            for (let j = 0; j < h; j++) {
                for (let i = 0; i < w; i++) {
                    const idx = (y + j) * cols + (x + i);
                    this.attributes[idx] = swapInkPaper(this.attributes[idx]);
                }
            }
        } else {
            for (let i = 0; i < this.attributes.length; i++) {
                this.attributes[i] = swapInkPaper(this.attributes[i]);
            }
        }
        this.render();
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Animation Viewer ─────────────────────────────────────────────────────
    setupAnimationViewer() {
        document.getElementById('anim-frame-w').onchange = () => {
            this.animCurrentFrame = 0;
            this.resetAnimPlayer();
        };
        document.getElementById('anim-fps').onchange = () => {
            if (this.animInterval) { this.stopAnimation(); this.startAnimation(); }
        };
        document.getElementById('anim-play-btn').onclick = () => {
            if (this.animInterval) this.stopAnimation();
            else this.startAnimation();
        };
        document.getElementById('anim-prev-btn').onclick = () => {
            if (!this.clipboard) return;
            this.stopAnimation();
            const { frameW } = this.getAnimParams();
            const total = Math.max(1, Math.floor(this.clipboard.w / frameW));
            this.animCurrentFrame = (this.animCurrentFrame - 1 + total) % total;
            this.renderAnimFrame();
            this.selectCurrentAnimFrame();
        };
        document.getElementById('anim-next-btn').onclick = () => {
            if (!this.clipboard) return;
            this.stopAnimation();
            const { frameW } = this.getAnimParams();
            const total = Math.max(1, Math.floor(this.clipboard.w / frameW));
            this.animCurrentFrame = (this.animCurrentFrame + 1) % total;
            this.renderAnimFrame();
            this.selectCurrentAnimFrame();
        };
        this.renderAnimFrame();
        this.setupAnimDrawing();
    }

    setupAnimDrawing() {
        const canvas = document.getElementById('anim-canvas');
        if (!canvas) return;
        canvas.style.cursor = 'crosshair';

        let isAnimDrawing = false;

        const paintOnAnim = (e) => {
            if (!this.clipboard || this.clipboard.originX === undefined) return;

            const rect = canvas.getBoundingClientRect();
            const { frameW } = this.getAnimParams();
            const { w, h } = this.clipboard;
            const totalFrames = Math.max(1, Math.floor(w / frameW));
            const frameIdx = this.animCurrentFrame % totalFrames;

            const fPixW = frameW * 8;
            const fPixH = h * 8;
            if (canvas.width === 0 || canvas.height === 0) return;
            const scaleX = rect.width / fPixW;
            const scaleY = rect.height / fPixH;

            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            const px = Math.floor(cx / scaleX);
            const py = Math.floor(cy / scaleY);

            if (px < 0 || px >= fPixW || py < 0 || py >= fPixH) return;

            const pixVal = (e.buttons & 1) ? 1 : (e.buttons & 2) ? 0 : -1;
            if (pixVal === -1) return;

            // Map to main canvas coords
            const mainX = this.clipboard.originX * 8 + frameIdx * fPixW + px;
            const mainY = this.clipboard.originY * 8 + py;
            if (mainX < 0 || mainX >= this.width || mainY < 0 || mainY >= this.height) return;

            // Paint on main canvas
            this.pixels[mainY * this.width + mainX] = pixVal;

            const bx = Math.floor(mainX / 8);
            const by = Math.floor(mainY / 8);
            const attrIdx = by * (this.width / 8) + bx;
            this.attributes[attrIdx] = this.computeAttrByte(attrIdx);

            // Keep clipboard in sync so the preview reflects the change immediately
            const clipSrcX = frameIdx * fPixW + px;
            this.clipboard.pixels[py * (w * 8) + clipSrcX] = pixVal;
            const clipBx = Math.floor(clipSrcX / 8);
            const clipBy = Math.floor(py / 8);
            this.clipboard.attributes[clipBy * w + clipBx] = this.attributes[attrIdx];

            this.render();
            this.renderAnimFrame();
        };

        canvas.addEventListener('mousedown', (e) => {
            if (!this.clipboard || this.clipboard.originX === undefined) return;
            e.preventDefault();
            if (this.animInterval) this.stopAnimation();
            isAnimDrawing = true;
            this.saveHistory();
            paintOnAnim(e);
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!isAnimDrawing) return;
            e.preventDefault();
            paintOnAnim(e);
        });

        canvas.addEventListener('mouseup', () => { isAnimDrawing = false; });
        canvas.addEventListener('mouseleave', () => { isAnimDrawing = false; });
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // ── Internationalization ─────────────────────────────────────────────
    setupI18n() {
        const select = document.getElementById('lang-select');
        if (!select) return;
        const saved = localStorage.getItem('zxdrawer_lang') || (navigator.language || 'en').slice(0,2);
        const lang = ['en','es','pt'].includes(saved) ? saved : 'en';
        select.value = lang;

        // Wire language selector (works for both sync and async paths)
        select.onchange = (e) => {
            const l = e.target.value;
            localStorage.setItem('zxdrawer_lang', l);
            this.loadLocale(l).then(map => {
                this.applyTranslationsMap(map);
                try { if (window.electronAPI && typeof window.electronAPI.setAppLanguage === 'function') window.electronAPI.setAppLanguage(l); } catch (err) { console.warn('setAppLanguage failed', err); }
            });
        };

        // Synchronous fast-path via preload — avoids async latency on startup.
        // Works in both dev and packaged builds as long as preload is NOT bundled.
        if (window.electronAPI && typeof window.electronAPI.getLocale === 'function') {
            try {
                const map = window.electronAPI.getLocale(lang);
                if (map) {
                    if (!this.locales) this.locales = {};
                    this.locales[lang] = map;
                    this.applyTranslationsMap(map);
                    return; // done synchronously, no async needed
                }
            } catch(e) { console.warn('sync getLocale failed', e); }
        }
        // Fallback: async fetch (e.g. browser/web context without preload)
        this.loadLocale(lang).then(map => this.applyTranslationsMap(map));
    }
    async loadLocale(lang) {
        if (!this.locales) this.locales = {};
        if (this.locales[lang]) return this.locales[lang];
        // Fast path: ask preload (fs) to load bundled locale synchronously
        try {
            if (window.electronAPI && typeof window.electronAPI.getLocale === 'function') {
                const local = window.electronAPI.getLocale(lang);
                if (local) {
                    this.locales[lang] = local;
                    return local;
                }
            }
        } catch (e) {
            console.warn('preload getLocale not available or failed', e);
        }

        // Fallback to fetch if preload path not available
        try {
            const url = new URL(`locales/${lang}.json`, window.location.href).href;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Locale not found');
            const json = await res.json();
            this.locales[lang] = json;
            return json;
        } catch (e) {
            console.error('i18n: failed to load locale', lang, e);
            if (lang !== 'en') return this.loadLocale('en');
            this.locales['en'] = FALLBACK_TRANSLATIONS.en;
            return FALLBACK_TRANSLATIONS.en;
        }
    }

    applyTranslationsMap(map) {
        if (!map) return;
        // keep reference to current locale map for runtime strings
        this._currentLocaleMap = map;
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const txt = map[key];
            if (!txt) return;
            const tag = el.tagName.toLowerCase();
            // Inputs and textareas: set placeholder when present
            if (tag === 'input' || tag === 'textarea') {
                if (el.hasAttribute('placeholder')) el.setAttribute('placeholder', txt);
                else el.value = txt;
            } else if (tag === 'button') {
                // If the button contains another element with data-i18n (e.g. a <span>), let
                // that child be updated instead. For SVG buttons, prefer setting the title.
                if (el.querySelector('[data-i18n]')) {
                    // child will be updated separately
                } else if (el.querySelector('svg')) {
                    el.setAttribute('title', txt);
                } else {
                    el.textContent = txt;
                }
            } else if (el.hasAttribute('title')) {
                el.setAttribute('title', txt);
            } else {
                el.textContent = txt;
            }
        });
        // Refresh status texts to use new locale (use last known mouse coords if available)
        try {
            const lx = (this._lastMouseX !== undefined) ? this._lastMouseX : 0;
            const ly = (this._lastMouseY !== undefined) ? this._lastMouseY : 0;
            this.updateStatus(lx, ly);
        } catch (e) { /* ignore */ }
    }

    getAnimParams() {
        const frameW = Math.max(1, parseInt(document.getElementById('anim-frame-w').value) || 1);
        const fps    = Math.max(1, parseInt(document.getElementById('anim-fps').value) || 8);
        return { frameW, fps };
    }

    resetAnimPlayer() {
        if (this.animInterval) { this.stopAnimation(); this.startAnimation(); }
        else this.renderAnimFrame();
    }

    startAnimation() {
        if (!this.clipboard) return;
        this.stopAnimation();
        this.renderAnimFrame();
        const tick = () => {
            const { frameW } = this.getAnimParams();
            const total = Math.max(1, Math.floor(this.clipboard.w / frameW));
            this.animCurrentFrame = (this.animCurrentFrame + 1) % total;
            this.renderAnimFrame();
        };
        const { fps } = this.getAnimParams();
        this.animInterval = setInterval(tick, 1000 / fps);
        const labelEl = document.getElementById('anim-play-label');
        const stopTxt = (this._currentLocaleMap && this._currentLocaleMap['btn.stop']) ? this._currentLocaleMap['btn.stop'] : 'Stop';
        if (labelEl) labelEl.textContent = '\u23F9 ' + stopTxt;
        else document.getElementById('anim-play-btn').textContent = '\u23F9 ' + stopTxt;
    }

    stopAnimation() {
        if (this.animInterval) { clearInterval(this.animInterval); this.animInterval = null; }
        const labelEl = document.getElementById('anim-play-label');
        const playTxt = (this._currentLocaleMap && this._currentLocaleMap['btn.play']) ? this._currentLocaleMap['btn.play'] : 'Play';
        if (labelEl) labelEl.textContent = '\u25B6 ' + playTxt;
        else document.getElementById('anim-play-btn').textContent = '\u25B6 ' + playTxt;
    }

    selectCurrentAnimFrame() {
        if (!this.clipboard || this.clipboard.originX === undefined) return;
        const { frameW } = this.getAnimParams();
        const total = Math.max(1, Math.floor(this.clipboard.w / frameW));
        const frameIdx = this.animCurrentFrame % total;
        this.selection = {
            x: this.clipboard.originX + frameIdx * frameW,
            y: this.clipboard.originY,
            w: frameW,
            h: this.clipboard.h
        };
        this.drawSelection();
    }

    renderAnimFrame() {
        const canvas = document.getElementById('anim-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        if (!this.clipboard) {
            canvas.width = 64; canvas.height = 32;
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, 64, 32);
            const infoEl = document.getElementById('anim-info');
            const noSel = (this._currentLocaleMap && this._currentLocaleMap['anim.no_selection']) ? this._currentLocaleMap['anim.no_selection'] : 'Copy a selection to preview';
            if (infoEl) infoEl.textContent = noSel;
            return;
        }

        const { frameW } = this.getAnimParams();
        const { pixels, attributes, w, h } = this.clipboard;
        const totalFrames = Math.max(1, Math.floor(w / frameW));
        const frameIdx    = this.animCurrentFrame % totalFrames;

        const fPixW = frameW * 8;
        const fPixH = h * 8;
        const panelW = 220;
        const scale  = Math.max(1, Math.floor(panelW / fPixW));

        canvas.width  = fPixW * scale;
        canvas.height = fPixH * scale;

        const imgData = ctx.createImageData(canvas.width, canvas.height);
        const data = imgData.data;

        for (let py = 0; py < fPixH; py++) {
            for (let px = 0; px < fPixW; px++) {
                const srcX = frameIdx * fPixW + px;
                if (srcX >= w * 8) continue;
                const bx = Math.floor(srcX / 8);
                const by = Math.floor(py / 8);
                const attr  = attributes[by * w + bx] || 0;
                const flash  = (attr >> 7) & 1;
                const bright = (attr >> 6) & 1;
                const ink    = attr & 0x07;
                const paper  = (attr >> 3) & 0x07;
                let inkC   = this.hexToRgb(SPECTRUM_PALETTE[bright][ink]);
                let paperC = this.hexToRgb(SPECTRUM_PALETTE[bright][paper]);
                if (flash && this.flashInverted) [inkC, paperC] = [paperC, inkC];
                const color = pixels[py * (w * 8) + srcX] ? inkC : paperC;
                for (let sy = 0; sy < scale; sy++) {
                    for (let sx = 0; sx < scale; sx++) {
                        const i = ((py * scale + sy) * canvas.width + (px * scale + sx)) * 4;
                        data[i] = color.r; data[i+1] = color.g; data[i+2] = color.b; data[i+3] = 255;
                    }
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);

        // Pixel grid (1x1)
        if (this.pixelGridVisible && scale > 1) {
            ctx.strokeStyle = 'rgba(100, 100, 100, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = 0; x <= canvas.width; x += scale) {
                ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
            }
            for (let y = 0; y <= canvas.height; y += scale) {
                ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
            }
            ctx.stroke();
        }

        // Char grid (8x8)
        if (this.gridVisible) {
            ctx.strokeStyle = '#D7D700';
            ctx.lineWidth = 1;
            ctx.beginPath();
            const charStep = 8 * scale;
            for (let x = 0; x <= canvas.width; x += charStep) {
                ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
            }
            for (let y = 0; y <= canvas.height; y += charStep) {
                ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
            }
            ctx.stroke();
        }

        document.getElementById('anim-info').textContent =
            `Frame ${frameIdx + 1}/${totalFrames} · ${frameW}×${h} blocks`;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Undo / Redo ──────────────────────────────────────────────────────────
    saveHistory() {
        const MAX = 50;
        this.undoStack.push({
            width: this.width,
            height: this.height,
            pixels: this.pixels.slice(),
            attributes: this.attributes.slice()
        });
        if (this.undoStack.length > MAX) this.undoStack.shift();
        this.redoStack = [];
        this.setDirty(true);
    }

    setDirty(isDirty) {
        this._isDirty = isDirty;
        try { window.electronAPI.setDocumentDirty(isDirty); } catch(e) {}
        this.updateFilepathStatus();
    }

    updateFilepathStatus() {
        try {
            const el = document.getElementById('status-filepath');
            if (!el) return;
            if (this.currentFilePath) {
                el.textContent = this.currentFilePath;
                el.title = this.currentFilePath;
            } else {
                el.textContent = '';
                el.title = '';
            }
        } catch(e) {}
    }

    undo() {
        if (!this.undoStack.length) return;
        this.redoStack.push({
            width: this.width,
            height: this.height,
            pixels: this.pixels.slice(),
            attributes: this.attributes.slice()
        });
        const state = this.undoStack.pop();
        this.width = state.width || this.width;
        this.height = state.height || this.height;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.gridCanvas.width = this.width;
        this.gridCanvas.height = this.height;
        this.selCanvas.width = this.width;
        this.selCanvas.height = this.height;
        this.pixels = state.pixels;
        this.attributes = state.attributes;
        this.updateZoom();
        this.render();
    }

    redo() {
        if (!this.redoStack.length) return;
        this.undoStack.push({
            width: this.width,
            height: this.height,
            pixels: this.pixels.slice(),
            attributes: this.attributes.slice()
        });
        const state = this.redoStack.pop();
        this.width = state.width || this.width;
        this.height = state.height || this.height;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.gridCanvas.width = this.width;
        this.gridCanvas.height = this.height;
        this.selCanvas.width = this.width;
        this.selCanvas.height = this.height;
        this.pixels = state.pixels;
        this.attributes = state.attributes;
        this.updateZoom();
        this.render();
    }
    // ─────────────────────────────────────────────────────────────────────────

    getCurrentAttrByte() {
        // F B P P P I I I
        // F B P P P I I I
        // Fallback to defaults if any component is null
        const f = (this.flash != null) ? this.flash : 0;
        const b = (this.bright != null) ? this.bright : 0;
        const p = (this.paper != null) ? this.paper : 0;
        const i = (this.ink != null) ? this.ink : 7;
        return (f << 7) | (b << 6) | (p << 3) | i;
    }

    computeAttrByte(attrIdx) {
        // Merge selected components with existing attribute at attrIdx.
        const existing = (typeof attrIdx === 'number' && this.attributes && this.attributes[attrIdx] != null)
            ? this.attributes[attrIdx]
            : 0;
        const exF = (existing >> 7) & 1;
        const exB = (existing >> 6) & 1;
        const exP = (existing >> 3) & 0x07;
        const exI = existing & 0x07;

        const f = (this.flash != null) ? this.flash : exF;
        const b = (this.bright != null) ? this.bright : exB;
        const p = (this.paper != null) ? this.paper : exP;
        const i = (this.ink != null) ? this.ink : exI;

        return (f << 7) | (b << 6) | (p << 3) | i;
    }

    setTool(tool) {
        this.currentTool = tool;
        this.isPasting = false;

        // Clicking select clears any existing selection and resets the preview
        if (tool === 'select') {
            this.selection = null;
            this.clipboard = null;
            this.animCurrentFrame = 0;
            this.renderAnimFrame();
        }

        document.querySelectorAll('.tool').forEach(t => t.classList.remove('active'));
        if (document.getElementById(`tool-${tool}`)) {
            document.getElementById(`tool-${tool}`).classList.add('active');
        }
        
        // Update cursor
        const cursorMap = { select: 'cell', text: 'text' };
        this.canvasWrapper.style.cursor = cursorMap[tool] || 'crosshair';
        
        this.drawSelection();
    }

    updateZoom() {
        this.canvas.style.width = (this.width * this.zoom) + 'px';
        this.canvas.style.height = (this.height * this.zoom) + 'px';
        
        // Grid canvas should have actual pixel resolution for sharpness
        this.gridCanvas.width = this.width * this.zoom;
        this.gridCanvas.height = this.height * this.zoom;
        this.gridCanvas.style.width = (this.width * this.zoom) + 'px';
        this.gridCanvas.style.height = (this.height * this.zoom) + 'px';

        this.selCanvas.width = this.width * this.zoom;
        this.selCanvas.height = this.height * this.zoom;
        this.selCanvas.style.width = (this.width * this.zoom) + 'px';
        this.selCanvas.style.height = (this.height * this.zoom) + 'px';
        
        document.getElementById('zoom-level').innerText = (this.zoom * 100) + '%';
        const sbLabel = document.getElementById('zoom-level-sb');
        if (sbLabel) sbLabel.innerText = (this.zoom * 100) + '%';
        this.drawGrid();
        this.drawSelection();
    }

    updateUI() {
        const brightIndex = (this.bright != null) ? this.bright : 0;
        const normalPalette = SPECTRUM_PALETTE[brightIndex];

        const paperIndex = (this.paper != null) ? this.paper : 0;
        const inkIndex = (this.ink != null) ? this.ink : 7;

        const preview = document.getElementById('current-attr-preview');
        if (preview) {
            preview.style.backgroundColor = normalPalette[paperIndex];
            preview.style.color = normalPalette[inkIndex];
            preview.innerText = 'Aa';
        }

        const attrInfoEl = document.getElementById('attr-info');
        if (attrInfoEl) {
            attrInfoEl.innerText = `Ink: ${this.ink != null ? this.ink : '-'}, Paper: ${this.paper != null ? this.paper : '-'}, B: ${this.bright != null ? this.bright : '-'}, F: ${this.flash != null ? this.flash : '-'}`;
        }
        
        if (this.isPasting) {
            this.drawSelection();
        }

        // Update palette colors to reflect Bright toggle
        const brightForPalette = (this.bright != null) ? this.bright : 0;
        document.querySelectorAll('#ink-palette .color-swatch').forEach((s, i) => {
            s.style.backgroundColor = SPECTRUM_PALETTE[brightForPalette][i];
        });
        document.querySelectorAll('#paper-palette .color-swatch').forEach((s, i) => {
            s.style.backgroundColor = SPECTRUM_PALETTE[brightForPalette][i];
        });

        // Sync selects to internal state: 'keep'|'1'|'0'
        const brightToggle = document.getElementById('bright-toggle');
        const flashToggle = document.getElementById('flash-toggle');
        if (brightToggle) brightToggle.value = (this.bright === 1) ? '1' : (this.bright === 0 ? '0' : 'keep');
        if (flashToggle) flashToggle.value = (this.flash === 1) ? '1' : (this.flash === 0 ? '0' : 'keep');

        const useAttrToggle = document.getElementById('use-current-attr-toggle');
        if (useAttrToggle) useAttrToggle.checked = this.useCurrentAttr;

        const inkPalette = document.getElementById('ink-palette');
        const paperPalette = document.getElementById('paper-palette');
        if (this.useCurrentAttr) {
            if (inkPalette) { inkPalette.style.pointerEvents = 'none'; inkPalette.style.opacity = '0.4'; }
            if (paperPalette) { paperPalette.style.pointerEvents = 'none'; paperPalette.style.opacity = '0.4'; }
            if (brightToggle) brightToggle.disabled = true;
            if (flashToggle) flashToggle.disabled = true;
        } else {
            if (inkPalette) { inkPalette.style.pointerEvents = ''; inkPalette.style.opacity = '1'; }
            if (paperPalette) { paperPalette.style.pointerEvents = ''; paperPalette.style.opacity = '1'; }
            if (brightToggle) brightToggle.disabled = false;
            if (flashToggle) flashToggle.disabled = false;
        }
    }

    updateStatus(x, y) {
        // remember last coords so UI can be refreshed when language changes
        this._lastMouseX = x;
        this._lastMouseY = y;
        // Use localized templates when available
        const map = this._currentLocaleMap || {};
        const coordsTpl = map['status.coords'] || 'X: {x} Y: {y}';
        const blockTpl = map['status.block'] || 'Block: {bx}, {by}';
        const sizeTpl = map['status.size'] || 'Size: {w}x{h}';

        const bx = Math.floor(x / 8);
        const by = Math.floor(y / 8);

        const coordsText = coordsTpl.replace('{x}', x).replace('{y}', y);
        const blockText = blockTpl.replace('{bx}', bx).replace('{by}', by);
        const sizeText = sizeTpl.replace('{w}', this.width).replace('{h}', this.height);

        document.getElementById('status-coords').innerText = coordsText;
        document.getElementById('status-block').innerText = blockText;
        document.getElementById('status-size').innerText = sizeText;

        // Update selection size: show pixels and character blocks (8x8) using localized formats
        try {
            const selEl = document.getElementById('status-selection');
            if (!selEl) return;

            let selWpx = 0, selHpx = 0, selWchars = 0, selHchars = 0;
            if (this.isPasting && this.clipboard) {
                selWchars = this.clipboard.w || 0;
                selHchars = this.clipboard.h || 0;
                selWpx = selWchars * 8;
                selHpx = selHchars * 8;
            } else if (this.selection) {
                selWchars = this.selection.w || 0;
                selHchars = this.selection.h || 0;
                selWpx = selWchars * 8;
                selHpx = selHchars * 8;
            }

            if (selWchars > 0 && selHchars > 0) {
                const fmt = map['status.selection_fmt'] || 'Selection: {px}x{py} px ({cw}x{ch} chars)';
                selEl.innerText = fmt.replace('{px}', selWpx).replace('{py}', selHpx).replace('{cw}', selWchars).replace('{ch}', selHchars);
            } else {
                selEl.innerText = map['status.selection_empty'] || 'Selection: -';
            }
        } catch (e) { /* ignore UI update errors */ }
    }

    drawGrid() {
        this.gridCtx.clearRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);

        // Pixel grid (1x1) — draw first so char grid renders on top
        if (this.pixelGridVisible) {
            this.gridCtx.strokeStyle = 'rgba(100, 100, 100, 0.5)';
            this.gridCtx.lineWidth = 1;
            this.gridCtx.beginPath();
            const pStep = this.zoom;
            for (let x = 0; x <= this.gridCanvas.width; x += pStep) {
                this.gridCtx.moveTo(x, 0);
                this.gridCtx.lineTo(x, this.gridCanvas.height);
            }
            for (let y = 0; y <= this.gridCanvas.height; y += pStep) {
                this.gridCtx.moveTo(0, y);
                this.gridCtx.lineTo(this.gridCanvas.width, y);
            }
            this.gridCtx.stroke();
        }

        if (!this.gridVisible) return;
        
        // Golden Spectrum color
        this.gridCtx.strokeStyle = '#D7D700'; 
        this.gridCtx.lineWidth = 1;

        this.gridCtx.beginPath();
        // 8x8 blocks scaled by zoom
        const step = 8 * this.zoom;
        
        for (let x = 0; x <= this.gridCanvas.width; x += step) {
            this.gridCtx.moveTo(x, 0);
            this.gridCtx.lineTo(x, this.gridCanvas.height);
        }
        for (let y = 0; y <= this.gridCanvas.height; y += step) {
            this.gridCtx.moveTo(0, y);
            this.gridCtx.lineTo(this.gridCanvas.width, y);
        }
        this.gridCtx.stroke();
    }

    drawSelection() {
        this.selCtx.clearRect(0, 0, this.selCanvas.width, this.selCanvas.height);
        
        let area = null;
        let color = '#fff';

        if (this.isPasting && this.clipboard) {
            area = {
                x: this.pastePos.bx,
                y: this.pastePos.by,
                w: this.clipboard.w,
                h: this.clipboard.h
            };
            color = '#00ff00'; // Green for paste preview
        } else if (this.selection) {
            area = this.selection;
        }

        if (area) {
            this.selCtx.strokeStyle = color;
            this.selCtx.setLineDash([5, 5]);
            this.selCtx.lineWidth = 2;
            this.selCtx.strokeRect(
                area.x * 8 * this.zoom,
                area.y * 8 * this.zoom,
                area.w * 8 * this.zoom,
                area.h * 8 * this.zoom
            );
        }
    }

    // Clipboard Logic
    copySelection() {
        if (!this.selection) {
            const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.selection_required']) ? this._currentLocaleMap['alert.selection_required'] : 'Selection required! Switch to select tool (S) and drag an area.';
            alert(msg);
            return;
        }

        const { x, y, w, h } = this.selection;
        const clipPixels = new Uint8Array(w * 8 * h * 8);
        const clipAttrs = new Uint8Array(w * h);

        try {
            for (let j = 0; j < h * 8; j++) {
                for (let i = 0; i < w * 8; i++) {
                    const px = (x * 8 + i);
                    const py = (y * 8 + j);
                    clipPixels[j * (w * 8) + i] = this.pixels[py * this.width + px];
                }
            }

            for (let j = 0; j < h; j++) {
                for (let i = 0; i < w; i++) {
                    clipAttrs[j * w + i] = this.attributes[(y+j) * (this.width / 8) + (x+i)];
                }
            }

            this.clipboard = { pixels: clipPixels, attributes: clipAttrs, w, h, originX: x, originY: y };
            this.animCurrentFrame = 0;
            this.renderAnimFrame();
            this.selection = null; // Clear selection after copy
            this.drawSelection();

            // Persist to shared clipboard so other instances can paste
            if (window.electronAPI && typeof window.electronAPI.setClipboard === 'function') {
                window.electronAPI.setClipboard({
                    pixels: Array.from(clipPixels),
                    attributes: Array.from(clipAttrs),
                    w, h, originX: x, originY: y
                }).catch(e => console.warn('setClipboard failed', e));
            }
        } catch (e) {
            console.error('Copy failed', e);
            const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.selection_error']) ? this._currentLocaleMap['alert.selection_error'] : 'Selection error. Try staying within bounds.';
            alert(msg);
        }
    }

    clearSelection() {
        if (!this.selection) return;
        this.saveHistory();
        const { x, y, w, h } = this.selection;
        for (let j = 0; j < h * 8; j++) {
            for (let i = 0; i < w * 8; i++) {
                const px = x * 8 + i;
                const py = y * 8 + j;
                if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
                    this.pixels[py * this.width + px] = 0;
                }
            }
        }
        // Keep attributes as-is; only clear pixels.
        this.render();
        this.selection = null;
        this.drawSelection();
    }

    async startPaste() {
        // Always try to load from shared clipboard (cross-instance) so that
        // content copied in another window is picked up even when a local
        // clipboard already exists from a previous copy in this instance.
        if (window.electronAPI && typeof window.electronAPI.getClipboard === 'function') {
            try {
                const shared = await window.electronAPI.getClipboard();
                if (shared) {
                    this.clipboard = {
                        pixels: new Uint8Array(shared.pixels),
                        attributes: new Uint8Array(shared.attributes),
                        w: shared.w,
                        h: shared.h,
                        originX: shared.originX,
                        originY: shared.originY
                    };
                    this.animCurrentFrame = 0;
                    this.renderAnimFrame();
                }
            } catch (e) { console.warn('getClipboard failed', e); }
        }
        if (!this.clipboard) {
            const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.no_content_copied']) ? this._currentLocaleMap['alert.no_content_copied'] : 'No content copied. Select an area and press Ctrl+C.';
            alert(msg);
            return;
        }
        this.currentTool = 'draw'; // Switch tool without clearing isPasting
        document.querySelectorAll('.tool').forEach(t => t.classList.remove('active'));
        if (document.getElementById('tool-draw')) {
            document.getElementById('tool-draw').classList.add('active');
        }
        this.isPasting = true;
        this.canvasWrapper.style.cursor = 'move';
        this.drawSelection();
    }

    executePaste(bx, by) {
        if (!this.clipboard) return;
        
        const { pixels, attributes, w, h } = this.clipboard;

        for (let j = 0; j < h * 8; j++) {
            for (let i = 0; i < w * 8; i++) {
                const tx = (bx * 8 + i);
                const ty = (by * 8 + j);
                if (tx < this.width && ty < this.height) {
                    this.pixels[ty * this.width + tx] = pixels[j * (w * 8) + i];
                }
            }
        }

        for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
                const tbx = bx + i;
                const tby = by + j;
                if (tbx < (this.width / 8) && tby < (this.height / 8)) {
                    this.attributes[tby * (this.width / 8) + tbx] = attributes[j * w + i];
                }
            }
        }

        this.isPasting = false;
        this.canvasWrapper.style.cursor = 'crosshair';
        this.render();
        this.drawSelection();
    }

    render() {
        const imageData = this.ctx.createImageData(this.width, this.height);
        const data = imageData.data;

        for (let by = 0; by < this.height / 8; by++) {
            for (let bx = 0; bx < this.width / 8; bx++) {
                const attr = this.attributes[by * (this.width / 8) + bx];
                const flash = (attr >> 7) & 0x01;
                const ink = attr & 0x07;
                const paper = (attr >> 3) & 0x07;
                const bright = (attr >> 6) & 0x01;
                
                let inkColor = this.hexToRgb(SPECTRUM_PALETTE[bright][ink]);
                let paperColor = this.hexToRgb(SPECTRUM_PALETTE[bright][paper]);

                if (flash && this.flashInverted) {
                    [inkColor, paperColor] = [paperColor, inkColor];
                }

                for (let py = 0; py < 8; py++) {
                    for (let px = 0; px < 8; px++) {
                        const x = bx * 8 + px;
                        const y = by * 8 + py;
                        const isSet = this.pixels[y * this.width + x];
                        const color = isSet ? inkColor : paperColor;
                        
                        const idx = (y * this.width + x) * 4;
                        data[idx] = color.r;
                        data[idx + 1] = color.g;
                        data[idx + 2] = color.b;
                        data[idx + 3] = 255;
                    }
                }
            }
        }
        this.ctx.putImageData(imageData, 0, 0);
    }

    hexToRgb(hex) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return { r, g, b };
    }

    // .scr Format Logic (ZX Spectrum screen dump, 6912 bytes)
    importFromSCR(bytes) {
        if (bytes.length < 6912) {
            const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.invalid_scr']) ? this._currentLocaleMap['alert.invalid_scr'] : 'Invalid .scr file (must be 6912 bytes).';
            alert(msg);
            return;
        }
        this.resetData(256, 192);

        // Bitmap: 6144 bytes stored in ZX Spectrum display file layout
        // Address bits: [12:11]=third [10:8]=pixel_row_in_char [7:5]=char_row_in_third [4:0]=col_byte
        for (let i = 0; i < 6144; i++) {
            const third    = (i >> 11) & 0x03;
            const pixelRow = (i >> 8)  & 0x07;
            const charRow  = (i >> 5)  & 0x07;
            const colByte  = i & 0x1F;
            const y = third * 64 + charRow * 8 + pixelRow;
            const xStart = colByte * 8;
            const b = bytes[i];
            for (let bit = 0; bit < 8; bit++) {
                this.pixels[y * 256 + xStart + bit] = (b >> (7 - bit)) & 1;
            }
        }

        // Attributes: 768 bytes, sequential row by row (32 cols × 24 rows)
        for (let i = 0; i < 768; i++) {
            this.attributes[i] = bytes[6144 + i];
        }
    }

    // .zxp Format Logic
    async exportPng() {
        const dataURL = this.canvas.toDataURL('image/png');
        await window.electronAPI.exportPng(dataURL);
    }

    generateScrBytes() {
        // Only support standard Spectrum 256x192 .scr files
        if (this.width !== 256 || this.height !== 192) {
            throw new Error((this._currentLocaleMap && this._currentLocaleMap['alert.export_scr_size']) ? this._currentLocaleMap['alert.export_scr_size'] : 'Export to .scr requires a 256x192 canvas.');
        }

        // Build bitmap 6144 bytes in Spectrum memory layout
        const bmp = new Uint8Array(6144);
        const bytesPerLine = this.width / 8; // 32
        for (let y = 0; y < 192; y++) {
            const block = ((y & 0xC0) >> 6); // 0..2
            const rowInBlock = (y & 0x38) >> 3; // 0..7
            const lineInChar = y & 0x07; // 0..7
            for (let xb = 0; xb < bytesPerLine; xb++) {
                let val = 0;
                const bx = xb * 8;
                for (let b = 0; b < 8; b++) {
                    const px = bx + b;
                    if (this.pixels[y * this.width + px]) val |= (1 << (7 - b));
                }
                const addr = block * 2048 + lineInChar * 256 + rowInBlock * 32 + xb;
                bmp[addr] = val;
            }
        }

        // Build attributes 768 bytes (24 rows x 32 cols)
        const attrBuf = new Uint8Array(768);
        const attrCols = this.width / 8; //32
        const attrRows = this.height / 8; //24
        for (let by = 0; by < attrRows; by++) {
            for (let bx = 0; bx < attrCols; bx++) {
                const idx = by * attrCols + bx;
                attrBuf[idx] = this.attributes[idx] || 0;
            }
        }

        // Combine into .scr (6144 + 768 = 6912)
        const scr = new Uint8Array(6912);
        scr.set(bmp, 0);
        scr.set(attrBuf, 6144);
        
        return scr;
    }

    async exportScr() {
        try {
            const scr = this.generateScrBytes();

            // Use preload helper to write binary
            if (window.electronAPI && typeof window.electronAPI.exportBin === 'function') {
                await window.electronAPI.exportBin(scr, 'screen.scr');
            } else {
                // Fallback: save via saveFile (base64) — convert to string of bytes
                const s = Array.from(scr).map(b => String.fromCharCode(b)).join('');
                await window.electronAPI.saveFile(s, 'screen.scr');
            }
        } catch (e) {
            console.error('exportScr failed', e);
            const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.export_scr_failed']) ? this._currentLocaleMap['alert.export_scr_failed'] : 'Export to .scr failed.';
            alert(e.message || msg);
        }
    }

    // .chr Format Logic (raw 8×8 character/tile bitmaps, no attributes)
    importFromCHR(bytes) {
        if (!bytes || bytes.length === 0 || bytes.length % 8 !== 0) {
            const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.invalid_chr']) || 'Invalid .chr file (size must be a multiple of 8).';
            alert(msg);
            return;
        }
        const numChars = bytes.length / 8;
        const charsPerRow = 16;
        const cols = Math.min(numChars, charsPerRow);
        const rows = Math.ceil(numChars / charsPerRow);
        const w = cols * 8;
        const h = rows * 8;
        this.resetData(w, h);
        for (let ci = 0; ci < numChars; ci++) {
            const cx = (ci % charsPerRow) * 8;
            const cy = Math.floor(ci / charsPerRow) * 8;
            for (let row = 0; row < 8; row++) {
                const b = bytes[ci * 8 + row];
                for (let bit = 0; bit < 8; bit++) {
                    this.pixels[(cy + row) * w + cx + bit] = (b >> (7 - bit)) & 1;
                }
            }
        }
    }

    generateChrBytes() {
        const charsX = this.width / 8;
        const charsY = this.height / 8;
        const out = new Uint8Array(charsX * charsY * 8);
        for (let cy = 0; cy < charsY; cy++) {
            for (let cx = 0; cx < charsX; cx++) {
                const ci = cy * charsX + cx;
                for (let row = 0; row < 8; row++) {
                    let b = 0;
                    for (let bit = 0; bit < 8; bit++) {
                        if (this.pixels[(cy * 8 + row) * this.width + cx * 8 + bit]) b |= (1 << (7 - bit));
                    }
                    out[ci * 8 + row] = b;
                }
            }
        }
        return out;
    }

    async exportToCHR() {
        try {
            const chr = this.generateChrBytes();
            await window.electronAPI.exportChr(Array.from(chr), 'export.chr');
        } catch (e) {
            console.error('exportToCHR failed', e);
            const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.export_chr_failed']) || 'Export to .chr failed.';
            alert(e.message || msg);
        }
    }

    async exportToCH8() {
        try {
            const ch8 = this.generateChrBytes();
            await window.electronAPI.exportCh8(Array.from(ch8), 'export.ch8');
        } catch (e) {
            console.error('exportToCH8 failed', e);
            const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.export_ch8_failed']) || 'Export to .ch8 failed.';
            alert(e.message || msg);
        }
    }

    exportToSP1() {
        const modal = document.getElementById('sp1-modal');
        modal.classList.remove('hidden');

        document.getElementById('sp1-cancel').onclick = () => {
            modal.classList.add('hidden');
        };

        document.getElementById('sp1-apply').onclick = async () => {
            const spriteName = (document.getElementById('sp1-id').value || 'sprite').trim();
            const section = (document.getElementById('sp1-section').value || 'rodata_user').trim();
            const useMask = document.getElementById('sp1-mask').checked;

            modal.classList.add('hidden');
            try {
                const asm = window.ZXExportSP1(this.pixels, this.width, this.height, spriteName, section, useMask);
                const defaultName = spriteName + '.asm';
                await window.electronAPI.exportSp1Asm(asm, defaultName);
            } catch (e) {
                console.error('exportToSP1 failed', e);
                const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.export_sp1_failed']) || 'Export to SP1 ASM failed.';
                alert(e.message || msg);
            }
        };
    }

    exportToCYDJson() {
        const modal = document.getElementById('cyd-modal');
        modal.classList.remove('hidden');

        document.getElementById('cyd-cancel').onclick = () => {
            modal.classList.add('hidden');
        };

        document.getElementById('cyd-apply').onclick = async () => {
            const startId = parseInt(document.getElementById('cyd-start-id').value) || 0;
            const charWidth = Math.max(1, Math.min(8, parseInt(document.getElementById('cyd-char-width').value) || 8));
            const autoWidth = document.getElementById('cyd-auto-width').checked;

            const charsX = this.width / 8;
            const charsY = this.height / 8;
            const result = [];

            for (let cy = 0; cy < charsY; cy++) {
                for (let cx = 0; cx < charsX; cx++) {
                    const ci = cy * charsX + cx;
                    const bytes = [];
                    for (let row = 0; row < 8; row++) {
                        let b = 0;
                        for (let bit = 0; bit < 8; bit++) {
                            if (this.pixels[(cy * 8 + row) * this.width + cx * 8 + bit]) b |= (1 << (7 - bit));
                        }
                        bytes.push(b);
                    }

                    let width = charWidth;
                    if (autoWidth) {
                        let lastSetCol = -1;
                        for (let row = 0; row < 8; row++) {
                            for (let bit = 0; bit < 8; bit++) {
                                if (this.pixels[(cy * 8 + row) * this.width + cx * 8 + bit]) {
                                    if (bit > lastSetCol) lastSetCol = bit;
                                }
                            }
                        }
                        // advance width = last occupied column + 1 (pixel) + 1 (gap), capped at charWidth
                        width = lastSetCol >= 0 ? Math.min(lastSetCol + 2, charWidth) : Math.max(1, Math.floor(charWidth / 2));
                    }

                    result.push({ Id: startId + ci, Character: bytes, Width: width });
                }
            }

            // Format matching the CYD new_charset.json style: Character array on one line
            const lines = ['['];
            result.forEach((entry, i) => {
                lines.push('\t{');
                lines.push(`\t\t"Id": ${entry.Id},`);
                lines.push(`\t\t"Character": [${entry.Character.join(', ')}],`);
                lines.push(`\t\t"Width": ${entry.Width}`);
                lines.push(i < result.length - 1 ? '\t},' : '\t}');
            });
            lines.push(']');
            const jsonStr = lines.join('\n');

            modal.classList.add('hidden');
            try {
                await window.electronAPI.exportCydJson(jsonStr, 'charset.json');
            } catch (e) {
                console.error('exportToCYDJson failed', e);
                const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.export_cyd_failed']) || 'Export to CYD JSON failed.';
                alert(e.message || msg);
            }
        };
    }

    exportBorielPutChars() {
        const modal = document.getElementById('putchars-modal');
        modal.classList.remove('hidden');

        document.getElementById('putchars-cancel').onclick = () => {
            modal.classList.add('hidden');
        };

        const applyBtn = document.getElementById('putchars-apply');
        applyBtn.onclick = () => {
            const width = parseInt(document.getElementById('putchars-width').value);
            const rows = parseInt(document.getElementById('putchars-rows').value);
            const cols = parseInt(document.getElementById('putchars-cols').value);
            const name = document.getElementById('putchars-name').value || 'mySprite';
            const matrix = document.getElementById('putchars-matrix').checked;
            const noAttrs = !document.getElementById('putchars-attributes').checked;

            if (width % 8 !== 0) {
                const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.size_multiple']) ? this._currentLocaleMap['alert.size_multiple'] : 'Width must be a multiple of 8.';
                alert(msg);
                return;
            }

            modal.classList.add('hidden');
            this.generateAndSavePutChars(width, rows, cols, name, matrix, noAttrs);
        };
    }

    async generateAndSavePutChars(w, rows, cols, name, matrix, noAttrs) {
        if (!window.ZXExportPutChars) {
            console.error('ZXExportPutChars module not found.');
            return;
        }

        const finalOutput = window.ZXExportPutChars(
            this.pixels,
            this.attributes,
            this.width,
            this.height,
            w,
            rows,
            cols,
            name,
            matrix,
            noAttrs
        );

        await window.electronAPI.exportBas(finalOutput, `${name}.bas`);
    }

    openImportBasModal() {
        const modal = document.getElementById('import-bas-modal');
        if (!modal) return;
        modal.classList.remove('hidden');

        // Pre-fill with sensible defaults: try to auto-detect count from comments
        if (this._pendingBasContent) {
            const countMatch = this._pendingBasContent.match(/'\s*Count:\s*(\d+)/);
            const sizeMatch = this._pendingBasContent.match(/'\s*Size:\s*(\d+)x(\d+)/);
            if (sizeMatch) {
                document.getElementById('import-bas-width').value = parseInt(sizeMatch[1]);
            }
            if (countMatch) {
                const count = parseInt(countMatch[1]);
                // Default layout: single row
                document.getElementById('import-bas-cols').value = count;
                document.getElementById('import-bas-rows').value = 1;
            }
        }

        document.getElementById('import-bas-cancel').onclick = () => {
            modal.classList.add('hidden');
            this._pendingBasContent = null;
            this._pendingBasFilePath = null;
        };

        document.getElementById('import-bas-apply').onclick = () => {
            const tileW = parseInt(document.getElementById('import-bas-width').value);
            const rows = parseInt(document.getElementById('import-bas-rows').value);
            const cols = parseInt(document.getElementById('import-bas-cols').value);

            if (tileW % 8 !== 0 || tileW < 8) {
                const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.size_multiple']) ? this._currentLocaleMap['alert.size_multiple'] : 'Tile width must be a multiple of 8.';
                alert(msg);
                return;
            }

            modal.classList.add('hidden');
            if (this._pendingBasContent) {
                this.importFromBas(this._pendingBasContent, tileW, cols, rows, this._pendingBasFilePath);
            }
            this._pendingBasContent = null;
            this._pendingBasFilePath = null;
        };
    }

    importFromBas(text, tileW, cols, rows, filePath) {
        if (!window.ZXImportBas) {
            console.error('ZXImportBas module not found.');
            return;
        }
        const result = window.ZXImportBas(text, tileW, cols, rows);
        if (!result) {
            alert('Failed to parse .bas file. Make sure it was exported with "Export as Matrix" option from ZXDrawer.');
            return;
        }
        const { pixels, attributes, canvasWidth, canvasHeight } = result;
        this.resetData(canvasWidth, canvasHeight);
        this.pixels = pixels;
        this.attributes = attributes;
        if (filePath) this.currentFilePath = null; // .bas is not a native save format
        this.setDirty(false);
        this.undoStack = [];
        this.redoStack = [];
        this.render();
        try { if (filePath) { this.addRecentFile(filePath); window.electronAPI.addRecentFile(filePath); } } catch(e) {}
    }

    exportBorielGuSprites() {
        const modal = document.getElementById('gusprites-modal');
        modal.classList.remove('hidden');

        document.getElementById('gusprites-cancel').onclick = () => {
            modal.classList.add('hidden');
        };

        const applyBtn = document.getElementById('gusprites-apply');
        applyBtn.onclick = () => {
            const width = parseInt(document.getElementById('gusprites-width').value);
            const rows = parseInt(document.getElementById('gusprites-rows').value);
            const cols = parseInt(document.getElementById('gusprites-cols').value);
            const name = document.getElementById('gusprites-name').value || 'mySprite';
            const matrix = document.getElementById('gusprites-matrix').checked;
            const noAttrs = !document.getElementById('gusprites-attributes').checked;

            if (width % 8 !== 0) {
                const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.size_multiple']) ? this._currentLocaleMap['alert.size_multiple'] : 'Width must be a multiple of 8.';
                alert(msg);
                return;
            }

            modal.classList.add('hidden');
            this.generateAndSaveGuSprites(width, rows, cols, name, matrix, noAttrs);
        };
    }

    async generateAndSaveGuSprites(w, rows, cols, name, matrix, noAttrs) {
        if (!window.ZXExportGuSprites) {
            console.error('ZXExportGuSprites module not found.');
            return;
        }

        const finalOutput = window.ZXExportGuSprites(
            this.pixels,
            this.attributes,
            this.width,
            this.height,
            w,
            rows,
            cols,
            name,
            matrix,
            noAttrs
        );

        await window.electronAPI.exportBas(finalOutput, `${name}.bas`);
    }

    exportData() {
        const modal = document.getElementById('export-data-modal');

        modal.classList.remove('hidden');

        // Wire Attribute Mask toggle visibility
        const attrMaskChk = document.getElementById('export-data-attrmask');
        const attrMaskOpts = document.getElementById('export-data-attrmask-opts');
        attrMaskChk.onchange = () => {
            attrMaskOpts.style.display = attrMaskChk.checked ? 'flex' : 'none';
        };

        // Wire priority list Move Up / Move Down buttons
        const prioList = document.getElementById('export-data-priority-list');
        document.getElementById('export-data-priority-up').onclick = () => {
            const idx = prioList.selectedIndex;
            if (idx > 0) {
                const opt = prioList.options[idx];
                prioList.remove(idx);
                prioList.add(opt, idx - 1);
                prioList.selectedIndex = idx - 1;
            }
        };
        document.getElementById('export-data-priority-down').onclick = () => {
            const idx = prioList.selectedIndex;
            if (idx >= 0 && idx < prioList.options.length - 1) {
                const opt = prioList.options[idx];
                prioList.remove(idx);
                prioList.add(opt, idx + 1);
                prioList.selectedIndex = idx + 1;
            }
        };

        document.getElementById('export-data-cancel').onclick = () => {
            modal.classList.add('hidden');
        };

        document.getElementById('export-data-apply').onclick = () => {
            const name       = document.getElementById('export-data-name').value || 'mySprite';
            const type       = document.getElementById('export-data-type').value;
            const interleave = parseInt(document.getElementById('export-data-interleave').value);
            const format     = document.querySelector('input[name="export-data-format"]:checked').value;
            const nolabel    = document.getElementById('export-data-nolabel').checked;
            const maskfirst  = document.getElementById('export-data-maskfirst').checked;
            const zigzag     = document.getElementById('export-data-zigzag').checked;
            const z88dk      = document.getElementById('export-data-z88dk').checked;
            const attrMask   = document.getElementById('export-data-attrmask').checked;
            const attrMaskInk    = document.getElementById('export-data-attrmask-ink').checked;
            const attrMaskPaper  = document.getElementById('export-data-attrmask-paper').checked;
            const attrMaskBright = document.getElementById('export-data-attrmask-bright').checked;
            const attrMaskFlash  = document.getElementById('export-data-attrmask-flash').checked;

            // Read priority list order (value = dimension index 0-4)
            const priorities = Array.from(prioList.options).map(o => parseInt(o.value));

            modal.classList.add('hidden');
            this.generateAndSaveData({
                name, type, interleave, format, nolabel,
                maskfirst, zigzag, z88dk,
                attrMask, attrMaskInk, attrMaskPaper, attrMaskBright, attrMaskFlash,
                priorities,
            });
        };
    }

    async generateAndSaveData(options) {
        if (!window.ZXExportData) {
            console.error('ZXExportData module not found.');
            return;
        }

        const finalOutput = window.ZXExportData(
            this.pixels,
            this.attributes,
            this.width,
            this.height,
            options
        );

        if (options.format === 'bin') {
            await window.electronAPI.exportBin(finalOutput, `${options.name}.bin`);
        } else {
            await window.electronAPI.exportBas(finalOutput, `${options.name}.asm`);
        }
    }

    exportToZXP() {
        let lines = ['ZX-Paintbrush image', ''];
        
        // Bitmap section
        for (let y = 0; y < this.height; y++) {
            let row = '';
            for (let x = 0; x < this.width; x++) {
                row += this.pixels[y * this.width + x] ? '1' : '0';
            }
            lines.push(row);
        }
        
        lines.push(''); // Blank line separator
        
        // Attribute section
        for (let by = 0; by < this.height / 8; by++) {
            let attrRow = [];
            for (let bx = 0; bx < this.width / 8; bx++) {
                const attr = this.attributes[by * (this.width / 8) + bx];
                attrRow.push(attr.toString(16).toUpperCase().padStart(2, '0'));
            }
            lines.push(attrRow.join(' '));
        }
        
        return lines.join('\n');
    }

    importFromZXP(content) {
        const lines = content.split(/\r?\n/);
        if (lines[0] !== 'ZX-Paintbrush image') {
            const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.invalid_zxp']) ? this._currentLocaleMap['alert.invalid_zxp'] : 'Invalid .zxp file.';
            alert(msg);
            return;
        }

        let bitmapRows = [];
        let attrRows = [];
        let parsingAttributes = false;
        
        // Skip header lines
        for (let i = 2; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line === '' && bitmapRows.length > 0) {
                parsingAttributes = true;
                continue;
            }
            
            if (!parsingAttributes) {
                if (/^[01]+$/.test(line)) {
                    bitmapRows.push(line);
                }
            } else {
                if (line !== '') {
                    attrRows.push(line.split(/\s+/));
                }
            }
        }

        if (bitmapRows.length === 0) return;

        const h = bitmapRows.length;
        const w = bitmapRows[0].length;
        
        this.resetData(w, h);
        
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                this.pixels[y * w + x] = bitmapRows[y][x] === '1' ? 1 : 0;
            }
        }

        let attrFlat = attrRows.flat();
        for (let i = 0; i < Math.min(this.attributes.length, attrFlat.length); i++) {
            this.attributes[i] = parseInt(attrFlat[i], 16);
        }
    }
    // ── Image Import ─────────────────────────────────────────────────────────
    triggerImageImport() {
        window.electronAPI.loadImage().then(dataUrl => {
            if (dataUrl) this.openImageImportModal(dataUrl);
        });
    }

    triggerBasImport() {
        window.electronAPI.loadFileBas().then(file => {
            if (file && file.type === 'bas') {
                this._pendingBasContent = file.content;
                this._pendingBasFilePath = file.filePath;
                this.openImportBasModal();
            }
        });
    }

    openImageImportModal(dataUrl) {
        const modal      = document.getElementById('import-image-modal');
        const srcCanvas  = document.getElementById('import-src-canvas');
        const zxCanvas   = document.getElementById('import-zx-canvas');

        srcCanvas.width  = 256;
        srcCanvas.height = 192;
        zxCanvas.width   = 256;
        zxCanvas.height  = 192;

        const img = new Image();
        img.onload = () => {
            const updatePreview = () => {
                const brightness = document.getElementById('import-brightness').value;
                const contrast   = document.getElementById('import-contrast').value;
                const saturation = document.getElementById('import-saturation').value;
                document.getElementById('import-brightness-val').textContent = brightness + '%';
                document.getElementById('import-contrast-val').textContent   = contrast   + '%';
                document.getElementById('import-saturation-val').textContent = saturation + '%';

                // Draw adjusted source
                const srcCtx = srcCanvas.getContext('2d');
                srcCtx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
                srcCtx.drawImage(img, 0, 0, 256, 192);
                srcCtx.filter = 'none';

                // Convert to ZX Spectrum
                const { pixels, attributes } = this.convertImageToZXCanvas(srcCanvas);
                this._importPixels     = pixels;
                this._importAttributes = attributes;

                // Render ZX preview
                const zxCtx   = zxCanvas.getContext('2d');
                const imgData = zxCtx.createImageData(256, 192);
                const data    = imgData.data;
                const pal     = SPECTRUM_PALETTE;
                for (let by = 0; by < 24; by++) {
                    for (let bx = 0; bx < 32; bx++) {
                        const attr   = attributes[by * 32 + bx];
                        const bright = (attr >> 6) & 1;
                        const inkC   = this.hexToRgb(pal[bright][attr & 7]);
                        const paperC = this.hexToRgb(pal[bright][(attr >> 3) & 7]);
                        for (let py = 0; py < 8; py++) {
                            for (let px = 0; px < 8; px++) {
                                const x = bx * 8 + px;
                                const y = by * 8 + py;
                                const c = pixels[y * 256 + x] ? inkC : paperC;
                                const i = (y * 256 + x) * 4;
                                data[i] = c.r; data[i+1] = c.g; data[i+2] = c.b; data[i+3] = 255;
                            }
                        }
                    }
                }
                zxCtx.putImageData(imgData, 0, 0);
            };

            ['import-brightness', 'import-contrast', 'import-saturation'].forEach(id => {
                document.getElementById(id).oninput = updatePreview;
            });

            // Reset sliders on each new image open
            document.getElementById('import-brightness').value = 100;
            document.getElementById('import-contrast').value   = 100;
            document.getElementById('import-saturation').value = 100;

            updatePreview();
            modal.classList.remove('hidden');
        };
        img.src = dataUrl;

        document.getElementById('import-image-cancel').onclick = () => {
            modal.classList.add('hidden');
        };

        document.getElementById('import-image-apply').onclick = () => {
            if (this._importPixels && this._importAttributes) {
                this.undoStack = [];
                this.redoStack = [];
                this.resetData(256, 192);
                this.pixels     = this._importPixels;
                this.attributes = this._importAttributes;
                this.currentFilePath = null;
                this.render();
            }
            modal.classList.add('hidden');
        };
    }

    convertImageToZXCanvas(srcCanvas) {
        const raw     = srcCanvas.getContext('2d').getImageData(0, 0, 256, 192).data;
        const pixels  = new Uint8Array(256 * 192);
        const attrs   = new Uint8Array(32 * 24);

        // Pre-build palette as plain arrays for speed: pal[bright][idx] = [r,g,b]
        const pal = SPECTRUM_PALETTE.map(set => set.map(hex => {
            const c = this.hexToRgb(hex);
            return [c.r, c.g, c.b];
        }));

        const bR = new Uint8Array(64);
        const bG = new Uint8Array(64);
        const bB = new Uint8Array(64);

        for (let by = 0; by < 24; by++) {
            for (let bx = 0; bx < 32; bx++) {
                // Collect block pixels
                for (let py = 0; py < 8; py++) {
                    for (let px = 0; px < 8; px++) {
                        const x = bx * 8 + px;
                        const y = by * 8 + py;
                        const i = (y * 256 + x) * 4;
                        const j = py * 8 + px;
                        bR[j] = raw[i]; bG[j] = raw[i+1]; bB[j] = raw[i+2];
                    }
                }

                // Find best (bright, paperIdx, inkIdx) by minimum total squared error
                let bestErr = Infinity;
                let bestBright = 0, bestPaper = 0, bestInk = 7;

                for (let bright = 0; bright < 2; bright++) {
                    const p = pal[bright];
                    for (let pi = 0; pi < 8; pi++) {
                        const pr = p[pi][0], pg = p[pi][1], pb = p[pi][2];
                        for (let ii = 0; ii < 8; ii++) {
                            const ir = p[ii][0], ig = p[ii][1], ib = p[ii][2];
                            let err = 0;
                            for (let j = 0; j < 64; j++) {
                                const r = bR[j], g = bG[j], b = bB[j];
                                const dI = (r-ir)*(r-ir) + (g-ig)*(g-ig) + (b-ib)*(b-ib);
                                const dP = (r-pr)*(r-pr) + (g-pg)*(g-pg) + (b-pb)*(b-pb);
                                err += dI < dP ? dI : dP;
                                if (err >= bestErr) break; // prune
                            }
                            if (err < bestErr) {
                                bestErr = err;
                                bestBright = bright;
                                bestPaper  = pi;
                                bestInk    = ii;
                            }
                        }
                    }
                }

                attrs[by * 32 + bx] = (bestBright << 6) | (bestPaper << 3) | bestInk;

                // Assign pixels to ink (1) or paper (0)
                const iC = pal[bestBright][bestInk];
                const pC = pal[bestBright][bestPaper];
                const ir = iC[0], ig = iC[1], ib = iC[2];
                const pr = pC[0], pg = pC[1], pb = pC[2];
                for (let py = 0; py < 8; py++) {
                    for (let px = 0; px < 8; px++) {
                        const j = py * 8 + px;
                        const r = bR[j], g = bG[j], b = bB[j];
                        const dI = (r-ir)*(r-ir) + (g-ig)*(g-ig) + (b-ib)*(b-ib);
                        const dP = (r-pr)*(r-pr) + (g-pg)*(g-pg) + (b-pb)*(b-pb);
                        pixels[(by * 8 + py) * 256 + (bx * 8 + px)] = dI <= dP ? 1 : 0;
                    }
                }
            }
        }

        return { pixels, attributes: attrs };
    }
    // ─────────────────────────────────────────────────────────────────────────

    openMasksModal() {
        const modal = document.getElementById('masks-modal');
        
        // Auto-defaults: if 256x192, default 16x16 tiled.
        document.getElementById('masks-width').value = 16;
        document.getElementById('masks-rows').value = Math.floor(this.height / 16) || 1;
        document.getElementById('masks-cols').value = Math.floor(this.width / 16) || 1;
        
        modal.classList.remove('hidden');

        document.getElementById('masks-cancel').onclick = () => {
            modal.classList.add('hidden');
        };

        const applyBtn = document.getElementById('masks-apply');
        applyBtn.onclick = () => {
            const w = parseInt(document.getElementById('masks-width').value) || 16;
            const rows = parseInt(document.getElementById('masks-rows').value) || 1;
            const cols = parseInt(document.getElementById('masks-cols').value) || 1;

            if (w % 8 !== 0) {
                alert('Width must be a multiple of 8.');
                return;
            }

            modal.classList.add('hidden');
            this.applyGenerateMasks(w, rows, cols);
        };
    }

    applyGenerateMasks(w, rows, cols) {
        this.saveHistory();

        const newWidth = (cols * 2) * w;
        const newHeight = rows * w;
        const newPixels = new Uint8Array(newWidth * newHeight);
        const newAttributes = new Uint8Array((newWidth / 8) * (newHeight / 8));
        
        // Neutral attribute for the entire new workspace (Paper 0, Ink 7)
        newAttributes.fill(0x07); 

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const srcX = c * w;
                const srcY = r * w;
                const dstX_Sprite = (c * 2) * w;
                const dstY = r * w;
                const dstX_Mask = (c * 2 + 1) * w;

                const isSpritePixel = (tx, ty) => {
                    const sx = srcX + tx;
                    const sy = srcY + ty;
                    if (sx < 0 || sx >= this.width || sy < 0 || sy >= this.height) return 0;
                    return this.pixels[sy * this.width + sx];
                };

                // Phase 1: Detect horizontal limits for each row (sprite pixels only, no fill yet)
                const hFirst = new Array(w).fill(-1);
                const hLast  = new Array(w).fill(-1);
                for (let py = 0; py < w; py++) {
                    for (let px = 0; px < w; px++) {
                        if (isSpritePixel(px, py) === 1) {
                            if (hFirst[py] === -1) hFirst[py] = px;
                            hLast[py] = px;
                        }
                    }
                }

                // Phase 2: Detect vertical limits constrained by horizontal extents, fill intermediate mask.
                const intermediateMask = new Uint8Array(w * w).fill(1); // 1=transparent
                for (let px = 0; px < w; px++) {
                    let vFirst = -1, vLast = -1;
                    for (let py = 0; py < w; py++) {
                        if (hFirst[py] !== -1 && px >= hFirst[py] && px <= hLast[py]) {
                            if (vFirst === -1) vFirst = py;
                            vLast = py;
                        }
                    }
                    if (vFirst !== -1) {
                        for (let py = vFirst; py <= vLast; py++) {
                            intermediateMask[py * w + px] = 0; // opaque
                        }
                    }
                }

                // Phase 3: Copy sprite pixels and fill mask horizontally using intermediate mask.
                for (let py = 0; py < w; py++) {
                    const dy = dstY + py;
                    for (let px = 0; px < w; px++) {
                        newPixels[dy * newWidth + (dstX_Sprite + px)] = isSpritePixel(px, py);
                    }
                    let first = -1, last = -1;
                    for (let px = 0; px < w; px++) {
                        if (intermediateMask[py * w + px] === 0) {
                            if (first === -1) first = px;
                            last = px;
                        }
                    }
                    for (let px = 0; px < w; px++) {
                        newPixels[dy * newWidth + (dstX_Mask + px)] =
                            (first !== -1 && px >= first && px <= last) ? 0 : 1;
                    }
                }

                // Copy Attributes for Sprite
                const srcBlockX = srcX / 8;
                const srcBlockY = srcY / 8;
                const dstBlockX_Sprite = dstX_Sprite / 8;
                const dstBlockY = dstY / 8;
                const sizeBlocks = w / 8;

                for (let by = 0; by < sizeBlocks; by++) {
                    for (let bx = 0; bx < sizeBlocks; bx++) {
                        const say = srcBlockY + by;
                        const sax = srcBlockX + bx;
                        if (say < (this.height / 8) && sax < (this.width / 8)) {
                            const attr = this.attributes[say * (this.width / 8) + sax];
                            const day = dstBlockY + by;
                            const dax = dstBlockX_Sprite + bx;
                            newAttributes[day * (newWidth / 8) + dax] = attr;
                        }
                    }
                }
            }
        }

        // Apply new data
        this.width = newWidth;
        this.height = newHeight;
        this.pixels = newPixels;
        this.attributes = newAttributes;

        // Resize Canvas internal resolution
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        
        // Update display size and auxiliary canvases
        this.updateZoom();

        this.currentFilePath = null;
        this.selection = null;
        this.render();
        this.drawGrid();
    }

    // ── Mask Editor ──────────────────────────────────────────────────────────

    openMaskEditor() {
        if (!this.selection) {
            const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.mask_editor.no_selection']) ? this._currentLocaleMap['alert.mask_editor.no_selection'] : 'Select an area first: sprite columns on the left, mask columns on the right.';
            alert(msg);
            return;
        }
        const { x, y, w, h } = this.selection; // in blocks
        if (w < 2 || w % 2 !== 0) {
            const msg = (this._currentLocaleMap && this._currentLocaleMap['alert.mask_editor.invalid_width']) ? this._currentLocaleMap['alert.mask_editor.invalid_width'] : 'Selection width must be even and at least 2 blocks (sprite + mask side by side).';
            alert(msg);
            return;
        }

        const halfW    = w / 2;          // sprite width in blocks
        const spritePixW = halfW * 8;    // sprite width in pixels
        const spritePixH = h    * 8;    // sprite/mask height in pixels
        const spriteX    = x    * 8;    // pixel X start of sprite in canvas
        const maskX      = (x + halfW) * 8; // pixel X start of mask in canvas
        const spriteY    = y    * 8;    // pixel Y start

        // Build working copy of mask pixels
        const maskPixels = new Uint8Array(spritePixW * spritePixH);
        for (let py = 0; py < spritePixH; py++) {
            for (let px = 0; px < spritePixW; px++) {
                const sx = maskX + px;
                const sy = spriteY + py;
                if (sx < this.width && sy < this.height) {
                    maskPixels[py * spritePixW + px] = this.pixels[sy * this.width + sx];
                }
            }
        }

        // Calculate zoom: fill ~80% of viewport (minus modal chrome ~160px vertical)
        const availW = Math.floor(window.innerWidth  * 0.85);
        const availH = Math.floor(window.innerHeight * 0.80) - 160;
        const zoomByW = Math.floor(availW / spritePixW);
        const zoomByH = Math.floor(availH / spritePixH);
        const zoom = Math.max(2, Math.min(24, zoomByW, zoomByH));

        this._maskEditData = { x, y, w, h, halfW, spritePixW, spritePixH, spriteX, maskX, spriteY, maskPixels, zoom };

        // Set up canvas (rendered at actual display resolution — no CSS scaling)
        const canvas = document.getElementById('mask-editor-canvas');
        canvas.width  = spritePixW * zoom;
        canvas.height = spritePixH * zoom;

        this.renderMaskEditor();

        const modal = document.getElementById('mask-editor-modal');
        modal.classList.remove('hidden');

        // ── Painting logic ──
        let isPainting = false;

        const paintAt = (e) => {
            const rect = canvas.getBoundingClientRect();
            const { spritePixW, spritePixH, maskPixels, zoom } = this._maskEditData;
            const px = Math.floor((e.clientX - rect.left) / zoom);
            const py = Math.floor((e.clientY - rect.top)  / zoom);
            if (px < 0 || px >= spritePixW || py < 0 || py >= spritePixH) return;
            const val = (e.buttons & 1) ? 1 : 0; // L = transparent(1), R = opaque(0)
            maskPixels[py * spritePixW + px] = val;
            this.renderMaskEditor();
        };

        const onMouseUp = () => { isPainting = false; };
        this._maskEditorCleanup = () => {
            canvas.onmousedown = null;
            canvas.onmousemove = null;
            canvas.oncontextmenu = null;
            window.removeEventListener('mouseup', onMouseUp);
        };

        canvas.onmousedown = (e) => {
            e.preventDefault();
            isPainting = true;
            paintAt(e);
        };
        canvas.onmousemove = (e) => { if (isPainting) paintAt(e); };
        canvas.oncontextmenu = (e) => e.preventDefault();
        window.addEventListener('mouseup', onMouseUp);

        document.getElementById('mask-editor-cancel').onclick = () => {
            this._maskEditorCleanup && this._maskEditorCleanup();
            modal.classList.add('hidden');
        };
        document.getElementById('mask-editor-apply').onclick = () => {
            this._maskEditorCleanup && this._maskEditorCleanup();
            this.applyMaskEdit();
            modal.classList.add('hidden');
        };
    }

    renderMaskEditor() {
        const canvas = document.getElementById('mask-editor-canvas');
        const ctx    = canvas.getContext('2d');
        const { spritePixW, spritePixH, spriteX, spriteY, maskPixels, zoom } = this._maskEditData;

        // Redraw at actual display resolution
        canvas.width  = spritePixW * zoom;
        canvas.height = spritePixH * zoom;

        // ── 1. Render sprite pixels ──
        for (let py = 0; py < spritePixH; py++) {
            for (let px = 0; px < spritePixW; px++) {
                const sx = spriteX + px;
                const sy = spriteY + py;
                const bx = Math.floor(sx / 8);
                const by = Math.floor(sy / 8);
                const attr   = this.attributes[by * (this.width / 8) + bx];
                const bright = (attr >> 6) & 1;
                const ink    =  attr       & 7;
                const paper  = (attr >> 3) & 7;
                const isSet  = this.pixels[sy * this.width + sx];
                ctx.fillStyle = SPECTRUM_PALETTE[bright][isSet ? ink : paper];
                ctx.fillRect(px * zoom, py * zoom, zoom, zoom);
            }
        }

        // ── 2. Red overlay where mask is transparent (1) ──
        ctx.fillStyle = 'rgba(220, 30, 30, 0.55)';
        for (let py = 0; py < spritePixH; py++) {
            for (let px = 0; px < spritePixW; px++) {
                if (maskPixels[py * spritePixW + px] === 1) {
                    ctx.fillRect(px * zoom, py * zoom, zoom, zoom);
                }
            }
        }

        // ── 3. Subtle 8×8 char-cell grid ──
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        for (let gx = 0; gx <= spritePixW; gx += 8) {
            ctx.beginPath();
            ctx.moveTo(gx * zoom + 0.5, 0);
            ctx.lineTo(gx * zoom + 0.5, spritePixH * zoom);
            ctx.stroke();
        }
        for (let gy = 0; gy <= spritePixH; gy += 8) {
            ctx.beginPath();
            ctx.moveTo(0, gy * zoom + 0.5);
            ctx.lineTo(spritePixW * zoom, gy * zoom + 0.5);
            ctx.stroke();
        }
    }

    applyMaskEdit() {
        this.saveHistory();
        const { maskX, spriteY, spritePixW, spritePixH, maskPixels } = this._maskEditData;
        for (let py = 0; py < spritePixH; py++) {
            for (let px = 0; px < spritePixW; px++) {
                const sx = maskX + px;
                const sy = spriteY + py;
                if (sx < this.width && sy < this.height) {
                    this.pixels[sy * this.width + sx] = maskPixels[py * spritePixW + px];
                }
            }
        }
        this.render();
    }

    // ─────────────────────────────────────────────────────────────────────────
}

window.onload = () => {
    window.zxDraw = new ZXDrawer();
};
