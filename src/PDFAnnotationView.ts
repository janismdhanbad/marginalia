import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import * as pdfjsLib from 'pdfjs-dist';
import type PDFAnnotatorPlugin from './main';
import { DrawingCanvas, Tool, Stroke, AnnotationData } from './DrawingCanvas';

export const VIEW_TYPE_PDF_ANNOTATION = 'pdf-annotation-view';
export const PLUGIN_VERSION = 'v0.5.1';  // Pinch-to-zoom support

// Check if we're on mobile/tablet
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// Use CDN worker on desktop, will use disableWorker on mobile
if (!isMobile) {
	const PDFJS_VERSION = '4.8.69';
	pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;
}

// Page wrapper for continuous scroll
interface PageElement {
	wrapper: HTMLElement;
	pdfCanvas: HTMLCanvasElement;
	drawingCanvas: DrawingCanvas | null;
	rendered: boolean;
	pageNum: number;
}

export class PDFAnnotationView extends ItemView {
	plugin: PDFAnnotatorPlugin;
	private containerEl: HTMLElement;
	private toolbarEl: HTMLElement;
	private pdfContainerEl: HTMLElement;
	private pagesContainerEl: HTMLElement;
	
	private pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
	private totalPages: number = 0;
	private scale: number = 1.5;  // Display scale (zoom level)
	private readonly MIN_SCALE = 0.5;
	private readonly MAX_SCALE = 4.0;
	private readonly SCALE_STEP = 0.25;
	private currentFile: TFile | null = null;
	
	// Page elements for continuous scroll
	private pageElements: PageElement[] = [];
	private currentVisiblePage: number = 1;
	
	// Current tool settings (applied to all drawing canvases)
	private currentTool: Tool = 'pen';
	private currentColor: string = '#000000';
	
	// Annotation storage per page
	private pageAnnotations: { [pageNum: number]: Stroke[] } = {};
	private hasUnsavedChanges: boolean = false;
	
	// Intersection observer for lazy loading
	private pageObserver: IntersectionObserver | null = null;
	
	// Radial menu for tool/color selection
	private radialMenuEl: HTMLElement | null = null;
	private radialMenuVisible: boolean = false;
	
	// Zoom indicator
	private zoomIndicator!: HTMLSpanElement;
	
	// Pinch-to-zoom state
	private pinchStartDistance: number = 0;
	private pinchStartScale: number = 1;
	private isPinching: boolean = false;

	constructor(leaf: WorkspaceLeaf, plugin: PDFAnnotatorPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_PDF_ANNOTATION;
	}

	getDisplayText(): string {
		return 'Marginalia';
	}

	getIcon(): string {
		return 'pdf-annotator';
	}

	async onOpen() {
		this.containerEl = this.contentEl;
		this.containerEl.empty();
		this.containerEl.addClass('pdf-annotator-container');

		// Create toolbar
		this.toolbarEl = this.containerEl.createDiv({ cls: 'pdf-annotator-toolbar' });
		this.createToolbar();

		// Create scrollable PDF container
		this.pdfContainerEl = this.containerEl.createDiv({ cls: 'pdf-annotator-pdf-container' });
		
		// Create pages container inside scrollable area
		this.pagesContainerEl = this.pdfContainerEl.createDiv({ cls: 'pdf-pages-container' });

		// Setup intersection observer for lazy loading
		this.setupPageObserver();
		
		// Create radial menu (hidden by default)
		this.createRadialMenu();
		
		// Setup pinch-to-zoom
		this.setupPinchZoom();

		// Show welcome message
		this.showWelcomeMessage();
	}

	private setupPageObserver() {
		this.pageObserver = new IntersectionObserver(
			(entries) => {
				entries.forEach(entry => {
					const pageNum = parseInt(entry.target.getAttribute('data-page') || '0');
					if (entry.isIntersecting && pageNum > 0) {
						this.renderPageIfNeeded(pageNum);
						// Update current visible page (for page indicator)
						if (entry.intersectionRatio > 0.5) {
							this.currentVisiblePage = pageNum;
							this.updatePageIndicator();
						}
					}
				});
			},
			{
				root: this.pdfContainerEl,
				rootMargin: '100px',  // Pre-load pages slightly before they're visible
				threshold: [0, 0.5, 1]
			}
		);
	}
	
