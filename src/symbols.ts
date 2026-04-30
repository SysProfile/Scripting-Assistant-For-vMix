// ==========================================
// DOCUMENT SYMBOL PROVIDER
// Genera outline navegable: secciones por comentarios y llamadas API
// ==========================================

import * as vscode from 'vscode';

export function getSymbolProvider(): vscode.Disposable {
    return vscode.languages.registerDocumentSymbolProvider('vmix', {
        provideDocumentSymbols(document) {
            const symbols: vscode.DocumentSymbol[] = [];
            const sectionStack: { symbol: vscode.DocumentSymbol; depth: number }[] = [];

            for (let i = 0; i < document.lineCount; i++) {
                const text = document.lineAt(i).text;
                const trimmed = text.trim();

                // Sección: comentarios con --, == o ##
                const sectionMatch = trimmed.match(/^'\s*[-=#]{2,}\s*(.+?)\s*[-=#]{2,}?\s*$/);
                if (sectionMatch && i > 0) {
                    const name = sectionMatch[1].trim();
                    if (name.length > 0) {
                        const range = new vscode.Range(i, 0, i, text.length);
                        const sym = new vscode.DocumentSymbol(
                            name,
                            'section',
                            vscode.SymbolKind.Namespace,
                            range,
                            range
                        );
                        symbols.push(sym);
                        sectionStack.push({ symbol: sym, depth: 0 });
                    }
                    continue;
                }

                // Variables Dim
                const dimMatch = trimmed.match(/^Dim\s+(\w+)(?:\s+As\s+(\w+))?/i);
                if (dimMatch) {
                    const range = new vscode.Range(i, 0, i, text.length);
                    const sym = new vscode.DocumentSymbol(
                        dimMatch[1],
                        dimMatch[2] || 'Variant',
                        vscode.SymbolKind.Variable,
                        range,
                        range
                    );
                    addToParent(sym, sectionStack, symbols);
                    continue;
                }

                // Llamadas API.X.Y(
                const apiMatch = trimmed.match(/^API\.(\w+)\.(\w+)\s*\(/i);
                if (apiMatch) {
                    const range = new vscode.Range(i, 0, i, text.length);
                    const sym = new vscode.DocumentSymbol(
                        `${apiMatch[1]}.${apiMatch[2]}`,
                        'API call',
                        vscode.SymbolKind.Method,
                        range,
                        range
                    );
                    addToParent(sym, sectionStack, symbols);
                }
            }

            return symbols;
        }
    });
}

function addToParent(
    sym: vscode.DocumentSymbol,
    stack: { symbol: vscode.DocumentSymbol; depth: number }[],
    rootList: vscode.DocumentSymbol[]
): void {
    if (stack.length > 0) {
        stack[stack.length - 1].symbol.children.push(sym);
    } else {
        rootList.push(sym);
    }
}