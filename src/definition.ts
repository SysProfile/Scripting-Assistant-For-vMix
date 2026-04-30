// ==========================================
// DEFINITION PROVIDER
// Ctrl+Click sobre InputsList.X → muestra info en panel
// ==========================================

import * as vscode from 'vscode';
import * as path from 'path';
import { inputsList, objectsList } from './globals';

export function getDefinitionProvider(): vscode.Disposable {
    return vscode.languages.registerDefinitionProvider('vmix', {
        provideDefinition(document, position) {
            const range = document.getWordRangeAtPosition(position, /(?:InputsList|ObjectsList)\.\w+/);
            if (!range) { return undefined; }

            const text = document.getText(range);
            const match = text.match(/^(InputsList|ObjectsList)\.(\w+)$/);
            if (!match) { return undefined; }

            const kind = match[1];
            const sanitized = match[2];

            if (kind === 'InputsList') {
                const input = inputsList.find(i => i.sanitized.toLowerCase() === sanitized.toLowerCase());
                if (!input) { return undefined; }

                const config = vscode.workspace.getConfiguration('vmixScripting');
                const projectPath = config.get<string>('projectPath') || '';
                if (!projectPath) { return undefined; }

                return new vscode.Location(vscode.Uri.file(projectPath), new vscode.Position(0, 0));
            }

            if (kind === 'ObjectsList') {
                const obj = objectsList.find(o => o.sanitized.toLowerCase() === sanitized.toLowerCase());
                if (!obj) { return undefined; }

                const config = vscode.workspace.getConfiguration('vmixScripting');
                const projectPath = config.get<string>('projectPath') || '';
                if (!projectPath) { return undefined; }

                return new vscode.Location(vscode.Uri.file(projectPath), new vscode.Position(0, 0));
            }

            return undefined;
        }
    });
}