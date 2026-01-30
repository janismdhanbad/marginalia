import { TFile } from 'obsidian';
import { AnnotationStorage, Stroke } from './AnnotationStorage';

export type Tool = 'pen' | 'highlighter' | 'eraser' | 'hand';

interface Point {
	x: number;
	y: number;
	pressure: number;
	timestamp: number;
}

export class AnnotationLayer {
	private pdfContainer: HTMLElement;
	private file: TFile;
	private storage: AnnotationStorage;

	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private toolbar: HTMLElement;

	private currentTool: Tool = 'pen';
	private currentColor: string = '#000000';
	private strokes: Stroke[] = [];

	private isDrawing: boolean = false;
	private currentStroke: Stroke | null = null;

	// Drawing settings
	private readonly PEN_WIDTH = 2;
	private readonly HIGHLIGHTER_WIDTH = 20;
	private readonly ERASER_WIDTH = 30;

	// Observers
	private resizeObserver: ResizeObserver;
	private scrollHandler: () => void;

	constructor(
		pdfContainer: HTMLElement,
		file: TFile,
		storage: AnnotationStorage
	) {
		console.log('AnnotationLayer: Initializing for', file.path);
		console.log('AnnotationLayer: Container:', pdfContainer);

		this.pdfContainer = pdfContainer;
		this.file = file;
		this.storage = storage;

		this.createToolbar();
		this.createCanvas();
		this.loadAnnotations();
		this.setupEventListeners();
		this.setupObservers();

		console.log('AnnotationLayer: Initialization complete');
	}

	private createToolbar() {
		// Create toolbar container
		this.toolbar = document.createElement('div');
		this.toolbar.className = 'marginalia-toolbar';

		// Tool buttons
		const tools = [
			{ name: 'pen', icon: '✏️', label: 'Pen' },
			{ name: 'highlighter', icon: '🖍️', label: 'Highlighter' },
			{ name: 'eraser', icon: '🧹', label: 'Eraser' },
			{ name: 'hand', icon: '🖐️', label: 'Hand' }
		];

		tools.forEach(tool => {
			const btn = document.createElement('button');
			btn.className = 'marginalia-tool-btn';
			btn.setAttribute('data-tool', tool.name);
			btn.innerHTML = `${tool.icon}`;
			btn.title = tool.label;
			if (tool.name === 'pen') btn.classList.add('active');

			btn.addEventListener('click', () => {
				this.setTool(tool.name as Tool);
				this.toolbar.querySelectorAll('.marginalia-tool-btn').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
			});

			this.toolbar.appendChild(btn);
		});

		// Color picker
		const colors = ['#000000', '#FF0000', '#0000FF', '#00FF00', '#FFFF00', '#FF00FF'];
		colors.forEach((color, index) => {
			const btn = document.createElement('button');
			btn.className = 'marginalia-color-btn';
			btn.style.backgroundColor = color;
			btn.title = color;
			if (index === 0) btn.classList.add('active');

			btn.addEventListener('click', () => {
				this.currentColor = color;
				this.toolbar.querySelectorAll('.marginalia-color-btn').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
			});

			this.toolbar.appendChild(btn);
		});

		// Save button
		const saveBtn = document.createElement('button');
		saveBtn.className = 'marginalia-save-btn';
		saveBtn.innerHTML = '💾 Save';
		saveBtn.addEventListener('click', () => this.saveAnnotations());
		this.toolbar.appendChild(saveBtn);

		// Clear button
		const clearBtn = document.createElement('button');
		clearBtn.className = 'marginalia-clear-btn';
		clearBtn.innerHTML = '🗑️ Clear';
		clearBtn.addEventListener('click', () => this.clearAnnotations());
		this.toolbar.appendChild(clearBtn);

		// Inject toolbar into PDF viewer
		this.pdfContainer.appendChild(this.toolbar);
	}

