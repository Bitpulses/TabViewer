"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TabViewerViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// ── Provider ────────────────────────────────────────────────────────────
class TabViewerViewProvider {
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
        this._sortField = 'name';
        this._sortAscending = true;
        this._navigationHistory = [];
        this._historyIndex = -1;
        this._searchQuery = '';
        this._watcherInitialized = false;
        // Icon theme state
        this._iconTheme = null;
        this._extensionPath = _extensionUri.fsPath;
        this._rootPath = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
            ? vscode.workspace.workspaceFolders[0].uri.fsPath
            : undefined;
        this._currentPath = this._rootPath;
        if (this._rootPath) {
            this._navigationHistory = [this._rootPath];
            this._historyIndex = 0;
        }
    }
    // ── Icon Theme Loading ───────────────────────────────────────────
    /** Load the active VSCode file icon theme and extract icon data for the webview. */
    async _loadIconTheme() {
        const themeId = vscode.workspace
            .getConfiguration('workbench').get('iconTheme');
        if (!themeId) {
            this._iconTheme = this._fallbackIconTheme();
            return;
        }
        // Find the extension that provides this icon theme
        const ext = vscode.extensions.all.find(e => {
            const contributes = e.packageJSON?.contributes;
            if (!contributes?.iconThemes) {
                return false;
            }
            return contributes.iconThemes.some((t) => t.id === themeId);
        });
        if (!ext) {
            this._iconTheme = this._fallbackIconTheme();
            return;
        }
        try {
            // Read the icon theme definition file path from the extension's package.json
            const iconThemeContrib = ext.packageJSON.contributes.iconThemes.find((t) => t.id === themeId);
            if (!iconThemeContrib?.path) {
                this._iconTheme = this._fallbackIconTheme();
                return;
            }
            const themeJsonPath = path.join(ext.extensionPath, iconThemeContrib.path);
            const themeJson = JSON.parse(fs.readFileSync(themeJsonPath, 'utf-8'));
            // CRITICAL: icon paths in theme JSON are relative to the theme JSON file's directory
            const themeDir = path.dirname(themeJsonPath);
            // Determine if this is a font-based or SVG-based theme
            const hasFonts = themeJson.fonts && themeJson.fonts.length > 0;
            if (hasFonts) {
                this._iconTheme = this._buildFontThemeCSS(themeDir, themeJson);
            }
            else {
                this._iconTheme = this._buildSVGThemeCSS(themeDir, themeJson);
            }
        }
        catch (e) {
            console.error('[TabViewer] Failed to load icon theme:', e);
            this._iconTheme = this._fallbackIconTheme();
        }
    }
    /** Build CSS + mapping for font-based icon themes (e.g. Seti, Material Icon Theme). */
    _buildFontThemeCSS(themeDir, theme) {
        const fonts = theme.fonts;
        let fontFaceCSS = '';
        const fontFamilyByFontId = {};
        const defaultFontFamily = fonts.length > 0 ? `fiv-font-${fonts[0].id}` : '';
        // Generate @font-face rules for each font, embedding as base64 data URI
        for (const font of fonts) {
            const fontFamily = `fiv-font-${font.id}`;
            fontFamilyByFontId[font.id] = fontFamily;
            // Try each src format; resolve paths relative to themeDir
            for (const src of font.src) {
                const fontPath = path.join(themeDir, src.path);
                try {
                    const fontBuffer = fs.readFileSync(fontPath);
                    const b64 = fontBuffer.toString('base64');
                    const mime = src.format === 'woff2' ? 'font/woff2'
                        : src.format === 'woff' ? 'font/woff'
                            : src.format === 'ttf' ? 'font/truetype'
                                : src.format === 'otf' ? 'font/opentype'
                                    : 'font/truetype';
                    fontFaceCSS += `@font-face{font-family:'${fontFamily}';src:url(data:${mime};base64,${b64}) format('${src.format}');font-weight:${font.weight || 'normal'};font-style:${font.style || 'normal'};font-display:block;}`;
                    break;
                }
                catch { /* try next format */ }
            }
        }
        // Generate CSS rules for each icon definition
        let iconClassCSS = '';
        const processedDefs = new Set();
        const genDefCSS = (defId, def) => {
            if (processedDefs.has(defId)) {
                return;
            }
            if (!def || !def.fontCharacter) {
                return;
            }
            // Default fontId to first font if not specified
            const fontFamily = def.fontId
                ? (fontFamilyByFontId[def.fontId] || defaultFontFamily)
                : defaultFontFamily;
            if (!fontFamily) {
                return;
            }
            processedDefs.add(defId);
            let css = `.${TabViewerViewProvider.CLS}${defId}::before{content:'${def.fontCharacter}';font-family:'${fontFamily}';`;
            if (def.fontColor) {
                css += `color:${def.fontColor};`;
            }
            css += '}';
            iconClassCSS += css;
        };
        // Process all definitions from iconDefinitions
        for (const [defId, def] of Object.entries(theme.iconDefinitions)) {
            genDefCSS(defId, def);
        }
        // Process light theme iconDefinitions
        if (theme.light?.iconDefinitions) {
            for (const [defId, def] of Object.entries(theme.light.iconDefinitions)) {
                genDefCSS(defId, def);
            }
        }
        // Build extension/file name maps
        const extMap = {};
        const nameMap = {};
        const buildMaps = (t) => {
            if (!t) {
                return;
            }
            if (t.fileExtensions) {
                for (const [ext, defId] of Object.entries(t.fileExtensions)) {
                    if (!extMap[`.${ext.toLowerCase()}`]) {
                        extMap[`.${ext.toLowerCase()}`] = defId;
                    }
                }
            }
            if (t.fileNames) {
                for (const [name, defId] of Object.entries(t.fileNames)) {
                    if (!nameMap[name.toLowerCase()]) {
                        nameMap[name.toLowerCase()] = defId;
                    }
                }
            }
        };
        buildMaps(theme);
        buildMaps(theme.light);
        const defaultFileClass = theme.file || 'file';
        const defaultFolderClass = theme.folder || 'folder';
        const defaultFolderOpenClass = theme.folderExpanded || theme.folder || 'folder';
        const defaultRootFolderClass = theme.rootFolder || theme.folder || 'folder';
        const css = `<style>${fontFaceCSS}${iconClassCSS}.${TabViewerViewProvider.CLS}icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex-shrink:0;font-size:16px;line-height:1;}.${TabViewerViewProvider.CLS}icon::before{speak:none;display:inline-block;line-height:1;}</style>`;
        return {
            css,
            extMap,
            nameMap,
            defaultFileClass,
            defaultFolderClass,
            defaultFolderOpenClass,
            defaultRootFolderClass,
            searchIconHTML: this._searchIconHTML(),
        };
    }
    /** Build CSS for SVG-based icon themes. */
    _buildSVGThemeCSS(themeDir, theme) {
        const defCSSMap = {};
        const processedDefs = new Set();
        const genDefCSS = (defId, def) => {
            if (processedDefs.has(defId)) {
                return;
            }
            if (!def || !def.iconPath) {
                return;
            }
            // Resolve SVG paths relative to themeDir
            const svgPath = path.join(themeDir, def.iconPath);
            try {
                const svgContent = fs.readFileSync(svgPath, 'utf-8');
                const b64 = Buffer.from(svgContent).toString('base64');
                processedDefs.add(defId);
                defCSSMap[defId] = `.${TabViewerViewProvider.CLS}${defId}{background-image:url(data:image/svg+xml;base64,${b64});background-size:contain;background-repeat:no-repeat;background-position:center;}`;
            }
            catch { /* skip */ }
        };
        for (const [defId, def] of Object.entries(theme.iconDefinitions)) {
            genDefCSS(defId, def);
        }
        if (theme.light?.iconDefinitions) {
            for (const [defId, def] of Object.entries(theme.light.iconDefinitions)) {
                genDefCSS(defId, def);
            }
        }
        let cssRules = Object.values(defCSSMap).join('');
        const extMap = {};
        const nameMap = {};
        const buildMaps = (t) => {
            if (!t) {
                return;
            }
            if (t.fileExtensions) {
                for (const [ext, defId] of Object.entries(t.fileExtensions)) {
                    if (!extMap[`.${ext.toLowerCase()}`]) {
                        extMap[`.${ext.toLowerCase()}`] = defId;
                    }
                }
            }
            if (t.fileNames) {
                for (const [name, defId] of Object.entries(t.fileNames)) {
                    if (!nameMap[name.toLowerCase()]) {
                        nameMap[name.toLowerCase()] = defId;
                    }
                }
            }
        };
        buildMaps(theme);
        buildMaps(theme.light);
        const css = `<style>${cssRules}.${TabViewerViewProvider.CLS}icon{display:inline-block;width:16px;height:16px;flex-shrink:0;background-size:contain;background-repeat:no-repeat;background-position:center;}</style>`;
        return {
            css,
            extMap,
            nameMap,
            defaultFileClass: theme.file || 'file',
            defaultFolderClass: theme.folder || 'folder',
            defaultFolderOpenClass: theme.folderExpanded || theme.folder || 'folder',
            defaultRootFolderClass: theme.rootFolder || theme.folder || 'folder',
            searchIconHTML: this._searchIconHTML(),
        };
    }
    /** Fallback when no icon theme is active — uses simple unicode chars. */
    _fallbackIconTheme() {
        return {
            css: `<style>.${TabViewerViewProvider.CLS}icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex-shrink:0;font-size:14px;}</style>`,
            extMap: {},
            nameMap: {},
            defaultFileClass: '',
            defaultFolderClass: '',
            defaultFolderOpenClass: '',
            defaultRootFolderClass: '',
            searchIconHTML: this._searchIconHTML(),
        };
    }
    /** Determine the CSS class (from the active icon theme) for a file entry. */
    _getFileIconClass(fileName, isDirectory) {
        const theme = this._iconTheme;
        if (!theme) {
            return '';
        }
        if (isDirectory) {
            return theme.defaultFolderClass;
        }
        // Check exact file name match first
        if (theme.nameMap[fileName.toLowerCase()]) {
            return theme.nameMap[fileName.toLowerCase()];
        }
        // Then check file extension
        const ext = path.extname(fileName).toLowerCase();
        if (ext && theme.extMap[ext]) {
            return theme.extMap[ext];
        }
        return theme.defaultFileClass;
    }
    /** Render a single icon element with the theme's CSS class. */
    _renderIcon(fileName, isDirectory) {
        const cls = this._getFileIconClass(fileName, isDirectory);
        if (cls) {
            return `<i class="${TabViewerViewProvider.CLS}icon ${TabViewerViewProvider.CLS}${cls}"></i>`;
        }
        // Fallback: simple unicode indicator
        const ch = isDirectory ? '&#x1F4C1;' : '&#x1F4C4;';
        return `<i class="${TabViewerViewProvider.CLS}icon">${ch}</i>`;
    }
    _searchIconHTML() {
        return `<span style="font-size:11px;line-height:1;">&#x1F50D;</span>`;
    }
    // ── Dispose ───────────────────────────────────────────────────────
    dispose() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        if (this._fileWatcher) {
            this._fileWatcher.dispose();
        }
        if (this._iconThemeListener) {
            this._iconThemeListener.dispose();
        }
        if (this._activeEditorListener) {
            this._activeEditorListener.dispose();
        }
    }
    // ── File Watcher ───────────────────────────────────────────────────
    _setupFileWatcherLazily() {
        if (this._watcherInitialized || !this._rootPath) {
            return;
        }
        this._watcherInitialized = true;
        this._fileWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this._rootPath, '**/*'));
        const debouncedUpdate = () => {
            if (this._debounceTimer) {
                clearTimeout(this._debounceTimer);
            }
            this._debounceTimer = setTimeout(() => {
                this._debounceTimer = undefined;
                if (this._view?.visible) {
                    this._updateFileList();
                }
            }, 300);
        };
        this._fileWatcher.onDidCreate(() => debouncedUpdate());
        this._fileWatcher.onDidChange(() => debouncedUpdate());
        this._fileWatcher.onDidDelete(() => debouncedUpdate());
    }
    // ── resolveWebviewView ─────────────────────────────────────────────
    async resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        // Load the active icon theme
        await this._loadIconTheme();
        // Initialize active file BEFORE the initial render so highlighting is included
        this._activeFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
        // Initial render
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        // Set up file watcher lazily
        this._setupFileWatcherLazily();
        // Listen for icon theme changes
        this._iconThemeListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('workbench.iconTheme')) {
                await this._loadIconTheme();
                this._updateFileList();
            }
        });
        // Listen for active editor changes to track the currently opened file
        this._activeEditorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
            const newPath = editor?.document.uri.fsPath;
            if (!this._isSamePath(newPath, this._activeFilePath)) {
                this._activeFilePath = newPath;
                this._updateFileList();
            }
        });
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'previewFile':
                    if (message.path) {
                        const uri = vscode.Uri.file(message.path);
                        vscode.commands.executeCommand('vscode.open', uri, { preview: true });
                        // Immediately update active highlighting (editor may not change if file is already open)
                        this._activeFilePath = message.path;
                        this._updateFileList();
                    }
                    break;
                case 'openFile':
                    if (message.path) {
                        const uri = vscode.Uri.file(message.path);
                        vscode.commands.executeCommand('vscode.open', uri, { preview: false });
                        // Immediately update active highlighting (editor may not change if file is already open)
                        this._activeFilePath = message.path;
                        this._updateFileList();
                    }
                    break;
                case 'navigateTo':
                    if (message.path && this._rootPath && message.path.startsWith(this._rootPath)) {
                        this._currentPath = message.path;
                        this._addToHistory(message.path);
                        this._updateFileList();
                    }
                    break;
                case 'sort':
                    if (message.field) {
                        this._handleSort(message.field);
                    }
                    break;
                case 'navigateBreadcrumb':
                    if (message.path !== undefined) {
                        let targetPath;
                        if (message.path === '') {
                            targetPath = this._rootPath;
                        }
                        else if (this._rootPath) {
                            targetPath = path.join(this._rootPath, message.path);
                        }
                        if (targetPath) {
                            this._currentPath = targetPath;
                            this._addToHistory(targetPath);
                            this._updateFileList();
                        }
                    }
                    break;
                case 'search':
                    if (message.query !== undefined) {
                        const newQuery = message.query.trim();
                        if (newQuery && !this._searchQuery) {
                            this._pathBeforeSearch = this._currentPath;
                        }
                        else if (!newQuery && this._searchQuery && this._pathBeforeSearch) {
                            this._currentPath = this._pathBeforeSearch;
                            this._pathBeforeSearch = undefined;
                        }
                        this._searchQuery = newQuery;
                        this._updateFileList();
                    }
                    break;
            }
        });
    }
    // ── Public Navigation ──────────────────────────────────────────────
    refresh() {
        this._updateFileList();
    }
    navigateUp() {
        if (this._historyIndex > 0) {
            this._historyIndex--;
            this._currentPath = this._navigationHistory[this._historyIndex];
            this._updateFileList();
        }
    }
    navigateDown() {
        if (this._historyIndex < this._navigationHistory.length - 1) {
            this._historyIndex++;
            this._currentPath = this._navigationHistory[this._historyIndex];
            this._updateFileList();
        }
    }
    // ── Private Helpers ────────────────────────────────────────────────
    _addToHistory(p) {
        if (this._historyIndex < this._navigationHistory.length - 1) {
            this._navigationHistory = this._navigationHistory.slice(0, this._historyIndex + 1);
        }
        this._navigationHistory.push(p);
        this._historyIndex = this._navigationHistory.length - 1;
    }
    _handleSort(field) {
        if (this._sortField === field) {
            this._sortAscending = !this._sortAscending;
        }
        else {
            this._sortField = field;
            this._sortAscending = true;
        }
        this._updateFileList();
    }
    _updateFileList() {
        if (this._view) {
            const entries = this._getFiles();
            const breadcrumb = this._getBreadcrumbContent();
            const themeCSS = this._iconTheme?.css || '';
            this._view.webview.postMessage({
                command: 'updateFileList',
                entries,
                breadcrumb,
                searchQuery: this._searchQuery,
                sortField: this._sortField,
                sortAscending: this._sortAscending,
                themeCSS,
            });
        }
    }
    // ── HTML Generation ────────────────────────────────────────────────
    _getHtmlForWebview(_webview) {
        const entries = this._getFiles();
        const themeCSS = this._iconTheme?.css || '';
        const searchIcon = this._iconTheme?.searchIconHTML || '&#x1F50D;';
        const initialSortField = this._sortField;
        const initialSortAsc = this._sortAscending;
        const sortIndicator = (field) => {
            if (initialSortField !== field) {
                return '';
            }
            return initialSortAsc ? ' ▲' : ' ▼';
        };
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${themeCSS}
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            margin: 0; padding: 0;
        }
        .header-container {
            padding: 6px 8px;
            background-color: var(--vscode-sideBarSectionHeader-background);
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
            display: flex; align-items: center; justify-content: space-between;
            gap: 8px;
        }
        .breadcrumb {
            font-size: 13px; display: flex; align-items: center; flex-wrap: wrap;
            gap: 4px; cursor: default; flex: 1; min-width: 0;
        }
        .breadcrumb-item {
            cursor: pointer; color: var(--vscode-breadcrumb-foreground);
            padding: 2px 6px; border-radius: 3px;
            display: flex; align-items: center; gap: 4px;
        }
        .breadcrumb-item:hover {
            background-color: var(--vscode-list-hoverBackground);
            color: var(--vscode-breadcrumb-focusForeground);
        }
        .breadcrumb-item.current { cursor: default; color: var(--vscode-foreground); }
        .breadcrumb-item.current:hover { background-color: transparent; }
        .breadcrumb-separator {
            color: var(--vscode-breadcrumb-foreground); user-select: none; margin: 0 2px;
        }
        .search-container { position: relative; flex-shrink: 0; }
        .search-input {
            width: 120px; padding: 2px 6px; padding-left: 20px; font-size: 11px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 2px; outline: none;
        }
        .search-input:focus { border-color: var(--vscode-focusBorder); width: 150px; }
        .search-input::placeholder { color: var(--vscode-input-placeholderForeground); }
        .search-icon {
            position: absolute; left: 5px; top: 50%; transform: translateY(-50%);
            color: var(--vscode-input-placeholderForeground);
            font-size: 11px; pointer-events: none;
        }
        .table-container { overflow-x: auto; overflow-y: auto; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th {
            position: sticky; top: 0;
            background-color: var(--vscode-sideBarSectionHeader-background);
            color: var(--vscode-foreground); text-align: left;
            padding: 4px 8px; cursor: pointer; user-select: none;
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
            font-weight: 600; white-space: nowrap; font-size: 12px;
        }
        th:hover { background-color: var(--vscode-list-hoverBackground); }
        th.name { width: 55%; }
        th.modified { width: 25%; }
        th.size { width: 20%; text-align: right; }
        td {
            padding: 3px 8px;
            border-bottom: 1px solid var(--vscode-sideBar-border, transparent);
            font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        td.size { text-align: right; font-family: var(--vscode-editor-font-family, monospace); }
        td.modified { font-family: var(--vscode-editor-font-family, monospace); }
        .file-icon-cell { display: flex; align-items: center; gap: 4px; }
        .file-icon-cell .file-name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        tr:hover { background-color: var(--vscode-list-hoverBackground); }
        tr.file-row { cursor: pointer; }
        tr.file-row:active { background-color: var(--vscode-list-activeSelectionBackground); }
        tr.file-row.active {
            background-color: var(--vscode-list-inactiveSelectionBackground);
            box-shadow: inset 2px 0 0 var(--vscode-list-activeSelectionBackground);
        }
        tr.file-row.active:hover { background-color: var(--vscode-list-inactiveSelectionBackground); }
        .no-workspace {
            padding: 10px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px;
        }
        .search-result-info {
            padding: 4px 8px; font-size: 11px; color: var(--vscode-descriptionForeground);
            background-color: var(--vscode-inputValidation-infoBackground, rgba(0, 122, 204, 0.1));
            border-bottom: 1px solid var(--vscode-inputValidation-infoBorder, rgba(0, 122, 204, 0.3));
        }
    </style>
</head>
<body oncontextmenu="return false;">
    <div class="header-container">
        <div class="breadcrumb" id="breadcrumbContent">${this._getBreadcrumbContent()}</div>
        <div class="search-container">
            <span class="search-icon">${searchIcon}</span>
            <input type="text" class="search-input" id="searchInput" placeholder="Search..." value="${this._escapeHtml(this._searchQuery)}">
        </div>
    </div>
    <div class="search-result-info" id="searchInfo" style="display:${this._searchQuery ? 'block' : 'none'};">${this._searchQuery ? 'Searching: ' + this._escapeHtml(this._searchQuery) : ''}</div>
    <div class="table-container">
        <table>
            <thead>
                <tr>
                    <th class="name" onclick="sort('name')">Name${sortIndicator('name')}</th>
                    <th class="modified" onclick="sort('modified')">Modified${sortIndicator('modified')}</th>
                    <th class="size" onclick="sort('size')">Size${sortIndicator('size')}</th>
                </tr>
            </thead>
            <tbody id="fileListBody">${entries}</tbody>
        </table>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const searchInput = document.getElementById('searchInput');
        let lastSearchValue = '${this._escapeHtml(this._searchQuery)}';
        let clickTimeout = null;
        let currentSortField = '${initialSortField}';
        let currentSortAscending = ${initialSortAsc};

        function previewFile(path) { vscode.postMessage({ command: 'previewFile', path }); }
        function openFile(path) { vscode.postMessage({ command: 'openFile', path }); }
        function navigateTo(path) { vscode.postMessage({ command: 'navigateTo', path }); }

        function handleFileClick(path, event) {
            if (event.detail === 1) {
                if (clickTimeout) clearTimeout(clickTimeout);
                clickTimeout = setTimeout(() => { previewFile(path); }, 200);
            } else if (event.detail === 2) {
                if (clickTimeout) { clearTimeout(clickTimeout); clickTimeout = null; }
                openFile(path);
            }
        }

        function handleFolderClick(path, event) {
            if (event.detail === 2) { navigateTo(path); }
        }

        function sort(field) { vscode.postMessage({ command: 'sort', field }); }
        function navigateBreadcrumb(relativePath) { vscode.postMessage({ command: 'navigateBreadcrumb', path: relativePath }); }

        function updateSortIndicators(sortField, sortAscending) {
            currentSortField = sortField;
            currentSortAscending = sortAscending;
            document.querySelectorAll('th').forEach(th => {
                const cls = th.className.trim().split(' ')[0];
                let text = th.textContent.replace(/ [▲▼]$/, '');
                if (cls === sortField) { text += sortAscending ? ' ▲' : ' ▼'; }
                th.textContent = text;
            });
        }

        function injectThemeCSS(css) {
            const existing = document.getElementById('theme-style');
            if (existing) existing.remove();
            if (!css) return;
            const div = document.createElement('div');
            div.id = 'theme-style-container';
            div.innerHTML = css;
            while (div.firstChild) {
                document.head.appendChild(div.firstChild);
            }
        }

        let searchTimeout = null;
        searchInput.addEventListener('input', function(e) {
            const value = e.target.value;
            if (searchTimeout) clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                if (value !== lastSearchValue) {
                    lastSearchValue = value;
                    vscode.postMessage({ command: 'search', query: value });
                }
            }, 300);
        });

        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'updateFileList') {
                if (msg.themeCSS) injectThemeCSS(msg.themeCSS);
                document.getElementById('fileListBody').innerHTML = msg.entries;
                document.getElementById('breadcrumbContent').innerHTML = msg.breadcrumb;
                updateSortIndicators(msg.sortField, msg.sortAscending);
                const si = document.getElementById('searchInfo');
                if (msg.searchQuery) {
                    si.textContent = 'Searching: ' + msg.searchQuery;
                    si.style.display = 'block';
                } else {
                    si.style.display = 'none';
                }
            }
        });
    </script>
