import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import * as pdfjsLib from 'pdfjs-dist';
import type PDFAnnotatorPlugin from './main';
import { DrawingCanvas, Tool, Stroke, AnnotationData } from './DrawingCanvas';

export const VIEW_TYPE_PDF_ANNOTATION = 'pdf-annotation-view';
export const PLUGIN_VERSION = 'v0.3.0';  // Continuous scroll update

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
	private scale: number = 1.5;
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
		
		for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
			const page = await this.pdfDoc.getPage(pageNum);
			const viewport = page.getViewport({ scale: this.scale });
			
			// Create page wrapper
			const wrapper = this.pagesContainerEl.createDiv({ 
				cls: 'pdf-page-wrapper',
				attr: { 'data-page': pageNum.toString() }
			});
			wrapper.style.width = `${viewport.width}px`;
			wrapper.style.height = `${viewport.height}px`;
			
			// Create PDF canvas
			const pdfCanvas = wrapper.createEl('canvas', { cls: 'pdf-page-canvas' });
			pdfCanvas.width = viewport.width;
			pdfCanvas.height = viewport.height;
			
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
	}

	private async renderPageIfNeeded(pageNum: number) {
		const pageElement = this.pageElements[pageNum - 1];
		if (!pageElement || pageElement.rendered || !this.pdfDoc) return;

		try {
			const page = await this.pdfDoc.getPage(pageNum);
			const viewport = page.getViewport({ scale: this.scale });

			const ctx = pageElement.pdfCanvas.getContext('2d');
			if (!ctx) return;

			// Fill with white background
			ctx.fillStyle = 'white';
			ctx.fillRect(0, 0, viewport.width, viewport.height);

			await page.render({
				canvasContext: ctx,
				viewport: viewport,
			}).promise;

			// Create drawing canvas for this page
			pageElement.drawingCanvas = new DrawingCanvas(
				pageElement.wrapper,
				viewport.width,
				viewport.height
			);
			
			// Apply current tool and color
			pageElement.drawingCanvas.setTool(this.currentTool);
			pageElement.drawingCanvas.setColor(this.currentColor);
			
			// Load annotations for this page if any
			const strokes = this.pageAnnotations[pageNum];
			if (strokes && strokes.length > 0) {
				pageElement.drawingCanvas.loadStrokes(strokes);
			}

			pageElement.rendered = true;
		} catch (error) {
			console.error(`Error rendering page ${pageNum}:`, error);
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
