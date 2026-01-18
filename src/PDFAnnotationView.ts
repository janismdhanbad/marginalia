import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import * as pdfjsLib from 'pdfjs-dist';
import type PDFAnnotatorPlugin from './main';
import { DrawingCanvas, Tool } from './DrawingCanvas';

export const VIEW_TYPE_PDF_ANNOTATION = 'pdf-annotation-view';
export const PLUGIN_VERSION = 'v0.1.6';  // Increment this when updating

// Check if we're on mobile/tablet
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// Use CDN worker on desktop, will use disableWorker on mobile
if (!isMobile) {
	const PDFJS_VERSION = '4.8.69';
	pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;
}

export class PDFAnnotationView extends ItemView {
	plugin: PDFAnnotatorPlugin;
	private containerEl: HTMLElement;
	private toolbarEl: HTMLElement;
	private pdfContainerEl: HTMLElement;
	private pdfCanvasEl: HTMLCanvasElement;
	private drawingCanvas: DrawingCanvas | null = null;
	
	private pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
	private currentPage: number = 1;
	private totalPages: number = 0;
	private scale: number = 1.5;
	private currentFile: TFile | null = null;

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

		// Create PDF container
		this.pdfContainerEl = this.containerEl.createDiv({ cls: 'pdf-annotator-pdf-container' });
		
		// Create PDF canvas
		this.pdfCanvasEl = this.pdfContainerEl.createEl('canvas', { cls: 'pdf-annotator-pdf-canvas' });