	private setupPinchZoom() {
		// Calculate distance between two touch points
		const getTouchDistance = (touches: TouchList): number => {
			if (touches.length < 2) return 0;
			const dx = touches[0].clientX - touches[1].clientX;
			const dy = touches[0].clientY - touches[1].clientY;
			return Math.sqrt(dx * dx + dy * dy);
		};
		
		this.pdfContainerEl.addEventListener('touchstart', (e: TouchEvent) => {
			if (e.touches.length === 2) {
				// Start pinch gesture
				this.isPinching = true;
				this.pinchStartDistance = getTouchDistance(e.touches);
				this.pinchStartScale = this.scale;
				e.preventDefault();
			}
		}, { passive: false });
		
		this.pdfContainerEl.addEventListener('touchmove', (e: TouchEvent) => {
			if (this.isPinching && e.touches.length === 2) {
				const currentDistance = getTouchDistance(e.touches);
				const ratio = currentDistance / this.pinchStartDistance;
				
				// Calculate new scale
				let newScale = this.pinchStartScale * ratio;
				newScale = Math.max(this.MIN_SCALE, Math.min(this.MAX_SCALE, newScale));
				
				// Only update if scale changed significantly (avoid jitter)
				if (Math.abs(newScale - this.scale) > 0.02) {
					this.scale = newScale;
					this.updateZoomIndicator();
				}
				
				e.preventDefault();
			}
		}, { passive: false });
		
		this.pdfContainerEl.addEventListener('touchend', (e: TouchEvent) => {
			if (this.isPinching) {
				this.isPinching = false;
				// Re-render pages at new zoom level
				this.reRenderAllPages();
			}
		});
		
		this.pdfContainerEl.addEventListener('touchcancel', () => {
			this.isPinching = false;
		});
	}

	private createToolbar() {
		// File controls
		const fileGroup = this.toolbarEl.createDiv({ cls: 'toolbar-group' });
		
		const loadBtn = fileGroup.createEl('button', { 
			cls: 'toolbar-btn',
			attr: { 'aria-label': 'Load PDF' }
		});
		loadBtn.innerHTML = '📂 Load';
		loadBtn.addEventListener('click', () => this.promptLoadPDF());

		// Page indicator (no prev/next buttons since we have scroll)
		const navGroup = this.toolbarEl.createDiv({ cls: 'toolbar-group nav-group' });
		this.pageIndicator = navGroup.createSpan({ cls: 'page-indicator' });
		this.updatePageIndicator();
		
		// Zoom controls
		const zoomGroup = this.toolbarEl.createDiv({ cls: 'toolbar-group zoom-group' });
		
		const zoomOutBtn = zoomGroup.createEl('button', {
			cls: 'toolbar-btn zoom-btn',
			attr: { 'aria-label': 'Zoom Out' }
		});
		zoomOutBtn.innerHTML = '−';
		zoomOutBtn.addEventListener('click', () => this.zoomOut());
		
		this.zoomIndicator = zoomGroup.createSpan({ cls: 'zoom-indicator' });
		this.updateZoomIndicator();
		
		const zoomInBtn = zoomGroup.createEl('button', {
			cls: 'toolbar-btn zoom-btn',
			attr: { 'aria-label': 'Zoom In' }
		});
		zoomInBtn.innerHTML = '+';
		zoomInBtn.addEventListener('click', () => this.zoomIn());
		
		const fitWidthBtn = zoomGroup.createEl('button', {
			cls: 'toolbar-btn',
			attr: { 'aria-label': 'Fit Width' }
		});
		fitWidthBtn.innerHTML = '↔️';
		fitWidthBtn.addEventListener('click', () => this.fitToWidth());

		// Drawing tools
		const toolGroup = this.toolbarEl.createDiv({ cls: 'toolbar-group tool-group' });

		const penBtn = toolGroup.createEl('button', {
			cls: 'toolbar-btn tool-btn active',
			attr: { 'aria-label': 'Pen', 'data-tool': 'pen' }
		});
		penBtn.innerHTML = '✏️ Pen';
		penBtn.addEventListener('click', () => this.selectTool('pen', penBtn));

		const highlighterBtn = toolGroup.createEl('button', {
			cls: 'toolbar-btn tool-btn',
			attr: { 'aria-label': 'Highlighter', 'data-tool': 'highlighter' }
		});
		highlighterBtn.innerHTML = '🖍️ Highlight';
		highlighterBtn.addEventListener('click', () => this.selectTool('highlighter', highlighterBtn));

		const eraserBtn = toolGroup.createEl('button', {
			cls: 'toolbar-btn tool-btn',
			attr: { 'aria-label': 'Eraser', 'data-tool': 'eraser' }
		});
		eraserBtn.innerHTML = '🧹 Eraser';
		eraserBtn.addEventListener('click', () => this.selectTool('eraser', eraserBtn));

		// Color picker
		const colorGroup = this.toolbarEl.createDiv({ cls: 'toolbar-group color-group' });
		
		const colors = [
			{ name: 'Black', value: '#000000' },
			{ name: 'Red', value: '#e74c3c' },
			{ name: 'Blue', value: '#3498db' },
			{ name: 'Green', value: '#27ae60' },
			{ name: 'Yellow', value: '#f1c40f' },
			{ name: 'Purple', value: '#9b59b6' },
		];

		colors.forEach((color, index) => {
			const colorBtn = colorGroup.createEl('button', {
				cls: `toolbar-btn color-btn ${index === 0 ? 'active' : ''}`,
				attr: { 
					'aria-label': color.name,
					'data-color': color.value,
					'style': `background-color: ${color.value};`
				}
			});
			colorBtn.addEventListener('click', () => this.selectColor(color.value, colorBtn));
		});

		// Save and Clear buttons
		const actionGroup = this.toolbarEl.createDiv({ cls: 'toolbar-group' });
		
		const saveBtn = actionGroup.createEl('button', {
			cls: 'toolbar-btn save-btn',
			attr: { 'aria-label': 'Save Annotations' }
		});
		saveBtn.innerHTML = '💾 Save';
		saveBtn.addEventListener('click', () => this.saveAnnotations());
		
		const clearBtn = actionGroup.createEl('button', {
			cls: 'toolbar-btn danger-btn',
			attr: { 'aria-label': 'Clear Page' }
		});
		clearBtn.innerHTML = '🗑️ Clear';
		clearBtn.addEventListener('click', () => this.clearCurrentPageAnnotations());
	}

