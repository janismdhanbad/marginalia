export type Tool = 'pen' | 'highlighter' | 'eraser' | 'hand';

export interface Point {
	x: number;
	y: number;
	pressure: number;
	tiltX: number;
	tiltY: number;
	timestamp: number;
}

export interface Stroke {
	points: Point[];
	tool: Tool;
	color: string;
	lineWidth: number;
}

// Annotation data structure for saving/loading
export interface AnnotationData {
	version: string;
	pdfPath: string;
	pageAnnotations: { [pageNum: number]: Stroke[] };
}

export class DrawingCanvas {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private containerEl: HTMLElement;
	
	private isDrawing: boolean = false;
	private currentStroke: Stroke | null = null;
	private strokes: Stroke[] = [];
	
	private currentTool: Tool = 'pen';
	private currentColor: string = '#000000';
	
	// Offscreen canvas for highlighter (to avoid opacity stacking without expensive snapshot)
	private highlightCanvas: HTMLCanvasElement | null = null;
	private highlightCtx: CanvasRenderingContext2D | null = null;
	// Background snapshot for fast compositing
	private backgroundSnapshot: ImageData | null = null;
	// RAF throttling for highlighter
	private highlightRAF: number | null = null;
	private needsHighlightUpdate: boolean = false;
	
	// Long press detection for radial menu
	private longPressTimeout: number | null = null;
	private longPressStartPos: { x: number; y: number } | null = null;
	private readonly LONG_PRESS_DURATION = 500; // ms
	private readonly LONG_PRESS_THRESHOLD = 10; // pixels - movement tolerance
	
	// Callback for long press
	public onLongPress: ((x: number, y: number) => void) | null = null;
	
	// Drawing settings
	private readonly PEN_MIN_WIDTH = 1;
	private readonly PEN_MAX_WIDTH = 4;
	private readonly HIGHLIGHTER_WIDTH = 20;
	private readonly ERASER_WIDTH = 30;
	
	// High-DPI support
	private dpr: number = 1;
	private displayWidth: number;
	private displayHeight: number;

	constructor(container: HTMLElement, width: number, height: number, dpr: number = 1) {
		this.containerEl = container;
		this.dpr = dpr;
		this.displayWidth = width;
		this.displayHeight = height;
		
		// Create canvas element with high-DPI support
		this.canvas = document.createElement('canvas');
		this.canvas.className = 'pdf-annotator-drawing-canvas';
		
		// Set canvas to high resolution
		this.canvas.width = Math.floor(width * dpr);
		this.canvas.height = Math.floor(height * dpr);
		
		// But display at normal size
		this.canvas.style.width = `${width}px`;
		this.canvas.style.height = `${height}px`;
		
		const ctx = this.canvas.getContext('2d', { 
			willReadFrequently: false,
			desynchronized: true // Better performance for drawing
		});
		
		if (!ctx) {
			throw new Error('Could not get canvas context');
		}
		this.ctx = ctx;
		
		// Scale context to match DPR for crisp lines
		this.ctx.scale(dpr, dpr);
		
		// Enable smooth rendering
		this.ctx.lineCap = 'round';
		this.ctx.lineJoin = 'round';
		
		// Add canvas to container
		this.containerEl.appendChild(this.canvas);
		
		// Setup event listeners
		this.setupEventListeners();
	}

	private setupEventListeners() {
		// Use pointer events for Apple Pencil support
		this.canvas.addEventListener('pointerdown', this.handlePointerDown.bind(this));
		this.canvas.addEventListener('pointermove', this.handlePointerMove.bind(this));
		this.canvas.addEventListener('pointerup', this.handlePointerUp.bind(this));
		this.canvas.addEventListener('pointerleave', this.handlePointerUp.bind(this));
		this.canvas.addEventListener('pointercancel', this.handlePointerUp.bind(this));
		
		// Allow two-finger scroll/pan to pass through
		this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
		this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
		
		// Default: allow pan-y for scrolling, drawing handled by pointer events
		this.updateTouchAction();
	}

	private handleTouchStart(e: TouchEvent) {
		// Allow two-finger gestures (scrolling/zooming) to pass through
		if (e.touches.length >= 2 || this.currentTool === 'hand') {
			// Don't prevent default - allow scrolling
			return;
		}
		// Single finger - prevent for drawing (but only for pen, handled in pointerdown)
	}