	private createCanvas() {
		console.log('AnnotationLayer: Creating canvas...');

		// Create overlay canvas
		this.canvas = document.createElement('canvas');
		this.canvas.className = 'marginalia-canvas';

		const ctx = this.canvas.getContext('2d', {
			willReadFrequently: false,
			desynchronized: true
		});

		if (!ctx) {
			throw new Error('Could not get canvas context');
		}

		this.ctx = ctx;
		this.ctx.lineCap = 'round';
		this.ctx.lineJoin = 'round';

		// Find the PDF content area - try multiple selectors
		let pdfContentArea = this.pdfContainer.querySelector('.pdf-container');

		if (!pdfContentArea) {
			console.log('AnnotationLayer: .pdf-container not found, trying .view-content');
			pdfContentArea = this.pdfContainer.querySelector('.view-content');
		}

		if (!pdfContentArea) {
			console.log('AnnotationLayer: .view-content not found, trying .workspace-leaf-content');
			pdfContentArea = this.pdfContainer.querySelector('.workspace-leaf-content');
		}

		if (!pdfContentArea) {
			console.log('AnnotationLayer: No suitable container found, using root container');
			pdfContentArea = this.pdfContainer;
		}

		console.log('AnnotationLayer: Using container:', pdfContentArea);

		// Position canvas over PDF
		this.updateCanvasSize();

		// Make the container relative for absolute positioning
		(pdfContentArea as HTMLElement).style.position = 'relative';

		// Inject canvas
		pdfContentArea.appendChild(this.canvas);
		console.log('AnnotationLayer: Canvas injected');
	}

	private updateCanvasSize() {
		// Find the PDF content area
		let pdfContentArea = this.pdfContainer.querySelector('.pdf-container') as HTMLElement;

		if (!pdfContentArea) {
			pdfContentArea = this.pdfContainer.querySelector('.view-content') as HTMLElement;
		}

		if (!pdfContentArea) {
			pdfContentArea = this.pdfContainer.querySelector('.workspace-leaf-content') as HTMLElement;
		}

		if (!pdfContentArea) {
			pdfContentArea = this.pdfContainer;
		}

		const rect = pdfContentArea.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;

		console.log(`AnnotationLayer: Canvas size: ${rect.width}x${rect.height}, DPR: ${dpr}`);

		// Set canvas size to match PDF container
		this.canvas.width = rect.width * dpr;
		this.canvas.height = rect.height * dpr;
		this.canvas.style.width = `${rect.width}px`;
		this.canvas.style.height = `${rect.height}px`;

		// Scale context for high-DPI
		this.ctx.scale(dpr, dpr);

		// Redraw all strokes after resize
		this.redrawAllStrokes();
	}

	private setupEventListeners() {
		// Drawing events
		this.canvas.addEventListener('pointerdown', this.handlePointerDown.bind(this));
		this.canvas.addEventListener('pointermove', this.handlePointerMove.bind(this));
		this.canvas.addEventListener('pointerup', this.handlePointerUp.bind(this));
		this.canvas.addEventListener('pointerleave', this.handlePointerUp.bind(this));
		this.canvas.addEventListener('pointercancel', this.handlePointerUp.bind(this));

		// Touch handling
		this.canvas.addEventListener('touchstart', (e: TouchEvent) => {
			if (this.currentTool !== 'hand' && e.touches.length === 1) {
				// Allow single-finger drawing
			} else {
				// Allow multi-finger gestures to pass through
				return;
			}
		}, { passive: true });
	}

	private setupObservers() {
		console.log('AnnotationLayer: Setting up observers...');

		// Watch for PDF container resize
		this.resizeObserver = new ResizeObserver(() => {
			console.log('AnnotationLayer: Resize detected');
			this.updateCanvasSize();
		});

		// Find the container to observe
		let pdfContentArea = this.pdfContainer.querySelector('.pdf-container') as HTMLElement;
		if (!pdfContentArea) {
			pdfContentArea = this.pdfContainer.querySelector('.view-content') as HTMLElement;
		}
		if (!pdfContentArea) {
			pdfContentArea = this.pdfContainer.querySelector('.workspace-leaf-content') as HTMLElement;
		}
		if (!pdfContentArea) {
			pdfContentArea = this.pdfContainer;
		}

		this.resizeObserver.observe(pdfContentArea);
		console.log('AnnotationLayer: ResizeObserver attached');

		// Watch for scroll events (to sync annotations)
		this.scrollHandler = () => {
			// Canvas position is handled by CSS
		};

		// Attach scroll listener to the container
		pdfContentArea.addEventListener('scroll', this.scrollHandler);
		console.log('AnnotationLayer: Scroll handler attached');
	}