</body>
</html>`;
    }
    _getBreadcrumbContent() {
        if (!this._rootPath || !this._currentPath) {
            return '<span class="breadcrumb-item">No workspace</span>';
        }
        const rootName = path.basename(this._rootPath);
        const relativePath = path.relative(this._rootPath, this._currentPath);
        const parts = relativePath ? relativePath.split(path.sep) : [];
        let html = '';
        const isAtRoot = parts.length === 0;
        const rootIcon = this._renderIcon(rootName, true);
        html += `<span class="breadcrumb-item${isAtRoot ? ' current' : ''}" onclick="navigateBreadcrumb('')">${rootIcon}${this._escapeHtml(rootName)}</span>`;
        let accumulatedPath = '';
        for (let i = 0; i < parts.length; i++) {
            accumulatedPath = accumulatedPath ? path.join(accumulatedPath, parts[i]) : parts[i];
            html += '<span class="breadcrumb-separator">›</span>';
            const isLast = i === parts.length - 1;
            const folderIcon = this._renderIcon(parts[i], true);
            if (isLast) {
                html += `<span class="breadcrumb-item current">${folderIcon}${this._escapeHtml(parts[i])}</span>`;
            }
            else {
                html += `<span class="breadcrumb-item" onclick="navigateBreadcrumb('${this._escapeHtml(accumulatedPath)}')">${folderIcon}${this._escapeHtml(parts[i])}</span>`;
            }
        }
        return html;
    }
    _getFiles() {
        if (!this._currentPath) {
            return '<tr><td colspan="3" class="no-workspace">No folder opened</td></tr>';
        }
        let files = [];
        try {
            if (this._searchQuery) {
                files = this._searchFiles(this._currentPath, this._searchQuery.toLowerCase());
            }
            else {
                const entries = fs.readdirSync(this._currentPath, { withFileTypes: true });
                files = entries
                    .map(entry => {
                    const fullPath = path.join(this._currentPath, entry.name);
                    // Directories need no stat call — we already have isDirectory from the readdir
                    if (entry.isDirectory()) {
                        return {
                            name: entry.name,
                            path: fullPath,
                            isDirectory: true,
                            modified: '',
                            modifiedTime: 0,
                            size: '',
                            sizeBytes: 0,
                        };
                    }
                    try {
                        const stat = fs.statSync(fullPath);
                        return {
                            name: entry.name,
                            path: fullPath,
                            isDirectory: false,
                            modified: this._formatDate(stat.mtime),
                            modifiedTime: stat.mtime.getTime(),
                            size: this._formatSize(stat.size),
                            sizeBytes: stat.size,
                        };
                    }
                    catch {
                        return null;
                    }
                })
                    .filter(Boolean);
            }
        }
        catch {
            return '<tr><td colspan="3" class="no-workspace">Error reading directory</td></tr>';
        }
        files = this._sortFiles(files);
        if (this._searchQuery && files.length === 0) {
            return `<tr><td colspan="3" class="no-workspace">No files found matching "${this._escapeHtml(this._searchQuery)}"</td></tr>`;
        }
        return files
            .map(file => {
            const iconHTML = this._renderIcon(file.name, file.isDirectory);
            const escapedPath = this._escapeHtml(file.path);
            const isActive = !file.isDirectory && this._isSamePath(file.path, this._activeFilePath);
            const clickHandler = file.isDirectory
                ? `onclick="handleFolderClick('${escapedPath}', event)" ondblclick="handleFolderClick('${escapedPath}', event)"`
                : `onclick="handleFileClick('${escapedPath}', event)" ondblclick="handleFileClick('${escapedPath}', event)"`;
            return `<tr class="file-row${isActive ? ' active' : ''}" ${clickHandler}>
                    <td><div class="file-icon-cell">${iconHTML}<span class="file-name-text">${this._escapeHtml(file.name)}</span></div></td>
                    <td class="modified">${file.modified}</td>
                    <td class="size">${file.size}</td>
                </tr>`;
        })
            .join('');
    }
    _searchFiles(dirPath, query) {
        const results = [];
        const maxResults = 100;
        const searchDir = (currentDir) => {
            if (results.length >= maxResults) {
                return;
            }
            try {
                const entries = fs.readdirSync(currentDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (results.length >= maxResults) {
                        break;
                    }
                    const fullPath = path.join(currentDir, entry.name);
                    if (entry.name.toLowerCase().includes(query)) {
                        try {
                            const stat = fs.statSync(fullPath);
                            results.push({
                                name: entry.name,
                                path: fullPath,
                                isDirectory: entry.isDirectory(),
                                modified: this._formatDate(stat.mtime),
                                modifiedTime: stat.mtime.getTime(),
                                size: entry.isDirectory() ? '' : this._formatSize(stat.size),
                                sizeBytes: entry.isDirectory() ? 0 : stat.size,
                            });
                        }
                        catch { /* skip inaccessible files */ }
                    }
                    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                        searchDir(fullPath);
                    }
                }
            }
            catch { /* skip inaccessible dirs */ }
        };
        searchDir(dirPath);
        return results;
    }
    _sortFiles(files) {
        const sorted = [...files];
        sorted.sort((a, b) => {
            // Directories always first
            if (a.isDirectory && !b.isDirectory) {
                return -1;
            }
            if (!a.isDirectory && b.isDirectory) {
                return 1;
            }
            let comparison = 0;
            switch (this._sortField) {
                case 'name':
                    comparison = a.name.localeCompare(b.name);
                    break;
                case 'modified':
                    comparison = a.modifiedTime - b.modifiedTime;
                    break;
                case 'size':
                    comparison = a.sizeBytes - b.sizeBytes;
                    break;
            }
            return this._sortAscending ? comparison : -comparison;
        });
        return sorted;
    }
    /**
     * Compact relative date format.
     * Today → "14:30" | Yesterday → "Y-day 14:30" | This year → "06/05 14:30" | Older → "25/12/01"
     */
    _formatDate(date) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today.getTime() - 86400000);
        const fileDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        if (fileDay.getTime() >= today.getTime()) {
            return time;
        }
        if (fileDay.getTime() >= yesterday.getTime()) {
            return `Y-day ${time}`;
        }
        if (date.getFullYear() === now.getFullYear()) {
            return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${time}`;
        }
        return `${String(date.getFullYear()).slice(2)}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    }
    _formatSize(bytes) {
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        if (bytes < 1024 * 1024 * 1024) {
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        }
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    _escapeHtml(text) {
        return text
            .replace(/\\/g, '\\\\')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    /** Compare two file paths in a platform-aware way (case-insensitive on Windows). */
    _isSamePath(a, b) {
        if (!a || !b) {
            return false;
        }
        return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
    }
}
exports.TabViewerViewProvider = TabViewerViewProvider;
TabViewerViewProvider.viewType = 'tabViewer';
// ── CSS class prefix for file-icon-theme icons ──
TabViewerViewProvider.CLS = 'fiv-';
//# sourceMappingURL=tabViewerViewProvider.js.map