	private handleTouchMove(e: TouchEvent) {
		// Allow two-finger gestures to pass through
		if (e.touches.length >= 2 || this.currentTool === 'hand') {
			return;
		}
		// Only prevent default if we're actively drawing
		if (this.isDrawing) {
			e.preventDefault();
		}
	}

	private updateTouchAction() {
		if (this.currentTool === 'hand') {
			// Hand tool: allow all touch actions (pan, zoom)
			this.canvas.style.touchAction = 'auto';
			this.canvas.style.pointerEvents = 'none';
		} else {
			// Drawing tools: capture pen, allow two-finger scroll
			this.canvas.style.touchAction = 'pan-x pan-y pinch-zoom';
			this.canvas.style.pointerEvents = 'auto';
		}
	}

	private handlePointerDown(e: PointerEvent) {
		// Hand tool - let events pass through
		if (this.currentTool === 'hand') {
			return;
		}

		const isPen = e.pointerType === 'pen';
		const isTouch = e.pointerType === 'touch';
		
		// For annotation, we primarily want pen input
		// Allow mouse for testing on desktop
		// Skip touch to avoid palm input (palm rejection)
		if (isTouch && !isPen) {
			// Skip touch events when not from pen - basic palm rejection
			return;
		}
		
		// Start long press detection
		this.longPressStartPos = { x: e.clientX, y: e.clientY };
		this.longPressTimeout = window.setTimeout(() => {
			if (this.longPressStartPos && this.onLongPress) {
				// Trigger long press callback with canvas-relative position
				const rect = this.canvas.getBoundingClientRect();
				const x = this.longPressStartPos.x - rect.left;
				const y = this.longPressStartPos.y - rect.top;
				this.onLongPress(x, y);
				
				// Cancel drawing
				this.isDrawing = false;
				this.currentStroke = null;
				this.longPressStartPos = null;
			}
		}, this.LONG_PRESS_DURATION);
		
		this.isDrawing = true;
		this.canvas.setPointerCapture(e.pointerId);
		
		// Create offscreen canvas for highlighter to avoid opacity stacking
		if (this.currentTool === 'highlighter') {
			// Save background once at start (fast)
			this.backgroundSnapshot = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
			
			this.highlightCanvas = document.createElement('canvas');
			this.highlightCanvas.width = this.canvas.width;
			this.highlightCanvas.height = this.canvas.height;
			this.highlightCtx = this.highlightCanvas.getContext('2d');
			if (this.highlightCtx) {
				this.highlightCtx.scale(this.dpr, this.dpr);  // Match main canvas DPR
				this.highlightCtx.lineCap = 'round';
				this.highlightCtx.lineJoin = 'round';
			}
		}
		
		const point = this.getPointFromEvent(e);
		
		this.currentStroke = {
			points: [point],
			tool: this.currentTool,
			color: this.currentColor,
			lineWidth: this.getLineWidth(point.pressure)
		};
		
		// Start the path
		this.ctx.beginPath();
		this.setupContextForTool();
		this.ctx.moveTo(point.x, point.y);
		
		// Draw a dot for single taps (skip for highlighter - will be drawn in redrawCurrentStroke)
		if (this.currentTool !== 'highlighter') {
			this.drawPoint(point);
		}
	}

	private handlePointerMove(e: PointerEvent) {
		// Cancel long press if moved too far
		if (this.longPressStartPos && this.longPressTimeout) {
			const dx = e.clientX - this.longPressStartPos.x;
			const dy = e.clientY - this.longPressStartPos.y;
			if (Math.sqrt(dx * dx + dy * dy) > this.LONG_PRESS_THRESHOLD) {
				this.cancelLongPress();
			}
		}
		
		if (!this.isDrawing || !this.currentStroke) return;
		
		// Get coalesced events for smoother lines
		const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
		
		for (const event of events) {
			const point = this.getPointFromEvent(event);
			this.currentStroke.points.push(point);
		}
		
		// For highlighter, use offscreen canvas approach
		// For other tools, draw incrementally for better performance
		if (this.currentTool === 'highlighter') {
			this.drawHighlighterSegment();
		} else {
			this.drawSegment(this.currentStroke.points[this.currentStroke.points.length - 1]);
		}
	}

