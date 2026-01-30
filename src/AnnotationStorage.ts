import { App, TFile, Notice } from 'obsidian';

export interface Point {
	x: number;
	y: number;
	pressure: number;
	timestamp: number;
}

export interface Stroke {
	points: Point[];
	tool: string;
	color: string;
	width: number;
}

interface AnnotationData {
	version: string;
	pdfPath: string;
	strokes: Stroke[];
}

export class AnnotationStorage {
	private app: App;
	private readonly VERSION = 'v1.0.0';

	constructor(app: App) {
		this.app = app;
	}

	async saveAnnotations(pdfFile: TFile, strokes: Stroke[]): Promise<void> {
		const annotationPath = pdfFile.path + '.annotations.json';

		const data: AnnotationData = {
			version: this.VERSION,
			pdfPath: pdfFile.path,
			strokes: strokes
		};

		try {
			const jsonContent = JSON.stringify(data, null, 2);
			const existingFile = this.app.vault.getAbstractFileByPath(annotationPath);

			if (existingFile instanceof TFile) {
				await this.app.vault.modify(existingFile, jsonContent);
			} else {
				await this.app.vault.create(annotationPath, jsonContent);
			}

			new Notice(`Annotations saved: ${strokes.length} strokes`);
		} catch (error) {
			console.error('Marginalia: Error saving annotations:', error);
			new Notice('Error saving annotations');
		}
	}

	async loadAnnotations(pdfFile: TFile): Promise<Stroke[]> {
		const annotationPath = pdfFile.path + '.annotations.json';

		try {
			const existingFile = this.app.vault.getAbstractFileByPath(annotationPath);

			if (existingFile instanceof TFile) {
				const content = await this.app.vault.read(existingFile);
				const data: AnnotationData = JSON.parse(content);

				console.log(`Marginalia: Loaded ${data.strokes.length} strokes for ${pdfFile.path}`);
				return data.strokes || [];
			}
		} catch (error) {
			console.log('Marginalia: No saved annotations found');
		}

		return [];
	}
}