		// Show welcome message
		this.showWelcomeMessage();
	}

	private createToolbar() {
		// File controls
		const fileGroup = this.toolbarEl.createDiv({ cls: 'toolbar-group' });
		
		const loadBtn = fileGroup.createEl('button', { 
			cls: 'toolbar-btn',
			attr: { 'aria-label': 'Load PDF' }
		});
		loadBtn.innerHTML = '📂 Load PDF';
		loadBtn.addEventListener('click', () => this.promptLoadPDF());

		// Navigation controls
		const navGroup = this.toolbarEl.createDiv({ cls: 'toolbar-group nav-group' });
		
		const prevBtn = navGroup.createEl('button', {
			cls: 'toolbar-btn nav-btn',
			attr: { 'aria-label': 'Previous Page' }
		});
		prevBtn.innerHTML = '◀';
		prevBtn.addEventListener('click', () => this.goToPage(this.currentPage - 1));

		this.pageIndicator = navGroup.createSpan({ cls: 'page-indicator' });
		this.updatePageIndicator();

		const nextBtn = navGroup.createEl('button', {
			cls: 'toolbar-btn nav-btn',
			attr: { 'aria-label': 'Next Page' }
		});
		nextBtn.innerHTML = '▶';
		nextBtn.addEventListener('click', () => this.goToPage(this.currentPage + 1));

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

		const handBtn = toolGroup.createEl('button', {
			cls: 'toolbar-btn tool-btn',
			attr: { 'aria-label': 'Pan/Move', 'data-tool': 'hand' }
		});
		handBtn.innerHTML = '✋ Move';
		handBtn.addEventListener('click', () => this.selectTool('hand', handBtn));

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

		// Clear button
		const actionGroup = this.toolbarEl.createDiv({ cls: 'toolbar-group' });
		
		const clearBtn = actionGroup.createEl('button', {
			cls: 'toolbar-btn danger-btn',
			attr: { 'aria-label': 'Clear All' }
		});
		clearBtn.innerHTML = '🗑️ Clear';
		clearBtn.addEventListener('click', () => this.clearAnnotations());
	}

	private pageIndicator!: HTMLSpanElement;

	private updatePageIndicator() {
		if (this.pageIndicator) {
			this.pageIndicator.textContent = this.totalPages > 0 
				? `${this.currentPage} / ${this.totalPages}`
				: '- / -';
		}
	}

	private showWelcomeMessage() {
		const welcomeEl = this.pdfContainerEl.createDiv({ cls: 'welcome-message' });
		welcomeEl.innerHTML = `
			<div class="welcome-content">
				<h2>📝 Marginalia</h2>
				<p class="tagline"><em>Write in the margins.</em></p>
				<p>Click <strong>Load PDF</strong> to open a PDF file for annotation.</p>
				<p class="hint">Use Apple Pencil to draw on the PDF with pressure sensitivity.</p>
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
		// Get all PDF files in the vault
		const pdfFiles = this.app.vault.getFiles().filter(f => f.extension === 'pdf');
		
		if (pdfFiles.length === 0) {
			new Notice('No PDF files found in your vault. Add a PDF file first.');
			return;
		}

		// Create a simple file picker modal
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
			
			// Read the PDF file as array buffer
			const arrayBuffer = await this.app.vault.readBinary(file);
			
			// Convert to Uint8Array for PDF.js compatibility
			const uint8Array = new Uint8Array(arrayBuffer);
			
			// Check if mobile
			const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
			console.log(`Marginalia: Loading PDF, mobile=${isMobileDevice}`);
			
			// Load the PDF document - disable worker on mobile for compatibility
			const loadingTask = pdfjsLib.getDocument({
				data: uint8Array,
				useWorkerFetch: false,
				isEvalSupported: false,
				useSystemFonts: true,
				// Disable worker on mobile where CDN might not be accessible
				...(isMobileDevice ? { disableWorker: true } : {}),
			});
			
			this.pdfDoc = await loadingTask.promise;
			this.totalPages = this.pdfDoc.numPages;
			this.currentPage = 1;
			this.currentFile = file;

			console.log(`Marginalia: PDF loaded - ${this.totalPages} pages`);

			// Remove welcome message
			const welcomeEl = this.pdfContainerEl.querySelector('.welcome-message');
			if (welcomeEl) {
				welcomeEl.remove();
				console.log('Marginalia: Welcome message removed');
			}

			// Render the first page
			await this.renderPage(this.currentPage);
			
			new Notice(`Loaded: ${file.name} (${this.totalPages} pages)`);
		} catch (error) {
			console.error('Marginalia - Error loading PDF:', error);
			const errorMsg = error instanceof Error ? error.message : String(error);
			// Show detailed error to help debug on mobile
			new Notice(`PDF Error: ${errorMsg}`, 10000);  // Show for 10 seconds
		}
	}

	async renderPage(pageNum: number) {
		if (!this.pdfDoc) {
			console.error('Marginalia: No PDF document loaded');
			return;
		}

		try {
			console.log(`Marginalia: Rendering page ${pageNum}`);
			const page = await this.pdfDoc.getPage(pageNum);
			const viewport = page.getViewport({ scale: this.scale });

			console.log(`Marginalia: Page viewport - ${viewport.width}x${viewport.height}`);

			// Set canvas dimensions
			this.pdfCanvasEl.width = viewport.width;
			this.pdfCanvasEl.height = viewport.height;
			
			// Make sure canvas is visible
			this.pdfCanvasEl.style.display = 'block';

			// Render PDF to canvas
			const ctx = this.pdfCanvasEl.getContext('2d');
			if (!ctx) {
				console.error('Marginalia: Could not get canvas context');
				return;
			}

			// Fill with white background first
			ctx.fillStyle = 'white';
			ctx.fillRect(0, 0, viewport.width, viewport.height);

			const renderContext = {
				canvasContext: ctx,
				viewport: viewport,
			};

			await page.render(renderContext).promise;
			console.log('Marginalia: Page rendered successfully');

			// Initialize or update drawing canvas
			if (!this.drawingCanvas) {
				this.drawingCanvas = new DrawingCanvas(
					this.pdfContainerEl,
					viewport.width,
					viewport.height
				);
			} else {
				this.drawingCanvas.resize(viewport.width, viewport.height);
				this.drawingCanvas.clear();
			}

			this.updatePageIndicator();
		} catch (error) {
			console.error('Marginalia - Error rendering page:', error);
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			new Notice(`Error rendering page: ${errorMsg}`);
		}
	}

	async goToPage(pageNum: number) {
		if (!this.pdfDoc) return;
		
		if (pageNum < 1 || pageNum > this.totalPages) {
			return;
		}

		this.currentPage = pageNum;
		await this.renderPage(pageNum);
	}

	private selectTool(tool: Tool, btn: HTMLElement) {
		// Update UI
		this.toolbarEl.querySelectorAll('.tool-btn').forEach(b => b.removeClass('active'));
		btn.addClass('active');

		// Update drawing canvas
		if (this.drawingCanvas) {
			this.drawingCanvas.setTool(tool);
		}
	}

	private selectColor(color: string, btn: HTMLElement) {
		// Update UI
		this.toolbarEl.querySelectorAll('.color-btn').forEach(b => b.removeClass('active'));
		btn.addClass('active');

		// Update drawing canvas
		if (this.drawingCanvas) {
			this.drawingCanvas.setColor(color);
		}
	}

	private clearAnnotations() {
		if (this.drawingCanvas) {
			this.drawingCanvas.clear();
			new Notice('Annotations cleared');
		}
	}

	async onClose() {
		// Cleanup
		if (this.drawingCanvas) {
			this.drawingCanvas.destroy();
			this.drawingCanvas = null;
		}
		this.pdfDoc = null;
	}
}
