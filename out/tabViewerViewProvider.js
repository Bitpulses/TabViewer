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
class TabViewerViewProvider {
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
        this._sortField = 'name';
        this._sortAscending = true;
        this._navigationHistory = [];
        this._historyIndex = -1;
        this._searchQuery = '';
        this._rootPath = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
            ? vscode.workspace.workspaceFolders[0].uri.fsPath
            : undefined;
        this._currentPath = this._rootPath;
        if (this._rootPath) {
            this._navigationHistory = [this._rootPath];
            this._historyIndex = 0;
        }
        this._setupFileWatcher();
    }
    _setupFileWatcher() {
        if (this._rootPath) {
            this._fileWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this._rootPath, '**/*'));
            this._fileWatcher.onDidCreate(() => this._update());
            this._fileWatcher.onDidChange(() => this._update());
            this._fileWatcher.onDidDelete(() => this._update());
        }
    }
    dispose() {
        if (this._fileWatcher) {
            this._fileWatcher.dispose();
        }
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'openFile':
                    if (message.path) {
                        const uri = vscode.Uri.file(message.path);
                        vscode.commands.executeCommand('vscode.open', uri);
                    }
                    break;
                case 'navigateTo':
                    if (message.path && this._rootPath && message.path.startsWith(this._rootPath)) {
                        this._currentPath = message.path;
                        this._addToHistory(message.path);
                        this._update();
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
                            this._update();
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
    refresh() {
        this._update();
    }
    navigateUp() {
        if (this._historyIndex > 0) {
            this._historyIndex--;
            this._currentPath = this._navigationHistory[this._historyIndex];
            this._update();
        }
    }
    navigateDown() {
        if (this._historyIndex < this._navigationHistory.length - 1) {
            this._historyIndex++;
            this._currentPath = this._navigationHistory[this._historyIndex];
            this._update();
        }
    }
    _addToHistory(path) {
        if (this._historyIndex < this._navigationHistory.length - 1) {
            this._navigationHistory = this._navigationHistory.slice(0, this._historyIndex + 1);
        }
        this._navigationHistory.push(path);
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
        this._update();
    }
    _update() {
        if (this._view) {
            this._view.webview.html = this._getHtmlForWebview(this._view.webview);
        }
    }
    _updateFileList() {
        if (this._view) {
            const entries = this._getFiles();
            const breadcrumbContent = this._getBreadcrumbContent();
            this._view.webview.postMessage({
                command: 'updateFileList',
                entries: entries,
                breadcrumb: breadcrumbContent,
                searchQuery: this._searchQuery
            });
        }
    }
    _getHtmlForWebview(webview) {
        const entries = this._getFiles();
        const sortIndicator = (field) => {
            if (this._sortField !== field) {
                return '';
            }
            return this._sortAscending ? ' ▲' : ' ▼';
        };
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * {
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            margin: 0;
            padding: 0;
        }
        
        .header-container {
            padding: 6px 8px;
            background-color: var(--vscode-sideBarSectionHeader-background);
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        
        .breadcrumb {
            font-size: 13px;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 4px;
            cursor: default;
            flex: 1;
            min-width: 0;
        }
        
        .breadcrumb-item {
            cursor: pointer;
            color: var(--vscode-breadcrumb-foreground);
            padding: 2px 6px;
            border-radius: 3px;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .breadcrumb-item:hover {
            background-color: var(--vscode-list-hoverBackground);
            color: var(--vscode-breadcrumb-focusForeground);
        }
        
        .breadcrumb-item.current {
            cursor: default;
            color: var(--vscode-foreground);
        }
        
        .breadcrumb-item.current:hover {
            background-color: transparent;
        }
        
        .breadcrumb-icon {
            font-size: 16px;
        }
        
        .breadcrumb-separator {
            color: var(--vscode-breadcrumb-foreground);
            user-select: none;
            margin: 0 2px;
        }
        
        .search-container {
            position: relative;
            flex-shrink: 0;
        }
        
        .search-input {
            width: 120px;
            padding: 2px 6px;
            padding-left: 20px;
            font-size: 11px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 2px;
            outline: none;
        }
        
        .search-input:focus {
            border-color: var(--vscode-focusBorder);
            width: 150px;
        }
        
        .search-input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        
        .search-icon {
            position: absolute;
            left: 5px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--vscode-input-placeholderForeground);
            font-size: 10px;
        }
        
        .table-container {
            overflow-x: auto;
            overflow-y: auto;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
        }
        
        th {
            position: sticky;
            top: 0;
            background-color: var(--vscode-sideBarSectionHeader-background);
            color: var(--vscode-foreground);
            text-align: left;
            padding: 4px 8px;
            cursor: pointer;
            user-select: none;
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
            font-weight: 600;
            white-space: nowrap;
            font-size: 12px;
        }
        
        th:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        th.name { width: 45%; }
        th.modified { width: 35%; }
        th.size { width: 20%; text-align: right; }
        
        td {
            padding: 3px 8px;
            border-bottom: 1px solid var(--vscode-sideBar-border, transparent);
            font-size: 12px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        td.size {
            text-align: right;
            font-family: var(--vscode-editor-font-family, monospace);
        }
        
        td.modified {
            font-family: var(--vscode-editor-font-family, monospace);
        }
        
        tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        tr.file-row {
            cursor: pointer;
        }
        
        tr.file-row:active {
            background-color: var(--vscode-list-activeSelectionBackground);
        }
        
        .folder-icon::before {
            content: '📁 ';
            font-size: 14px;
        }
        
        .file-icon::before {
            content: '📄 ';
            font-size: 14px;
        }
        
        .no-workspace {
            padding: 10px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        
        .search-result-info {
            padding: 4px 8px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            background-color: var(--vscode-editorInfo-foreground);
            background-color: var(--vscode-inputValidation-infoBackground, rgba(0, 122, 204, 0.1));
            border-bottom: 1px solid var(--vscode-inputValidation-infoBorder, rgba(0, 122, 204, 0.3));
        }
    </style>
</head>
<body>
    <div class="header-container">
        <div class="breadcrumb" id="breadcrumbContent">${this._getBreadcrumbContent()}</div>
        <div class="search-container">
            <span class="search-icon">🔍</span>
            <input type="text" class="search-input" id="searchInput" placeholder="Search..." value="${this._escapeHtml(this._searchQuery)}">
        </div>
    </div>
    
    <div class="search-result-info" id="searchInfo" style="display: ${this._searchQuery ? 'block' : 'none'};">${this._searchQuery ? 'Searching: ' + this._escapeHtml(this._searchQuery) : ''}</div>
    
    <div class="table-container">
        <table>
            <thead>
                <tr>
                    <th class="name" onclick="sort('name')">Name${sortIndicator('name')}</th>
                    <th class="modified" onclick="sort('modified')">Modified${sortIndicator('modified')}</th>
                    <th class="size" onclick="sort('size')">Size${sortIndicator('size')}</th>
                </tr>
            </thead>
            <tbody id="fileListBody">
                ${entries}
            </tbody>
        </table>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        const searchInput = document.getElementById('searchInput');
        let lastSearchValue = '${this._escapeHtml(this._searchQuery)}';
        
        function openFile(path) {
            vscode.postMessage({
                command: 'openFile',
                path: path
            });
        }
        
        function navigateTo(path) {
            vscode.postMessage({
                command: 'navigateTo',
                path: path
            });
        }
        
        function sort(field) {
            vscode.postMessage({
                command: 'sort',
                field: field
            });
        }
        
        function navigateBreadcrumb(relativePath) {
            vscode.postMessage({
                command: 'navigateBreadcrumb',
                path: relativePath
            });
        }
        
        let searchTimeout = null;
        searchInput.addEventListener('input', function(e) {
            const value = e.target.value;
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }
            searchTimeout = setTimeout(() => {
                if (value !== lastSearchValue) {
                    lastSearchValue = value;
                    vscode.postMessage({
                        command: 'search',
                        query: value
                    });
                }
            }, 300);
        });
        
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateFileList') {
                document.getElementById('fileListBody').innerHTML = message.entries;
                document.getElementById('breadcrumbContent').innerHTML = message.breadcrumb;
                const searchInfo = document.getElementById('searchInfo');
                if (message.searchQuery) {
                    searchInfo.textContent = 'Searching: ' + message.searchQuery;
                    searchInfo.style.display = 'block';
                } else {
                    searchInfo.style.display = 'none';
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
        html += `<span class="breadcrumb-item root-item${isAtRoot ? ' current' : ''}" onclick="navigateBreadcrumb('')"><span class="breadcrumb-icon">📂</span>${this._escapeHtml(rootName)}</span>`;
        let accumulatedPath = '';
        for (let i = 0; i < parts.length; i++) {
            accumulatedPath = accumulatedPath ? path.join(accumulatedPath, parts[i]) : parts[i];
            html += `<span class="breadcrumb-separator">›</span>`;
            const isLast = i === parts.length - 1;
            if (isLast) {
                html += `<span class="breadcrumb-item current"><span class="breadcrumb-icon">📁</span>${this._escapeHtml(parts[i])}</span>`;
            }
            else {
                html += `<span class="breadcrumb-item" onclick="navigateBreadcrumb('${this._escapeHtml(accumulatedPath)}')"><span class="breadcrumb-icon">📁</span>${this._escapeHtml(parts[i])}</span>`;
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
                files = entries.map(entry => {
                    const fullPath = path.join(this._currentPath, entry.name);
                    const stat = fs.statSync(fullPath);
                    return {
                        name: entry.name,
                        path: fullPath,
                        isDirectory: entry.isDirectory(),
                        modified: this._formatDate(stat.mtime),
                        modifiedTime: stat.mtime.getTime(),
                        size: entry.isDirectory() ? '-' : this._formatSize(stat.size),
                        sizeBytes: entry.isDirectory() ? 0 : stat.size
                    };
                });
            }
        }
        catch (e) {
            return `<tr><td colspan="3" class="no-workspace">Error reading directory</td></tr>`;
        }
        files = this._sortFiles(files);
        if (this._searchQuery && files.length === 0) {
            return `<tr><td colspan="3" class="no-workspace">No files found matching "${this._escapeHtml(this._searchQuery)}"</td></tr>`;
        }
        return files.map(file => {
            const iconClass = file.isDirectory ? 'folder-icon' : 'file-icon';
            const clickHandler = file.isDirectory
                ? `onclick="navigateTo('${this._escapeHtml(file.path)}')"`
                : `onclick="openFile('${this._escapeHtml(file.path)}')"`;
            return `<tr class="file-row" ${clickHandler}>
                <td class="${iconClass}">${this._escapeHtml(file.name)}</td>
                <td class="modified">${file.modified}</td>
                <td class="size">${file.size}</td>
            </tr>`;
        }).join('');
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
                                size: entry.isDirectory() ? '-' : this._formatSize(stat.size),
                                sizeBytes: entry.isDirectory() ? 0 : stat.size
                            });
                        }
                        catch (e) {
                            // Skip files that cannot be accessed
                        }
                    }
                    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                        searchDir(fullPath);
                    }
                }
            }
            catch (e) {
                // Skip directories that cannot be accessed
            }
        };
        searchDir(dirPath);
        return results;
    }
    _sortFiles(files) {
        const sorted = [...files];
        sorted.sort((a, b) => {
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
    _formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
    }
    _formatSize(bytes) {
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        else if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        else if (bytes < 1024 * 1024 * 1024) {
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        }
        else {
            return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
        }
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
}
exports.TabViewerViewProvider = TabViewerViewProvider;
TabViewerViewProvider.viewType = 'tabViewer';
//# sourceMappingURL=tabViewerViewProvider.js.map