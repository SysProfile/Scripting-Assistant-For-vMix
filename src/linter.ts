// ==========================================
// LINTER DE BUENAS PRÁCTICAS
// Detecta patrones problemáticos típicos en vMix scripts
// ==========================================

import * as vscode from 'vscode';
import { getFunctionByName } from './funcIndex';
import { t } from './i18n';

interface ApiCall {
    line: number;
    funcName: string;
    inputName: string | null;
    isWait: boolean;
    fullText: string;
    range: vscode.Range;
}

// Detecta llamadas API consecutivas al mismo Input sin un Wait entre medio
export function checkMissingWaits(document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const calls: ApiCall[] = [];

    for (let i = 0; i < document.lineCount; i++) {
        const text = document.lineAt(i).text;
        const trimmed = text.trim();
        if (trimmed.startsWith("'")) { continue; }

        // Detectar llamadas tipadas: API.Cat.Func(InputsList.X, ...)
        const typedMatch = trimmed.match(/API\.(\w+)\.(\w+)\s*\(([^)]*)\)/);
        if (typedMatch) {
            const funcName = typedMatch[2];
            const args = typedMatch[3];
            const inputMatch = args.match(/InputsList\.(\w+)/);
            const isWait = funcName.toLowerCase() === 'function' && args.toLowerCase().includes('wait');
            calls.push({
                line: i,
                funcName,
                inputName: inputMatch ? inputMatch[1] : null,
                isWait: isWait || /\bWait\b/i.test(funcName),
                fullText: trimmed,
                range: new vscode.Range(i, 0, i, text.length)
            });
        }

        // Detectar API.Function("Wait", ...)
        const waitMatch = trimmed.match(/API\.Function\s*\(\s*"Wait"/i);
        if (waitMatch) {
            calls.push({
                line: i,
                funcName: 'Wait',
                inputName: null,
                isWait: true,
                fullText: trimmed,
                range: new vscode.Range(i, 0, i, text.length)
            });
        }
    }

    // Buscar llamadas consecutivas al mismo input sin Wait entre medio
    for (let i = 0; i < calls.length - 1; i++) {
        const a = calls[i];
        const b = calls[i + 1];
        if (a.isWait || b.isWait) { continue; }
        if (!a.inputName || !b.inputName) { continue; }
        if (a.inputName.toLowerCase() !== b.inputName.toLowerCase()) { continue; }
        // Solo flagear si las funciones son diferentes (mismo input, diferentes acciones)
        if (a.funcName.toLowerCase() === b.funcName.toLowerCase()) { continue; }

        // ¿Hay algún Wait entre las dos líneas?
        let hasWait = false;
        for (let k = a.line + 1; k < b.line; k++) {
            const lineText = document.lineAt(k).text.trim();
            if (lineText.match(/Wait/i) && !lineText.startsWith("'")) {
                hasWait = true;
                break;
            }
        }

        if (!hasWait) {
            diagnostics.push(new vscode.Diagnostic(
                b.range,
                t('diag.waitMissing', a.inputName),
                vscode.DiagnosticSeverity.Information
            ));
        }
    }

    return diagnostics;
}

// Sugerir uso de API tipada cuando se usa API.Function("X")
export function checkDirectApiFunction(document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    const regex = /API\.Function\(\s*"([^"]+)"/g;
    let m;

    while ((m = regex.exec(text)) !== null) {
        const funcName = m[1];
        const funcData = getFunctionByName(funcName);
        if (funcData) {
            const startPos = document.positionAt(m.index);
            const endPos = document.positionAt(m.index + m[0].length);
            const lineText = document.lineAt(startPos.line).text;
            if (lineText.trimStart().startsWith("'")) { continue; }
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(startPos, endPos),
                t('diag.directApiFunction', funcData.category, funcData.function),
                vscode.DiagnosticSeverity.Information
            ));
        }
    }

    return diagnostics;
}

// Detecta Do ... Loop sin Until/While ni Exit Do dentro
export function checkInfiniteLoops(document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const stack: { line: number; hasCondition: boolean }[] = [];

    for (let i = 0; i < document.lineCount; i++) {
        const text = document.lineAt(i).text;
        const trimmed = text.trim();
        if (trimmed.startsWith("'")) { continue; }
        const lower = trimmed.toLowerCase();

        if (lower === 'do' || lower.match(/^do\s*$/)) {
            stack.push({ line: i, hasCondition: false });
        } else if (lower.match(/^do\s+(?:until|while)\s+/)) {
            stack.push({ line: i, hasCondition: true });
        } else if (lower.match(/^loop\s+(?:until|while)\s+/)) {
            if (stack.length > 0) {
                stack[stack.length - 1].hasCondition = true;
            }
            popLoop(stack);
        } else if (lower === 'loop' || lower.match(/^loop\s*$/)) {
            if (stack.length > 0) {
                const block = stack[stack.length - 1];
                if (!block.hasCondition && !hasExit(document, block.line, i)) {
                    const range = new vscode.Range(block.line, 0, block.line, document.lineAt(block.line).text.length);
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        t('diag.infiniteLoop'),
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }
            popLoop(stack);
        }
    }

    return diagnostics;
}

function popLoop(stack: { line: number; hasCondition: boolean }[]): void {
    if (stack.length > 0) { stack.pop(); }
}

function hasExit(document: vscode.TextDocument, startLine: number, endLine: number): boolean {
    for (let i = startLine + 1; i < endLine; i++) {
        const text = document.lineAt(i).text.trim();
        if (text.startsWith("'")) { continue; }
        if (text.match(/\b(Exit\s+Do|Return|Throw)\b/i)) { return true; }
    }
    return false;
}