	private handlePointerDown(e: PointerEvent) {
		if (this.currentTool === 'hand') return;

		// Basic palm rejection - skip touch events
		if (e.pointerType === 'touch' && e.pointerType !== 'pen') {
			return;
		}

		this.isDrawing = true;
		this.canvas.setPointerCapture(e.pointerId);

		const point = this.getPointFromEvent(e);

		this.currentStroke = {
			points: [point],
			tool: this.currentTool,
			color: this.currentColor,
			width: this.getLineWidth()
		};

		this.setupContextForTool();
		this.ctx.beginPath();
		this.ctx.moveTo(point.x, point.y);
	}

	private handlePointerMove(e: PointerEvent) {
		if (!this.isDrawing || !this.currentStroke) return;

		const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];

		for (const event of events) {
			const point = this.getPointFromEvent(event);
			this.currentStroke.points.push(point);

			// Draw segment
			this.ctx.lineWidth = this.getLineWidth();
			this.ctx.lineTo(point.x, point.y);
			this.ctx.stroke();
		}
	}

	private handlePointerUp(e: PointerEvent) {
		if (!this.isDrawing) return;

		this.isDrawing = false;

		if (this.currentStroke && this.currentStroke.points.length > 0) {
			this.strokes.push(this.currentStroke);
		}

		this.currentStroke = null;
		this.canvas.releasePointerCapture(e.pointerId);
	}

	private getPointFromEvent(e: PointerEvent): Point {
		const rect = this.canvas.getBoundingClientRect();

		return {
			x: e.clientX - rect.left,
			y: e.clientY - rect.top,
			pressure: e.pressure || 0.5,
			timestamp: e.timeStamp
		};
	}

	private getLineWidth(): number {
		switch (this.currentTool) {
			case 'pen':
				return this.PEN_WIDTH;
			case 'highlighter':
				return this.HIGHLIGHTER_WIDTH;
			case 'eraser':
				return this.ERASER_WIDTH;
			default:
				return this.PEN_WIDTH;
		}
	}

	private setupContextForTool() {
		switch (this.currentTool) {
			case 'pen':
				this.ctx.globalCompositeOperation = 'source-over';
				this.ctx.strokeStyle = this.currentColor;
				this.ctx.globalAlpha = 1;
				break;
			case 'highlighter':
				this.ctx.globalCompositeOperation = 'source-over';
				this.ctx.strokeStyle = this.currentColor;
				this.ctx.globalAlpha = 0.3;
				break;
			case 'eraser':
				this.ctx.globalCompositeOperation = 'destination-out';
				this.ctx.strokeStyle = 'rgba(0,0,0,1)';
				this.ctx.globalAlpha = 1;
				break;
		}
	}

	private redrawAllStrokes() {
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

		for (const stroke of this.strokes) {
			if (stroke.points.length === 0) continue;

			// Save the current context state
			this.ctx.save();

			const originalTool = this.currentTool;
			const originalColor = this.currentColor;

			this.currentTool = stroke.tool;
			this.currentColor = stroke.color;
			this.setupContextForTool();

			this.ctx.beginPath();
			this.ctx.lineWidth = stroke.width;
			this.ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

			for (let i = 1; i < stroke.points.length; i++) {
				const point = stroke.points[i];
				this.ctx.lineTo(point.x, point.y);
			}
			this.ctx.stroke();

			this.currentTool = originalTool;
			this.currentColor = originalColor;

			// Restore the context state
			this.ctx.restore();
		}

		// Reset to current tool after redraw
		this.setupContextForTool();
	}

	private setTool(tool: Tool) {
		this.currentTool = tool;

		if (tool === 'hand') {
			this.canvas.style.pointerEvents = 'none';
		} else {
			this.canvas.style.pointerEvents = 'auto';
		}
	}

	private async saveAnnotations() {
		await this.storage.saveAnnotations(this.file, this.strokes);
	}

	private async loadAnnotations() {
		this.strokes = await this.storage.loadAnnotations(this.file);
		this.redrawAllStrokes();
	}

	private clearAnnotations() {
		this.strokes = [];
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
	}

	public destroy() {
		// Remove event listeners
		this.canvas.remove();
		this.toolbar.remove();

		// Cleanup observers
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
		}

		const scrollContainer = this.pdfContainer.querySelector('.pdf-viewer');
		if (scrollContainer && this.scrollHandler) {
			scrollContainer.removeEventListener('scroll', this.scrollHandler);
		}
	}
}