	private handlePointerUp(e: PointerEvent) {
		// Cancel long press detection
		this.cancelLongPress();
		
		if (!this.isDrawing) return;
		
		this.isDrawing = false;
		
		// Final composite for highlighter
		if (this.highlightCanvas && this.backgroundSnapshot) {
			this.compositeHighlightCanvas();
		}
		
		// Cancel any pending RAF
		if (this.highlightRAF) {
			cancelAnimationFrame(this.highlightRAF);
			this.highlightRAF = null;
		}
		
		if (this.currentStroke && this.currentStroke.points.length > 0) {
			// Save the stroke
			this.strokes.push(this.currentStroke);
		}
		
		this.currentStroke = null;
		this.highlightCanvas = null;  // Clear offscreen canvas
		this.highlightCtx = null;
		this.backgroundSnapshot = null;  // Clear snapshot
		this.needsHighlightUpdate = false;
		this.canvas.releasePointerCapture(e.pointerId);
	}

	private getPointFromEvent(e: PointerEvent): Point {
		const rect = this.canvas.getBoundingClientRect();
		const scaleX = this.canvas.width / rect.width;
		const scaleY = this.canvas.height / rect.height;
		
		return {
			x: (e.clientX - rect.left) * scaleX,
			y: (e.clientY - rect.top) * scaleY,
			pressure: e.pressure || 0.5, // Default pressure for mouse
			tiltX: e.tiltX || 0,
			tiltY: e.tiltY || 0,
			timestamp: e.timeStamp
		};
	}

	private getLineWidth(pressure: number): number {
		switch (this.currentTool) {
			case 'pen':
				// Variable width based on pressure
				return this.PEN_MIN_WIDTH + (pressure * (this.PEN_MAX_WIDTH - this.PEN_MIN_WIDTH));
			case 'highlighter':
				return this.HIGHLIGHTER_WIDTH;
			case 'eraser':
				return this.ERASER_WIDTH;
			default:
				return this.PEN_MIN_WIDTH;
		}
	}

	private setupContextForTool() {
		switch (this.currentTool) {
			case 'pen':
				this.ctx.globalCompositeOperation = 'source-over';
				this.ctx.strokeStyle = this.currentColor;
				this.ctx.fillStyle = this.currentColor;
				this.ctx.globalAlpha = 1;
				break;
			case 'highlighter':
				// Use globalAlpha for transparency - more reliable than rgba
				this.ctx.globalCompositeOperation = 'source-over';
				this.ctx.strokeStyle = this.currentColor;
				this.ctx.fillStyle = this.currentColor;
				this.ctx.globalAlpha = 0.3;  // 30% opacity for see-through highlight
				break;
			case 'eraser':
				this.ctx.globalCompositeOperation = 'destination-out';
				this.ctx.strokeStyle = 'rgba(0,0,0,1)';
				this.ctx.fillStyle = 'rgba(0,0,0,1)';
				this.ctx.globalAlpha = 1;
				break;
			case 'hand':
				// Hand tool doesn't draw
				break;
		}
	}

	private drawPoint(point: Point) {
		const radius = this.getLineWidth(point.pressure) / 2;
		
		// setupContextForTool already sets fillStyle and globalAlpha correctly
		this.ctx.beginPath();
		this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
		this.ctx.fill();
	}

