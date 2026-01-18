import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";

const prod = process.argv[2] === "production";

// Copy PDF.js worker to output
const copyPdfWorker = {
	name: "copy-pdf-worker",
	setup(build) {
		build.onEnd(() => {
			const workerSrc = path.join("node_modules", "pdfjs-dist", "build", "pdf.worker.mjs");
			const workerDest = "pdf.worker.mjs";
			if (fs.existsSync(workerSrc)) {
				fs.copyFileSync(workerSrc, workerDest);
				console.log("Copied PDF.js worker");
			}
		});
	},
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	plugins: [copyPdfWorker],
	define: {
		"process.env.NODE_ENV": prod ? '"production"' : '"development"',
	},
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
