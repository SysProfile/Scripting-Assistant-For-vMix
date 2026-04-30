// ==========================================
// FILE WATCHER CON DEBOUNCE
// Detecta cambios en el proyecto .vmix vinculado y recarga automáticamente
// ==========================================

import * as fs from 'fs';
import * as vscode from 'vscode';

type Callback = () => void;

let currentWatcher: fs.FSWatcher | null = null;
let currentPath: string = '';
let debounceTimer: NodeJS.Timeout | null = null;

const DEBOUNCE_MS = 500;

export function startWatching(projectPath: string, onChange: Callback): void {
    stopWatching();

    if (!projectPath || !fs.existsSync(projectPath)) {
        return;
    }

    currentPath = projectPath;

    try {
        currentWatcher = fs.watch(projectPath, { persistent: false }, (eventType) => {
            if (eventType === 'change' || eventType === 'rename') {
                if (debounceTimer) { clearTimeout(debounceTimer); }
                debounceTimer = setTimeout(() => {
                    debounceTimer = null;
                    // En 'rename' (algunos editores reemplazan el archivo) reabrir el watch
                    if (!fs.existsSync(currentPath)) {
                        stopWatching();
                        return;
                    }
                    try {
                        onChange();
                    } catch (e) {
                        console.error('Error in project watcher callback', e);
                    }
                }, DEBOUNCE_MS);
            }
        });

        currentWatcher.on('error', (err) => {
            console.error('Project watcher error:', err);
            stopWatching();
        });
    } catch (e: any) {
        console.error('Could not start project watcher:', e.message || e);
        currentWatcher = null;
    }
}

export function stopWatching(): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    if (currentWatcher) {
        try { currentWatcher.close(); } catch { /* noop */ }
        currentWatcher = null;
    }
    currentPath = '';
}

export function getWatchedPath(): string {
    return currentPath;
}

// Debounce genérico para diagnostics
export function createDebouncer(delayMs: number) {
    let timer: NodeJS.Timeout | null = null;
    return {
        run: (fn: () => void) => {
            if (timer) { clearTimeout(timer); }
            timer = setTimeout(() => {
                timer = null;
                fn();
            }, delayMs);
        },
        cancel: () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        }
    };
}

// Watcher de extensión para limpieza al desactivar
export function registerWatcherDisposable(context: vscode.ExtensionContext): void {
    context.subscriptions.push({ dispose: () => stopWatching() });
}