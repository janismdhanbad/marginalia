import { Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { AnnotationLayer } from './AnnotationLayer';
import { AnnotationStorage } from './AnnotationStorage';

export default class PDFAnnotatorPlugin extends Plugin {
	private activeAnnotationLayers: Map<HTMLElement, AnnotationLayer> = new Map();
	private storage: AnnotationStorage;

	async onload() {
		console.log('Marginalia: Plugin loaded');

		this.storage = new AnnotationStorage(this.app);

		// Hook into PDF views when they're opened
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				console.log('Marginalia: Layout changed, checking for PDFs...');
				this.injectAnnotationLayers();
			})
		);

		// Also check when files are opened
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				console.log('Marginalia: File opened:', file?.path);
				if (file?.extension === 'pdf') {
					console.log('Marginalia: PDF detected, injecting in 200ms...');
					setTimeout(() => this.injectAnnotationLayers(), 200);
				}
			})
		);

		// Check for active PDF on load
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view?.getViewType() === 'pdf') {
					console.log('Marginalia: Active leaf is PDF, injecting...');
					setTimeout(() => this.injectAnnotationLayers(), 100);
				}
			})
		);

		// Initial injection
		this.app.workspace.onLayoutReady(() => {
			console.log('Marginalia: Layout ready, checking for PDFs...');
			setTimeout(() => this.injectAnnotationLayers(), 500);
		});

		console.log('Marginalia: All event handlers registered');
	}

	private injectAnnotationLayers() {
		console.log('Marginalia: Searching for PDF viewers...');

		// Get all PDF leaves
		const pdfLeaves = this.app.workspace.getLeavesOfType('pdf');
		console.log(`Marginalia: Found ${pdfLeaves.length} PDF leaf/leaves`);

		pdfLeaves.forEach((leaf, index) => {
			console.log(`Marginalia: Processing PDF leaf ${index + 1}...`);

			const view = leaf.view as any;
			const file = view.file as TFile;

			if (!file) {
				console.log('Marginalia: No file in this leaf, skipping');
				return;
			}

			console.log(`Marginalia: Leaf contains file: ${file.path}`);

			// Get the view container
			const viewElement = view.containerEl as HTMLElement;
			if (!viewElement) {
				console.log('Marginalia: No container element found');
				return;
			}

			// Skip if already injected
			if (this.activeAnnotationLayers.has(viewElement)) {
				console.log('Marginalia: Already injected, skipping');
				return;
			}

			console.log('Marginalia: Injecting annotation layer...');

			try {
				// Create and inject annotation layer
				const annotationLayer = new AnnotationLayer(
					viewElement,
					file,
					this.storage
				);

				this.activeAnnotationLayers.set(viewElement, annotationLayer);
				console.log(`Marginalia: ✓ Successfully injected for ${file.path}`);
			} catch (error) {
				console.error('Marginalia: Failed to inject annotation layer:', error);
			}
		});
	}

	private findLeafByContainer(container: HTMLElement): WorkspaceLeaf | null {
		const leaves = this.app.workspace.getLeavesOfType('pdf');

		for (const leaf of leaves) {
			const viewElement = (leaf.view as any).containerEl;
			if (viewElement && viewElement.contains(container)) {
				return leaf;
			}
		}

		return null;
	}

	private getFileFromLeaf(leaf: WorkspaceLeaf): TFile | null {
		const view = leaf.view as any;
		return view.file || null;
	}

	onunload() {
		console.log('Unloading Marginalia PDF Annotator');

		// Cleanup all annotation layers
		this.activeAnnotationLayers.forEach((layer) => {
			layer.destroy();
		});

		this.activeAnnotationLayers.clear();
	}
}
