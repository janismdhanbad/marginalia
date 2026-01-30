import { Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { AnnotationLayer } from './AnnotationLayer';
import { AnnotationStorage } from './AnnotationStorage';

export default class PDFAnnotatorPlugin extends Plugin {
	private activeAnnotationLayers: Map<HTMLElement, AnnotationLayer> = new Map();
	private storage: AnnotationStorage;

	async onload() {
		console.log('Loading Marginalia PDF Annotator');

		this.storage = new AnnotationStorage(this.app);

		// Hook into PDF views when they're opened
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.injectAnnotationLayers();
			})
		);

		// Also check when files are opened
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file?.extension === 'pdf') {
					setTimeout(() => this.injectAnnotationLayers(), 100);
				}
			})
		);

		// Initial injection
		this.app.workspace.onLayoutReady(() => {
			setTimeout(() => this.injectAnnotationLayers(), 500);
		});
	}

	private injectAnnotationLayers() {
		// Find all PDF viewer elements in the workspace
		const pdfViewers = document.querySelectorAll('.pdf-viewer');

		pdfViewers.forEach((viewer) => {
			const pdfContainer = viewer as HTMLElement;

			// Skip if already injected
			if (this.activeAnnotationLayers.has(pdfContainer)) {
				return;
			}

			// Find the PDF canvas container
			const canvasContainer = pdfContainer.querySelector('.pdf-container');
			if (!canvasContainer) {
				return;
			}

			// Get the file path from the view
			const leaf = this.findLeafByContainer(pdfContainer);
			if (!leaf) {
				return;
			}

			const file = this.getFileFromLeaf(leaf);
			if (!file || file.extension !== 'pdf') {
				return;
			}

			console.log(`Marginalia: Injecting annotation layer for ${file.path}`);

			// Create and inject annotation layer
			const annotationLayer = new AnnotationLayer(
				pdfContainer,
				file,
				this.storage
			);

			this.activeAnnotationLayers.set(pdfContainer, annotationLayer);
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