	private drawSegment(point: Point) {
		if (!this.currentStroke || this.currentStroke.points.length < 2) return;
		
		const points = this.currentStroke.points;
		const prevPoint = points[points.length - 2];
		
		// Variable line width based on pressure
		this.ctx.lineWidth = this.getLineWidth(point.pressure);
		
		// Use quadratic curve for smoother lines
		if (points.length >= 3) {
			const prevPrevPoint = points[points.length - 3];
			const midX = (prevPoint.x + point.x) / 2;
			const midY = (prevPoint.y + point.y) / 2;
			
			this.ctx.beginPath();
			this.setupContextForTool();
			this.ctx.moveTo(prevPrevPoint.x, prevPrevPoint.y);
			this.ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, midX, midY);
			this.ctx.stroke();
		} else {
			// Simple line for first two points
			this.ctx.beginPath();
			this.setupContextForTool();
			this.ctx.moveTo(prevPoint.x, prevPoint.y);
			this.ctx.lineTo(point.x, point.y);
			this.ctx.stroke();
		}
	}

	// Draw highlighter stroke incrementally to offscreen canvas (fast, no opacity stacking)
	private drawHighlighterSegment() {
		if (!this.currentStroke || !this.highlightCtx || this.currentStroke.points.length < 2) return;
		
		const points = this.currentStroke.points;
		
		// Draw all new segments to offscreen canvas
		this.highlightCtx.strokeStyle = this.currentColor;
		this.highlightCtx.lineWidth = this.HIGHLIGHTER_WIDTH;
		this.highlightCtx.globalAlpha = 1;  // Draw opaque to offscreen
		
		// Draw the latest segment
		const point = points[points.length - 1];
		const prevPoint = points[points.length - 2];
		
		this.highlightCtx.beginPath();
		this.highlightCtx.moveTo(prevPoint.x, prevPoint.y);
		this.highlightCtx.lineTo(point.x, point.y);
		this.highlightCtx.stroke();
		
		// Throttle compositing to animation frame rate for performance
		this.needsHighlightUpdate = true;
		if (!this.highlightRAF) {
			this.highlightRAF = requestAnimationFrame(() => {
				if (this.needsHighlightUpdate) {
					this.compositeHighlightCanvas();
					this.needsHighlightUpdate = false;
				}
				this.highlightRAF = null;
			});
		}
	}
	
	// Composite the highlight canvas onto main canvas (fast - uses saved snapshot)
	private compositeHighlightCanvas() {
		if (!this.highlightCanvas || !this.backgroundSnapshot) return;
		
		// Restore background snapshot (fast)
		this.ctx.putImageData(this.backgroundSnapshot, 0, 0);
		
		// Then composite the current highlight with transparency
		this.ctx.save();
		this.ctx.globalAlpha = 0.3;
		this.ctx.drawImage(this.highlightCanvas, 0, 0);
		this.ctx.restore();
	}
	
	// Cancel long press detection
	private cancelLongPress() {
		if (this.longPressTimeout) {
			window.clearTimeout(this.longPressTimeout);
			this.longPressTimeout = null;
		}
		this.longPressStartPos = null;
	}

	// Redraw all strokes (used after resize or clear)
	private redrawAllStrokes() {
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		
		for (const stroke of this.strokes) {
			if (stroke.points.length === 0) continue;
			
			// Setup context for this stroke's tool
			const originalTool = this.currentTool;
			const originalColor = this.currentColor;
			
			this.currentTool = stroke.tool;
			this.currentColor = stroke.color;
			this.setupContextForTool();
			
			// Draw the stroke
			this.ctx.beginPath();
			this.ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
			
			for (let i = 1; i < stroke.points.length; i++) {
				const point = stroke.points[i];
				this.ctx.lineWidth = this.getLineWidth(point.pressure);
				
				if (i >= 2) {
					const prev = stroke.points[i - 1];
					const midX = (prev.x + point.x) / 2;
					const midY = (prev.y + point.y) / 2;
					this.ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
				} else {
					this.ctx.lineTo(point.x, point.y);
				}
			}
			this.ctx.stroke();
			
			// Restore original settings
			this.currentTool = originalTool;
			this.currentColor = originalColor;
		}
		
		// Reset context
		this.setupContextForTool();
	}

	// Public API
	setTool(tool: Tool) {
		this.currentTool = tool;
		
		// Update touch behavior
		this.updateTouchAction();
		
		// Update cursor
		switch (tool) {
			case 'pen':
				this.canvas.style.cursor = 'crosshair';
				break;
			case 'highlighter':
				this.canvas.style.cursor = 'crosshair';
				break;
			case 'eraser':
				this.canvas.style.cursor = 'cell';
				break;
			case 'hand':
				this.canvas.style.cursor = 'grab';
				break;
		}
	}

	setColor(color: string) {
		this.currentColor = color;
	}

	clear() {
		this.strokes = [];
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
	}

	resize(width: number, height: number) {
		// Store current image data
		const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
		
		// Resize canvas
		this.canvas.width = width;
		this.canvas.height = height;
		
		// Restore settings
		this.ctx.lineCap = 'round';
		this.ctx.lineJoin = 'round';
		
		// Redraw all strokes
		this.redrawAllStrokes();
	}

	getStrokes(): Stroke[] {
		return [...this.strokes];
	}

	loadStrokes(strokes: Stroke[]) {
		this.strokes = strokes;
		this.redrawAllStrokes();
	}

	destroy() {
		// Remove event listeners
		this.canvas.removeEventListener('pointerdown', this.handlePointerDown.bind(this));
		this.canvas.removeEventListener('pointermove', this.handlePointerMove.bind(this));
		this.canvas.removeEventListener('pointerup', this.handlePointerUp.bind(this));
		this.canvas.removeEventListener('pointerleave', this.handlePointerUp.bind(this));
		this.canvas.removeEventListener('pointercancel', this.handlePointerUp.bind(this));
		
		// Remove canvas from DOM
		this.canvas.remove();
	}
}
