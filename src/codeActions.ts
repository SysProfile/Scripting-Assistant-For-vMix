// ==========================================
// CODE ACTION PROVIDER (Quick Fixes)
// ==========================================

import * as vscode from 'vscode';
import { getFunctionByName } from './funcIndex';
import { dynamicKeywords } from './globals';
import { t } from './i18n';

export function getCodeActionProvider(): vscode.Disposable {
    return vscode.languages.registerCodeActionsProvider('vmix', {
        provideCodeActions(document, range, context) {
            const actions: vscode.CodeAction[] = [];

            // 1. Convertir API.Function("X", ...) → API.Cat.X(...)
            const lineText = document.lineAt(range.start.line).text;
            const apiFuncMatch = lineText.match(/API\.Function\(\s*"([^"]+)"\s*(?:,\s*([^)]*))?\)/);
            if (apiFuncMatch) {
                const funcName = apiFuncMatch[1];
                const funcData = getFunctionByName(funcName);
                if (funcData) {
                    const action = new vscode.CodeAction(
                        t('codeAction.toTypedApi'),
                        vscode.CodeActionKind.QuickFix
                    );
                    const startCol = lineText.indexOf(apiFuncMatch[0]);
                    const endCol = startCol + apiFuncMatch[0].length;
                    const replaceRange = new vscode.Range(
                        range.start.line, startCol,
                        range.start.line, endCol
                    );

                    const argsRaw = (apiFuncMatch[2] || '').trim();
                    const positionalArgs: string[] = [];
                    if (argsRaw && funcData.parameters) {
                        const paramKeys = Object.keys(funcData.parameters);
                        const namedRegex = /(\w+)\s*:=\s*([^,]+(?:,(?!\s*\w+\s*:=)[^,]+)*)/g;
                        const argsObj: { [k: string]: string } = {};
                        let nm;
                        while ((nm = namedRegex.exec(argsRaw)) !== null) {
                            argsObj[nm[1].toLowerCase()] = nm[2].trim();
                        }
                        paramKeys.forEach(pk => {
                            if (argsObj[pk.toLowerCase()]) {
                                positionalArgs.push(argsObj[pk.toLowerCase()]);
                            }
                        });
                    }

                    const newCall = `API.${funcData.category}.${funcData.function}(${positionalArgs.join(', ')})`;
                    action.edit = new vscode.WorkspaceEdit();
                    action.edit.replace(document.uri, replaceRange, newCall);
                    action.diagnostics = context.diagnostics.filter(d => d.range.intersection(replaceRange));
                    actions.push(action);
                }
            }

            // 2. Añadir comentario de nombre de script si falta (línea 0)
            if (range.start.line === 0) {
                const firstLine = document.lineAt(0).text;
                if (!firstLine.trimStart().startsWith("'")) {
                    const action = new vscode.CodeAction(
                        t('codeAction.addScriptName'),
                        vscode.CodeActionKind.QuickFix
                    );
                    action.edit = new vscode.WorkspaceEdit();
                    action.edit.insert(document.uri, new vscode.Position(0, 0), `'${t('editor.defaultScriptName')}\n`);
                    action.diagnostics = context.diagnostics.filter(d => d.range.start.line === 0);
                    actions.push(action);
                }
            }

            // 3. Corregir casing de keyword
            const wordRange = document.getWordRangeAtPosition(range.start);
            if (wordRange) {
                const word = document.getText(wordRange);
                const lower = word.toLowerCase();
                const canonical = dynamicKeywords[lower];
                if (canonical && word !== canonical) {
                    const action = new vscode.CodeAction(
                        `${t('codeAction.fixCasing')}: ${canonical}`,
                        vscode.CodeActionKind.QuickFix
                    );
                    action.edit = new vscode.WorkspaceEdit();
                    action.edit.replace(document.uri, wordRange, canonical);
                    actions.push(action);
                }
            }

            return actions;
        }
    }, {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    });
}