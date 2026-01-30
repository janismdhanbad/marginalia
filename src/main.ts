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
		console.log('========================================');
		console.log('MARGINALIA DEBUG: Starting injection...');
		console.log('========================================');

		// Get all PDF leaves
		const pdfLeaves = this.app.workspace.getLeavesOfType('pdf');
		console.log(`PDF leaves found: ${pdfLeaves.length}`);

		if (pdfLeaves.length === 0) {
			console.warn('⚠️ NO PDF LEAVES FOUND! Is a PDF open?');
			return;
		}

		pdfLeaves.forEach((leaf, index) => {
			console.log(`\n--- Processing PDF leaf ${index + 1} ---`);

			const view = leaf.view as any;
			console.log('View object:', view);
			console.log('View type:', leaf.view.getViewType());

			const file = view.file as TFile;
			if (!file) {
				console.error('❌ No file in this leaf!');
				return;
			}
			console.log(`✓ File: ${file.path}`);

			// Get the view container
			const viewElement = view.containerEl as HTMLElement;
			if (!viewElement) {
				console.error('❌ No containerEl found!');
				return;
			}
			console.log('✓ Container element found');
			console.log('Container classes:', viewElement.className);
			console.log('Container HTML (first 200 chars):', viewElement.innerHTML.substring(0, 200));

			// Debug: Show all child elements
			console.log('Container children:');
			Array.from(viewElement.children).forEach((child, i) => {
				console.log(`  ${i}: ${child.tagName}.${child.className}`);
			});

			// Skip if already injected
			if (this.activeAnnotationLayers.has(viewElement)) {
				console.log('ℹ️ Already injected, skipping');
				return;
			}

			console.log('🚀 Attempting to inject annotation layer...');

			try {
				// Create and inject annotation layer
				const annotationLayer = new AnnotationLayer(
					viewElement,
					file,
					this.storage
				);

				this.activeAnnotationLayers.set(viewElement, annotationLayer);
				console.log(`✅ SUCCESS! Injected for ${file.path}`);
			} catch (error) {
				console.error('❌ INJECTION FAILED:', error);
				console.error('Error stack:', (error as Error).stack);
			}
		});

		console.log('\n========================================');
		console.log('MARGINALIA DEBUG: Injection complete');
		console.log(`Active layers: ${this.activeAnnotationLayers.size}`);
		console.log('========================================\n');
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