	private pageIndicator!: HTMLSpanElement;

	private updatePageIndicator() {
		if (this.pageIndicator) {
			this.pageIndicator.textContent = this.totalPages > 0 
				? `${this.currentVisiblePage} / ${this.totalPages}`
				: '- / -';
		}
	}
	
	private updateZoomIndicator() {
		if (this.zoomIndicator) {
			this.zoomIndicator.textContent = `${Math.round(this.scale * 100)}%`;
		}
	}
	
	private zoomIn() {
		if (this.scale < this.MAX_SCALE) {
			this.scale = Math.min(this.MAX_SCALE, this.scale + this.SCALE_STEP);
			this.updateZoomIndicator();
			this.reRenderAllPages();
		}
	}
	
	private zoomOut() {
		if (this.scale > this.MIN_SCALE) {
			this.scale = Math.max(this.MIN_SCALE, this.scale - this.SCALE_STEP);
			this.updateZoomIndicator();
			this.reRenderAllPages();
		}
	}
	
	private async fitToWidth() {
		if (!this.pdfDoc) return;

		try {
			// Get first page to calculate fit
			const page = await this.pdfDoc.getPage(1);
			// Force rotation to 0 to get correct upright dimensions
			const defaultViewport = page.getViewport({ scale: 1, rotation: 0 });

			// Calculate scale to fit container width (with some padding)
			const containerWidth = this.pdfContainerEl.clientWidth - 60; // 20px padding + scrollbar
			this.scale = containerWidth / defaultViewport.width;

			// Clamp to min/max
			this.scale = Math.max(this.MIN_SCALE, Math.min(this.MAX_SCALE, this.scale));

			this.updateZoomIndicator();
			this.reRenderAllPages();
		} catch (error) {
			console.error('Marginalia: Error fitting to width:', error);
		}
	}
	
	private async reRenderAllPages() {
		if (!this.pdfDoc) return;
		
		// Save current scroll position ratio
		const scrollRatio = this.pdfContainerEl.scrollTop / (this.pdfContainerEl.scrollHeight || 1);
		
		// Mark all pages as not rendered
		this.pageElements.forEach(pe => {
			// Save annotations before re-rendering
			if (pe.drawingCanvas && pe.rendered) {
				this.pageAnnotations[pe.pageNum] = pe.drawingCanvas.getStrokes();
				pe.drawingCanvas.destroy();
				pe.drawingCanvas = null;
			}
			pe.rendered = false;
		});
		
		// Re-render visible pages
		const visiblePageNums: number[] = [];
		this.pageElements.forEach((pe, idx) => {
			const rect = pe.wrapper.getBoundingClientRect();
			const containerRect = this.pdfContainerEl.getBoundingClientRect();
			if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
				visiblePageNums.push(idx + 1);
			}
		});
		
