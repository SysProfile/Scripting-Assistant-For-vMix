// ==========================================
// FOLDING RANGE PROVIDER
// Plegado de bloques If/For/While/Do/Select Case
// ==========================================

import * as vscode from 'vscode';

interface BlockStart {
    line: number;
    type: 'if' | 'for' | 'while' | 'do' | 'select' | 'region';
}

export function getFoldingProvider(): vscode.Disposable {
    return vscode.languages.registerFoldingRangeProvider('vmix', {
        provideFoldingRanges(document) {
            const ranges: vscode.FoldingRange[] = [];
            const stack: BlockStart[] = [];

            for (let i = 0; i < document.lineCount; i++) {
                const text = document.lineAt(i).text;
                const trimmed = text.trim();
                const lower = trimmed.toLowerCase();

                if (trimmed.startsWith("'")) {
                    // Region marker: '#region ... '#endregion
                    if (lower.match(/^'\s*#region\b/)) {
                        stack.push({ line: i, type: 'region' });
                        continue;
                    }
                    if (lower.match(/^'\s*#endregion\b/)) {
                        const start = popBlock(stack, 'region');
                        if (start !== null && i > start) {
                            ranges.push(new vscode.FoldingRange(start, i, vscode.FoldingRangeKind.Region));
                        }
                        continue;
                    }
                    continue;
                }

                // Apertura: If ... Then sin código después de Then
                if (lower.match(/^if\b/) && lower.match(/\bthen\s*$/)) {
                    stack.push({ line: i, type: 'if' });
                } else if (lower.match(/^for\s+/) || lower.match(/^for\s+each\s+/)) {
                    stack.push({ line: i, type: 'for' });
                } else if (lower.match(/^while\s+/)) {
                    stack.push({ line: i, type: 'while' });
                } else if (lower === 'do' || lower.match(/^do\s+/)) {
                    stack.push({ line: i, type: 'do' });
                } else if (lower.match(/^select\s+case\b/)) {
                    stack.push({ line: i, type: 'select' });
                }
                // Cierre
                else if (lower.match(/^end\s+if\b/)) {
                    closeBlock(stack, 'if', i, ranges);
                } else if (lower.match(/^next\b/)) {
                    closeBlock(stack, 'for', i, ranges);
                } else if (lower.match(/^end\s+while\b/) || lower === 'wend') {
                    closeBlock(stack, 'while', i, ranges);
                } else if (lower.match(/^loop\b/)) {
                    closeBlock(stack, 'do', i, ranges);
                } else if (lower.match(/^end\s+select\b/)) {
                    closeBlock(stack, 'select', i, ranges);
                }
            }

            return ranges;
        }
    });
}

function popBlock(stack: BlockStart[], type: BlockStart['type']): number | null {
    for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].type === type) {
            const found = stack[i];
            stack.splice(i, 1);
            return found.line;
        }
    }
    return null;
}

function closeBlock(stack: BlockStart[], type: BlockStart['type'], endLine: number, out: vscode.FoldingRange[]): void {
    const start = popBlock(stack, type);
    if (start !== null && endLine > start) {
        out.push(new vscode.FoldingRange(start, endLine));
    }
}