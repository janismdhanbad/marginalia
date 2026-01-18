export type Tool = 'pen' | 'highlighter' | 'eraser' | 'hand';

interface Point {
	x: number;
	y: number;
	pressure: number;
	tiltX: number;
	tiltY: number;
	timestamp: number;
}

interface Stroke {
	points: Point[];
	tool: Tool;
	color: string;
	lineWidth: number;
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
	
	// Drawing settings
	private readonly PEN_MIN_WIDTH = 1;
	private readonly PEN_MAX_WIDTH = 4;
	private readonly HIGHLIGHTER_WIDTH = 20;
	private readonly ERASER_WIDTH = 30;

	constructor(container: HTMLElement, width: number, height: number) {
		this.containerEl = container;
		
		// Create canvas element
		this.canvas = document.createElement('canvas');
		this.canvas.className = 'pdf-annotator-drawing-canvas';
		this.canvas.width = width;
		this.canvas.height = height;
		
		const ctx = this.canvas.getContext('2d', { 
			willReadFrequently: false,
			desynchronized: true // Better performance for drawing
		});
		
		if (!ctx) {
			throw new Error('Could not get canvas context');
		}
		this.ctx = ctx;
		
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
		
		this.isDrawing = true;
		this.canvas.setPointerCapture(e.pointerId);
		
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
		
		// Draw a dot for single taps
		this.drawPoint(point);
	}

	private handlePointerMove(e: PointerEvent) {
		if (!this.isDrawing || !this.currentStroke) return;
		
		// Get coalesced events for smoother lines
		const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
		
		for (const event of events) {
			const point = this.getPointFromEvent(event);
			this.currentStroke.points.push(point);
			
			// Draw the segment
			this.drawSegment(point);
		}
	}

	private handlePointerUp(e: PointerEvent) {
		if (!this.isDrawing) return;
		
		this.isDrawing = false;
		
		if (this.currentStroke && this.currentStroke.points.length > 0) {
			// Save the stroke
			this.strokes.push(this.currentStroke);
		}
		
		this.currentStroke = null;
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
				this.ctx.globalAlpha = 1;
				break;
			case 'highlighter':
				// Use source-over with transparency for proper highlighting
				this.ctx.globalCompositeOperation = 'source-over';
				// Convert color to RGBA with 30% opacity for transparency
				this.ctx.strokeStyle = this.hexToRgba(this.currentColor, 0.3);
				this.ctx.globalAlpha = 1;
				break;
			case 'eraser':
				this.ctx.globalCompositeOperation = 'destination-out';
				this.ctx.strokeStyle = 'rgba(0,0,0,1)';
				this.ctx.globalAlpha = 1;
				break;
		}
	}

	private hexToRgba(hex: string, alpha: number): string {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	private drawPoint(point: Point) {
		const radius = this.getLineWidth(point.pressure) / 2;
		
		this.ctx.beginPath();
		this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
		this.ctx.fillStyle = this.currentTool === 'eraser' ? 'rgba(0,0,0,1)' : this.currentColor;
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
