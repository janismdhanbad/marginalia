import { Plugin, WorkspaceLeaf, addIcon } from 'obsidian';
import { PDFAnnotationView, VIEW_TYPE_PDF_ANNOTATION } from './PDFAnnotationView';
import './styles.css';

// Custom pencil icon for the ribbon
const PENCIL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;

export default class PDFAnnotatorPlugin extends Plugin {
	async onload() {
		console.log('Loading Marginalia');

		// Register custom icon
		addIcon('pdf-annotator', PENCIL_ICON);

		// Register the custom view
		this.registerView(
			VIEW_TYPE_PDF_ANNOTATION,
			(leaf) => new PDFAnnotationView(leaf, this)
		);

		// Add ribbon icon
		this.addRibbonIcon('pdf-annotator', 'Open Marginalia', () => {
			this.activateView();
		});

		// Add command to open the annotation view
		this.addCommand({
			id: 'open-marginalia',
			name: 'Open Marginalia',
			callback: () => {
				this.activateView();
			}
		});

		// Add command to load a PDF file
		this.addCommand({
			id: 'load-pdf',
			name: 'Load PDF in Marginalia',
			callback: async () => {
				await this.activateView();
				// The view will handle file selection
				const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PDF_ANNOTATION)[0];
				if (leaf && leaf.view instanceof PDFAnnotationView) {
					leaf.view.promptLoadPDF();
				}
			}
		});
	}

	onunload() {
		console.log('Unloading Marginalia');
		// Detach all leaves of our view type
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_PDF_ANNOTATION);
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_PDF_ANNOTATION);

		if (leaves.length > 0) {
			// View already exists, use it
			leaf = leaves[0];
		} else {
			// Create new leaf in the main area (full page, not sidebar)
			leaf = workspace.getLeaf('tab');
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_PDF_ANNOTATION,
					active: true,
				});
			}
		}

		// Reveal the leaf
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}
}
