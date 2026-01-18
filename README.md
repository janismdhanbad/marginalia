# Marginalia

*Write in the margins.*

A PDF annotation plugin for [Obsidian](https://obsidian.md) with Apple Pencil support. Annotate research papers, highlight important passages, and take handwritten notes directly on your PDFs.

![Version](https://img.shields.io/badge/version-0.3.0-blue)
![Platform](https://img.shields.io/badge/platform-Desktop%20%7C%20iPad-lightgrey)

---

## Features

### ✅ Currently Implemented

| Feature | Description |
|---------|-------------|
| **PDF Viewing** | Load and view PDFs from your vault |
| **Continuous Scroll** | All pages stacked vertically, scroll naturally |
| **Full Page Mode** | Opens as main tab, not sidebar |
| **Pen Tool** | Pressure-sensitive drawing with Apple Pencil |
| **Highlighter** | Semi-transparent highlighting (30% opacity) |
| **Eraser** | Remove annotations |
| **Color Palette** | 6 preset colors (black, red, blue, green, yellow, purple) |
| **Save/Load Annotations** | Annotations persist in JSON files |
| **Auto-save** | Saves automatically when closing |
| **Per-page Annotations** | Each page has independent annotations |
| **Lazy Loading** | Pages render as you scroll (performance) |

---

## Roadmap

### 🔥 High Priority

| Feature | Status | Description |
|---------|--------|-------------|
| Undo/Redo | 📋 Planned | Essential for any drawing app |
| Pen Size Slider | 📋 Planned | Adjust stroke thickness |
| Text Highlighting | 📋 Planned | Select actual PDF text and highlight |
| Export to Markdown | 📋 Planned | Extract annotations as Obsidian notes |
| Export Annotated PDF | 📋 Planned | Save PDF with annotations baked in |

### ⭐ Medium Priority

| Feature | Status | Description |
|---------|--------|-------------|
| Shapes Tool | 📋 Planned | Draw rectangles, circles, arrows |
| Text Boxes | 📋 Planned | Add typed text annotations |
| Lasso Select | 📋 Planned | Select and move/delete annotations |
| Sticky Notes | 📋 Planned | Pop-up comments at locations |
| Thumbnail Sidebar | 📋 Planned | See all pages, jump to any page |
| Bookmarks | 📋 Planned | Mark important pages |
| Zoom/Pinch | 📋 Planned | Zoom in for detailed annotation |

### 🔗 Obsidian Integration

| Feature | Status | Description |
|---------|--------|-------------|
| Link to Notes | 📋 Planned | Create [[wikilinks]] from annotations |
| Extract Highlights | 📋 Planned | One-click export all highlights |
| Side-by-side View | 📋 Planned | PDF + markdown editor split |
| Search Annotations | 📋 Planned | Search across all annotated PDFs |
| Backlinks | 📋 Planned | See which notes reference PDF |

### 📤 Export Features

| Feature | Status | Description |
|---------|--------|-------------|
| Export Flattened PDF | 📋 Planned | PDF with annotations visible everywhere |
| Export as Image | 📋 Planned | Save page as PNG with annotations |
| Copy Selection | 📋 Planned | Copy annotated region to clipboard |

### 🎨 Quality of Life

| Feature | Status | Description |
|---------|--------|-------------|
| Dark/Sepia Mode | 📋 Planned | Invert or warm PDF colors |
| Keyboard Shortcuts | 📋 Planned | Quick tool switching |
| Recent PDFs | 📋 Planned | Quick access to recent documents |
| Custom Colors | 📋 Planned | Color picker for any color |

---

## Installation

### Via BRAT (Recommended)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins
2. Open Settings → BRAT → "Add Beta Plugin"
3. Enter: `janismdhanbad/marginalia`
4. Enable the plugin in Community Plugins

### Manual Installation

1. Download latest release from [Releases](../../releases)
2. Extract to `YourVault/.obsidian/plugins/marginalia/`
3. Enable in Settings → Community Plugins

---

## Usage

### Opening the Annotator

- Click the **✏️ pencil icon** in the left ribbon
- Or use Command Palette: `Marginalia: Open Marginalia`

### Loading a PDF

1. Click **📂 Load** in the toolbar
2. Select a PDF from your vault
3. Scroll through pages naturally

### Annotation Tools

| Tool | Description |
|------|-------------|
| ✏️ **Pen** | Pressure-sensitive drawing (Apple Pencil) |
| 🖍️ **Highlight** | Semi-transparent highlighting |
| 🧹 **Eraser** | Remove annotations |
| 🎨 **Colors** | Click color buttons to change |
| 💾 **Save** | Save annotations (also auto-saves) |
| 🗑️ **Clear** | Clear current page annotations |

### Saving Annotations

- Click **💾 Save** to save manually
- Annotations auto-save when you close the view
- Saved to: `YourPDF.pdf.annotations.json`

---

## Technical Details

### How Annotations Work

Annotations are stored in a JSON file alongside your PDF:

```
Papers/
├── research-paper.pdf
└── research-paper.pdf.annotations.json
```

This approach:
- ✅ Doesn't modify your original PDF
- ✅ Can be version controlled (Git)
- ✅ Easy to backup
- ✅ Syncs with Obsidian Sync/iCloud

### Apple Pencil Support

Uses the **Pointer Events API** for stylus detection:
- `pointerType: "pen"` for Apple Pencil
- `pressure` for line width variation
- `tiltX/tiltY` for angle detection
- Basic palm rejection (ignores touch when pen active)

### Performance

- **Lazy loading**: Pages render as you scroll
- **Offscreen canvas**: Highlighter uses optimized rendering
- **RAF throttling**: Smooth 60fps drawing

---

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/janismdhanbad/marginalia.git
cd marginalia
npm install
```

### Build

```bash
# Development (watch mode)
npm run dev

# Production build
npm run build
```

### Project Structure

```
marginalia/
├── src/
│   ├── main.ts              # Plugin entry point
│   ├── PDFAnnotationView.ts # Main view with PDF rendering
│   ├── DrawingCanvas.ts     # Drawing/annotation logic
│   └── styles.css           # UI styling
├── manifest.json            # Plugin metadata
├── package.json             # Dependencies
└── esbuild.config.mjs       # Build configuration
```

---

## Known Limitations

| Limitation | Reason |
|------------|--------|
| **No Apple Pencil double-tap** | Requires native iOS API, not available in web |
| **Slower than native apps** | Web canvas vs native Metal rendering |
| **No PDF text selection** | Requires additional PDF.js integration |
| **Separate annotation file** | Can't modify original PDF (yet) |

---

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Credits

- Built with [PDF.js](https://mozilla.github.io/pdf.js/) for PDF rendering
- Inspired by Notability, GoodNotes, and the Obsidian community
- Created for researchers, students, and anyone who loves annotating PDFs

---

*Made with ❤️ for the Obsidian community*