		// Render at least the current visible page
		if (visiblePageNums.length === 0 && this.currentVisiblePage > 0) {
			visiblePageNums.push(this.currentVisiblePage);
		}
		
		for (const pageNum of visiblePageNums) {
			await this.renderPageIfNeeded(pageNum);
		}
		
		// Restore scroll position
		requestAnimationFrame(() => {
			this.pdfContainerEl.scrollTop = scrollRatio * this.pdfContainerEl.scrollHeight;
		});
	}
	
	private createRadialMenu() {
		// Define tools and colors for the radial menu
		const menuItems = [
			// Tools (top half)
			{ type: 'tool', value: 'pen', icon: '✏️', label: 'Pen', angle: 270 },
			{ type: 'tool', value: 'highlighter', icon: '🖍️', label: 'Highlight', angle: 315 },
			{ type: 'tool', value: 'eraser', icon: '🧹', label: 'Eraser', angle: 225 },
			{ type: 'tool', value: 'hand', icon: '🖐️', label: 'Hand', angle: 180 },
			// Colors (bottom half)
			{ type: 'color', value: '#000000', icon: '⬛', label: 'Black', angle: 0 },
			{ type: 'color', value: '#FF0000', icon: '🔴', label: 'Red', angle: 45 },
			{ type: 'color', value: '#0000FF', icon: '🔵', label: 'Blue', angle: 90 },
			{ type: 'color', value: '#FFFF00', icon: '🟡', label: 'Yellow', angle: 135 },
		];
		
		// Create radial menu container
		const menu = document.createElement('div');
		menu.className = 'radial-menu';
		menu.style.display = 'none';
		this.radialMenuEl = menu;
		
		// Create center (cancel/close)
		const center = document.createElement('div');
		center.className = 'radial-menu-center';
		center.innerHTML = '✕';
		center.addEventListener('pointerup', () => this.hideRadialMenu());
		menu.appendChild(center);
		
		// Create menu items in a circle
		const radius = 70; // Distance from center
		menuItems.forEach(item => {
			const itemEl = document.createElement('div');
			itemEl.className = 'radial-menu-item';
			itemEl.setAttribute('data-type', item.type);
			itemEl.setAttribute('data-value', item.value);
			
			// Position using angle
			const angleRad = (item.angle * Math.PI) / 180;
			const x = Math.cos(angleRad) * radius;
			const y = Math.sin(angleRad) * radius;
			
			itemEl.style.transform = `translate(${x}px, ${y}px)`;
			itemEl.innerHTML = item.icon;
			itemEl.title = item.label;
			
			// Add color indicator for color items
			if (item.type === 'color') {
				itemEl.style.setProperty('--item-color', item.value);
			}
			
			// Handle selection
			itemEl.addEventListener('pointerup', (e) => {
				e.stopPropagation();
				this.handleRadialMenuSelection(item.type, item.value);
			});
			
			menu.appendChild(itemEl);
		});
		
		// Add to container
		this.containerEl.appendChild(menu);
		
		// Close menu when clicking outside
		document.addEventListener('pointerdown', (e) => {
			if (this.radialMenuVisible && this.radialMenuEl && 
				!this.radialMenuEl.contains(e.target as Node)) {
				this.hideRadialMenu();
			}
		});
	}
	
	private showRadialMenu(x: number, y: number) {
		if (!this.radialMenuEl) return;
		
		// Position the menu at the long press location
		const containerRect = this.containerEl.getBoundingClientRect();
		
		// Clamp position to keep menu within view
		const menuSize = 180; // Approximate menu diameter
		const halfMenu = menuSize / 2;
		
		const clampedX = Math.max(halfMenu, Math.min(containerRect.width - halfMenu, x));
		const clampedY = Math.max(halfMenu, Math.min(containerRect.height - halfMenu, y));
		
		this.radialMenuEl.style.left = `${clampedX}px`;
		this.radialMenuEl.style.top = `${clampedY}px`;
		this.radialMenuEl.style.display = 'flex';
		this.radialMenuVisible = true;
		
		// Highlight current tool and color
		this.radialMenuEl.querySelectorAll('.radial-menu-item').forEach(item => {
			const type = item.getAttribute('data-type');
			const value = item.getAttribute('data-value');
			item.classList.remove('active');
			
			if (type === 'tool' && value === this.currentTool) {
				item.classList.add('active');
			}
			if (type === 'color' && value === this.currentColor) {
				item.classList.add('active');
			}
		});
	}
	
	private hideRadialMenu() {
		if (!this.radialMenuEl) return;
		this.radialMenuEl.style.display = 'none';
		this.radialMenuVisible = false;
	}
	
	private handleRadialMenuSelection(type: string, value: string) {
		if (type === 'tool') {
			this.currentTool = value as Tool;
			// Update toolbar UI
			this.toolbarEl.querySelectorAll('.tool-btn').forEach(b => {
				b.classList.remove('active');
				if (b.getAttribute('data-tool') === value) {
					b.classList.add('active');
				}
			});
			// Apply to all canvases
			this.pageElements.forEach(pe => {
				if (pe.drawingCanvas) {
					pe.drawingCanvas.setTool(value as Tool);
				}
			});
		} else if (type === 'color') {
			this.currentColor = value;
			// Update toolbar UI
			this.toolbarEl.querySelectorAll('.color-btn').forEach(b => {
				b.classList.remove('active');
				if (b.getAttribute('data-color') === value) {
					b.classList.add('active');
				}
			});
			// Apply to all canvases
			this.pageElements.forEach(pe => {
				if (pe.drawingCanvas) {
					pe.drawingCanvas.setColor(value);
				}
			});
		}
		
		this.hideRadialMenu();
	}

	private showWelcomeMessage() {
		const welcomeEl = this.pagesContainerEl.createDiv({ cls: 'welcome-message' });
		welcomeEl.innerHTML = `
			<div class="welcome-content">
				<h2>📝 Marginalia</h2>
				<p class="tagline"><em>Write in the margins.</em></p>
				<p>Click <strong>Load</strong> to open a PDF file for annotation.</p>
				<p class="hint">Scroll through pages naturally. Use Apple Pencil to annotate.</p>
				<div class="features">
					<span>✏️ Pen</span>
					<span>🖍️ Highlighter</span>
					<span>🧹 Eraser</span>
				</div>
				<p class="version">${PLUGIN_VERSION}</p>
			</div>
		`;
	}

	async promptLoadPDF() {
		const pdfFiles = this.app.vault.getFiles().filter(f => f.extension === 'pdf');
		
		if (pdfFiles.length === 0) {
			new Notice('No PDF files found in your vault. Add a PDF file first.');
			return;
		}

		const modal = document.createElement('div');
		modal.className = 'pdf-picker-modal';
		modal.innerHTML = `
			<div class="pdf-picker-backdrop"></div>
			<div class="pdf-picker-content">
				<h3>Select a PDF</h3>
				<div class="pdf-picker-list"></div>
				<button class="pdf-picker-close">Cancel</button>
			</div>
		`;

		const listEl = modal.querySelector('.pdf-picker-list') as HTMLElement;
		pdfFiles.forEach(file => {
			const item = document.createElement('div');
			item.className = 'pdf-picker-item';
			item.textContent = file.path;
			item.addEventListener('click', () => {
				this.loadPDF(file);
				modal.remove();
			});
			listEl.appendChild(item);
		});

		const closeBtn = modal.querySelector('.pdf-picker-close') as HTMLElement;
		closeBtn.addEventListener('click', () => modal.remove());
		
		const backdrop = modal.querySelector('.pdf-picker-backdrop') as HTMLElement;
		backdrop.addEventListener('click', () => modal.remove());

		document.body.appendChild(modal);
	}

	async loadPDF(file: TFile) {
		try {
			new Notice(`Loading ${file.name}...`);
			
			// Clean up previous PDF
			this.cleanupPages();
			
			const arrayBuffer = await this.app.vault.readBinary(file);
			const uint8Array = new Uint8Array(arrayBuffer);
			
			const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
			
			const loadingTask = pdfjsLib.getDocument({
				data: uint8Array,
				useWorkerFetch: false,
				isEvalSupported: false,
				useSystemFonts: true,
				...(isMobileDevice ? { disableWorker: true } : {}),
			});
			
			this.pdfDoc = await loadingTask.promise;
			this.totalPages = this.pdfDoc.numPages;
			this.currentFile = file;
			this.currentVisiblePage = 1;

			// Remove welcome message
			const welcomeEl = this.pagesContainerEl.querySelector('.welcome-message');
			if (welcomeEl) {
				welcomeEl.remove();
			}

			// Create page placeholders for all pages
			await this.createPagePlaceholders();
			
			// Load saved annotations
			await this.loadAnnotations();
			
			// Render first few pages immediately
			for (let i = 1; i <= Math.min(3, this.totalPages); i++) {
				await this.renderPageIfNeeded(i);
			}
			
			this.updatePageIndicator();
			new Notice(`Loaded: ${file.name} (${this.totalPages} pages)`);
		} catch (error) {
			console.error('Marginalia - Error loading PDF:', error);
			const errorMsg = error instanceof Error ? error.message : String(error);
			new Notice(`PDF Error: ${errorMsg}`, 10000);
		}
	}

	private async createPagePlaceholders() {
		if (!this.pdfDoc) return;

		this.pageElements = [];

		// Get first page to estimate dimensions (most PDFs have uniform page sizes)
		const firstPage = await this.pdfDoc.getPage(1);
		// Force rotation to 0 to get correct upright dimensions
		const defaultViewport = firstPage.getViewport({ scale: this.scale, rotation: 0 });

		// Ensure we have valid dimensions
		const defaultWidth = Math.max(defaultViewport.width, 400);
		const defaultHeight = Math.max(defaultViewport.height, 500);

		const firstPageRotation = firstPage.rotate || 0;
		console.log(`Marginalia: First page viewport raw: ${defaultViewport.width}x${defaultViewport.height} (rotation: ${firstPageRotation}°)`);
		console.log(`Marginalia: Creating ${this.totalPages} page placeholders (${defaultWidth}x${defaultHeight})`);
		
		for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
			// Create page wrapper with default size (will adjust when rendered)
			const wrapper = this.pagesContainerEl.createDiv({ 
				cls: 'pdf-page-wrapper',
				attr: { 'data-page': pageNum.toString() }
			});
			// Set dimensions explicitly
			wrapper.style.width = `${Math.floor(defaultWidth)}px`;
			wrapper.style.height = `${Math.floor(defaultHeight)}px`;
			wrapper.style.minWidth = `${Math.floor(defaultWidth)}px`;
			wrapper.style.minHeight = `${Math.floor(defaultHeight)}px`;
			
			// Create PDF canvas with explicit dimensions
			const pdfCanvas = wrapper.createEl('canvas', { cls: 'pdf-page-canvas' });
			pdfCanvas.width = Math.floor(defaultWidth);
			pdfCanvas.height = Math.floor(defaultHeight);
			pdfCanvas.style.width = `${Math.floor(defaultWidth)}px`;
			pdfCanvas.style.height = `${Math.floor(defaultHeight)}px`;
			
			// Fill with light gray placeholder
			const ctx = pdfCanvas.getContext('2d');
			if (ctx) {
				ctx.fillStyle = '#f0f0f0';
				ctx.fillRect(0, 0, pdfCanvas.width, pdfCanvas.height);
				ctx.fillStyle = '#888';
				ctx.font = '24px sans-serif';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(`Loading Page ${pageNum}...`, pdfCanvas.width / 2, pdfCanvas.height / 2);
			}
			
			// Page number label
			const pageLabel = wrapper.createDiv({ cls: 'pdf-page-label' });
			pageLabel.textContent = `Page ${pageNum}`;
			
			const pageElement: PageElement = {
				wrapper,
				pdfCanvas,
				drawingCanvas: null,
				rendered: false,
				pageNum
			};
			
			this.pageElements.push(pageElement);
			
			// Observe this page for lazy loading
			if (this.pageObserver) {
				this.pageObserver.observe(wrapper);
			}
		}
		
		console.log('Marginalia: Page placeholders created');
	}

	private async renderPageIfNeeded(pageNum: number) {
		const pageElement = this.pageElements[pageNum - 1];
		if (!pageElement || pageElement.rendered || !this.pdfDoc) {
			return;
		}

		console.log(`Marginalia: Rendering page ${pageNum}`);

		try {
			const page = await this.pdfDoc.getPage(pageNum);

			// Get the page's intrinsic rotation (0, 90, 180, or 270 degrees)
			const pageRotation = page.rotate || 0;
			console.log(`Marginalia: Page ${pageNum} has rotation: ${pageRotation}°`);

			// Use devicePixelRatio for crisp rendering on high-DPI displays
			const dpr = window.devicePixelRatio || 1;

			// Get viewport with the page's natural rotation to get correct dimensions
			const defaultViewport = page.getViewport({ scale: this.scale });

			// CSS dimensions (display size)
			let displayWidth = Math.floor(defaultViewport.width);
			let displayHeight = Math.floor(defaultViewport.height);

			// Canvas dimensions (actual pixel resolution for crisp rendering)
			let canvasWidth = Math.floor(defaultViewport.width * dpr);
			let canvasHeight = Math.floor(defaultViewport.height * dpr);

			// Update wrapper size (CSS pixels)
			pageElement.wrapper.style.width = `${displayWidth}px`;
			pageElement.wrapper.style.height = `${displayHeight}px`;

			// Set canvas to high-resolution
			pageElement.pdfCanvas.width = canvasWidth;
			pageElement.pdfCanvas.height = canvasHeight;
			pageElement.pdfCanvas.style.width = `${displayWidth}px`;
			pageElement.pdfCanvas.style.height = `${displayHeight}px`;

			const ctx = pageElement.pdfCanvas.getContext('2d');
			if (!ctx) {
				console.error(`Marginalia: Could not get context for page ${pageNum}`);
				return;
			}

			// Fill with white background at full resolution
			ctx.fillStyle = 'white';
			ctx.fillRect(0, 0, canvasWidth, canvasHeight);

			// Save the context state before applying transformations
			ctx.save();

			// Apply transformation to correct rotation
			if (pageRotation === 180) {
				// For 180° rotation: flip both axes
				ctx.translate(canvasWidth, canvasHeight);
				ctx.rotate(Math.PI); // 180 degrees in radians
				console.log(`Marginalia: Applying 180° correction transform for page ${pageNum}`);
			} else if (pageRotation === 90) {
				// For 90° clockwise rotation: rotate counter-clockwise
				ctx.translate(canvasWidth, 0);
				ctx.rotate(Math.PI / 2); // 90 degrees
				console.log(`Marginalia: Applying 90° correction transform for page ${pageNum}`);
			} else if (pageRotation === 270) {
				// For 270° clockwise rotation: rotate 90° counter-clockwise
				ctx.translate(0, canvasHeight);
				ctx.rotate(-Math.PI / 2); // -90 degrees
				console.log(`Marginalia: Applying 270° correction transform for page ${pageNum}`);
			}

			// Now get viewport that will render as if rotation is 0 (corrected by our transform)
			const renderViewport = page.getViewport({ scale: this.scale * dpr, rotation: 0 });

			await page.render({
				canvasContext: ctx,
				viewport: renderViewport,
			}).promise;

			// Restore the context state
			ctx.restore();

			console.log(`Marginalia: Page ${pageNum} PDF rendered at ${dpr}x resolution (rotation ${pageRotation}° corrected)`);

			// Create drawing canvas for this page (use display dimensions)
			pageElement.drawingCanvas = new DrawingCanvas(
				pageElement.wrapper,
				displayWidth,
				displayHeight,
				dpr  // Pass DPR for high-res drawing
			);
			
			// Apply current tool and color
			pageElement.drawingCanvas.setTool(this.currentTool);
			pageElement.drawingCanvas.setColor(this.currentColor);
			
			// Setup long press for radial menu
			pageElement.drawingCanvas.onLongPress = (x, y) => {
				// Convert canvas coords to container coords
				const wrapperRect = pageElement.wrapper.getBoundingClientRect();
				const containerRect = this.containerEl.getBoundingClientRect();
				const menuX = wrapperRect.left - containerRect.left + x;
				const menuY = wrapperRect.top - containerRect.top + y;
				this.showRadialMenu(menuX, menuY);
			};
			
			// Load annotations for this page if any
			const strokes = this.pageAnnotations[pageNum];
			if (strokes && strokes.length > 0) {
				pageElement.drawingCanvas.loadStrokes(strokes);
				console.log(`Marginalia: Loaded ${strokes.length} strokes for page ${pageNum}`);
			}

			pageElement.rendered = true;
			console.log(`Marginalia: Page ${pageNum} fully rendered`);
		} catch (error) {
			console.error(`Marginalia: Error rendering page ${pageNum}:`, error);
		}
	}

	private cleanupPages() {
		// Save any unsaved annotations first
		this.saveAllPageAnnotations();
		
		// Cleanup observers
		if (this.pageObserver) {
			this.pageElements.forEach(pe => {
				this.pageObserver?.unobserve(pe.wrapper);
			});
		}
		
		// Cleanup drawing canvases
		this.pageElements.forEach(pe => {
			if (pe.drawingCanvas) {
				pe.drawingCanvas.destroy();
			}
		});
		
		this.pageElements = [];
		this.pagesContainerEl.empty();
	}

	private selectTool(tool: Tool, btn: HTMLElement) {
		this.toolbarEl.querySelectorAll('.tool-btn').forEach(b => b.removeClass('active'));
		btn.addClass('active');
		
		this.currentTool = tool;
		
		// Apply to all rendered drawing canvases
		this.pageElements.forEach(pe => {
			if (pe.drawingCanvas) {
				pe.drawingCanvas.setTool(tool);
			}
		});
	}

	private selectColor(color: string, btn: HTMLElement) {
		this.toolbarEl.querySelectorAll('.color-btn').forEach(b => b.removeClass('active'));
		btn.addClass('active');
		
		this.currentColor = color;
		
		// Apply to all rendered drawing canvases
		this.pageElements.forEach(pe => {
			if (pe.drawingCanvas) {
				pe.drawingCanvas.setColor(color);
			}
		});
	}

	private clearCurrentPageAnnotations() {
		const pageElement = this.pageElements[this.currentVisiblePage - 1];
		if (pageElement?.drawingCanvas) {
			pageElement.drawingCanvas.clear();
			this.hasUnsavedChanges = true;
			new Notice(`Page ${this.currentVisiblePage} cleared`);
		}
	}

	private saveAllPageAnnotations() {
		this.pageElements.forEach(pe => {
			if (pe.drawingCanvas) {
				const strokes = pe.drawingCanvas.getStrokes();
				if (strokes.length > 0) {
					this.pageAnnotations[pe.pageNum] = strokes;
					this.hasUnsavedChanges = true;
				} else if (this.pageAnnotations[pe.pageNum]) {
					delete this.pageAnnotations[pe.pageNum];
					this.hasUnsavedChanges = true;
				}
			}
		});
	}

	private async saveAnnotations() {
		if (!this.currentFile) {
			new Notice('No PDF loaded');
			return;
		}

		this.saveAllPageAnnotations();

		const hasAnnotations = Object.keys(this.pageAnnotations).length > 0;
		
		const annotationData: AnnotationData = {
			version: PLUGIN_VERSION,
			pdfPath: this.currentFile.path,
			pageAnnotations: this.pageAnnotations
		};

		const annotationPath = this.currentFile.path + '.annotations.json';

		try {
			if (hasAnnotations) {
				const jsonContent = JSON.stringify(annotationData, null, 2);
				
				const existingFile = this.app.vault.getAbstractFileByPath(annotationPath);
				if (existingFile instanceof TFile) {
					await this.app.vault.modify(existingFile, jsonContent);
				} else {
					await this.app.vault.create(annotationPath, jsonContent);
				}
				
				this.hasUnsavedChanges = false;
				new Notice(`Annotations saved (${Object.keys(this.pageAnnotations).length} pages)`);
			} else {
				const existingFile = this.app.vault.getAbstractFileByPath(annotationPath);
				if (existingFile instanceof TFile) {
					await this.app.vault.delete(existingFile);
					new Notice('Annotations file removed');
				} else {
					new Notice('No annotations to save');
				}
			}
		} catch (error) {
			console.error('Error saving annotations:', error);
			new Notice('Error saving annotations');
		}
	}

	private async loadAnnotations() {
		if (!this.currentFile) return;

		const annotationPath = this.currentFile.path + '.annotations.json';
		
		try {
			const existingFile = this.app.vault.getAbstractFileByPath(annotationPath);
			if (existingFile instanceof TFile) {
				const content = await this.app.vault.read(existingFile);
				const data: AnnotationData = JSON.parse(content);
				
				this.pageAnnotations = data.pageAnnotations || {};
				
				const pageCount = Object.keys(this.pageAnnotations).length;
				if (pageCount > 0) {
					new Notice(`Loaded annotations for ${pageCount} page(s)`);
				}
			}
		} catch (error) {
			console.log('No saved annotations found');
		}
	}

	async onClose() {
		this.saveAllPageAnnotations();
		
		if (this.hasUnsavedChanges && this.currentFile) {
			await this.saveAnnotations();
		}
		
		// Cleanup observer
		if (this.pageObserver) {
			this.pageObserver.disconnect();
			this.pageObserver = null;
		}
		
		this.cleanupPages();
		this.pdfDoc = null;
		this.pageAnnotations = {};
	}
}
