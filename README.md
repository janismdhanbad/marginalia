# Marginalia - Obsidian Plugin

*Write in the margins.* A prototype Obsidian plugin for annotating PDFs with Apple Pencil support.

## Features

- **PDF Rendering**: View PDF files directly in Obsidian using PDF.js
- **Pressure-Sensitive Drawing**: Apple Pencil pressure is captured for natural-feeling strokes
- **Multiple Tools**:
  - ✏️ **Pen**: Variable-width strokes based on pressure
  - 🖍️ **Highlighter**: Semi-transparent highlighting with multiply blend mode
  - 🧹 **Eraser**: Remove annotations
- **Color Palette**: Quick access to common colors
- **Page Navigation**: Navigate through multi-page PDFs

## Development

### Prerequisites

- Node.js 18+ 
- npm or yarn
- An Obsidian vault for testing

### Setup

1. Clone this repository into your vault's `.obsidian/plugins/` directory:
   ```bash
   cd /path/to/your/vault/.obsidian/plugins/
   git clone <repo-url> pdf-annotator
   cd pdf-annotator
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   # Development mode (watches for changes)
   npm run dev
   
   # Production build
   npm run build
   ```

4. Enable the plugin in Obsidian:
   - Open Obsidian Settings → Community plugins
   - Enable "PDF Annotator"

### Project Structure

```
├── manifest.json          # Plugin metadata
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript config
├── esbuild.config.mjs     # Build configuration
├── src/
│   ├── main.ts            # Plugin entry point
│   ├── PDFAnnotationView.ts   # PDF view component
│   ├── DrawingCanvas.ts   # Drawing/annotation logic
│   └── styles.css         # UI styling
└── README.md
```

### Testing on iPad

1. Build the plugin on your development machine
2. Sync the plugin folder to your vault (via iCloud, Obsidian Sync, etc.)
3. Open Obsidian on iPad
4. Enable the plugin and test with Apple Pencil

## Usage

1. Click the pencil icon in the left ribbon, or use command palette: "Open PDF Annotation View"
2. Click "Load PDF" to select a PDF from your vault
3. Use the toolbar to select tools and colors
4. Draw on the PDF with your Apple Pencil (or mouse on desktop)

## Limitations

This is a **prototype** to test the viability of Apple Pencil annotation in Obsidian:

- **No double-tap eraser**: Apple Pencil double-tap gesture is not accessible from web APIs
- **Performance**: Web canvas is slower than native apps like Notability/GoodNotes
- **No annotation persistence**: Annotations are lost when you close the view (future feature)
- **Single page annotations**: Annotations don't persist across page navigation yet

## Technical Notes

### Apple Pencil Support

The plugin uses the **Pointer Events API** which provides:
- `pointerType`: Distinguishes between "pen", "touch", and "mouse"
- `pressure`: Value from 0.0 to 1.0
- `tiltX` / `tiltY`: Pencil angle
- `getCoalescedEvents()`: High-frequency point sampling for smoother lines

### Palm Rejection

Basic palm rejection is implemented by ignoring `touch` events when the drawing tool is active. iPadOS also provides system-level palm rejection.

## Future Enhancements

If the prototype proves viable:
- [ ] Persist annotations to JSON files alongside PDFs
- [ ] Multi-page annotation support
- [ ] Zoom and pan gestures
- [ ] Undo/redo functionality
- [ ] Export annotated PDF
- [ ] More drawing tools (shapes, text)

## License

MIT
