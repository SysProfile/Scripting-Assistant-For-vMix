// ==========================================
// HOVER PROVIDER
// Muestra descripción + rango + ejemplo al pasar el mouse
// ==========================================

import * as vscode from 'vscode';
import { getFunction } from './funcIndex';
import { findRange, getRangeDescription } from './ranges';
import { inputsList, objectsList } from './globals';
import { dataSourceTypes } from './datasources';
import { t } from './i18n';

export function getHoverProvider(): vscode.Disposable {
    return vscode.languages.registerHoverProvider('vmix', {
        provideHover(document, position) {
            const line = document.lineAt(position).text;

            if (line.trimStart().startsWith("'")) { return undefined; }

            // Hover sobre API.Categoria.Funcion
            const funcRegex = /API\.(\w+)\.(\w+)/g;
            let m;
            while ((m = funcRegex.exec(line)) !== null) {
                const start = m.index;
                const end = start + m[0].length;
                if (position.character >= start && position.character <= end) {
                    const category = m[1];
                    const funcName = m[2];

                    const funcData = getFunction(category, funcName);
                    if (!funcData) { return undefined; }

                    const md = new vscode.MarkdownString();
                    md.appendCodeblock(`API.${category}.${funcName}(${buildParamLabel(funcData.parameters)})`, 'vb');
                    md.appendMarkdown(`\n${funcData.description || '_No description available._'}\n`);

                    const rangeData = findRange(category, funcName);
                    if (rangeData) {
                        md.appendMarkdown(`\n**📐 ${t('hover.range')}:** ${getRangeDescription(rangeData.range)}\n`);
                    }

                    if (funcData.parameters && Object.keys(funcData.parameters).length > 0) {
                        md.appendMarkdown(`\n**${t('hover.parameter')}:**\n`);
                        for (const [key, param] of Object.entries<any>(funcData.parameters)) {
                            const opt = param.optional ? ' _(optional)_' : '';
                            const desc = param.description ? ` — ${param.description}` : '';
                            md.appendMarkdown(`- \`${key}\`: ${param.type || 'string'}${opt}${desc}\n`);
                        }
                    }

                    if (funcData.examples && funcData.examples.length > 0) {
                        md.appendMarkdown(`\n**${t('hover.example')}:**\n`);
                        md.appendCodeblock(funcData.examples[0], 'vb');
                    }

                    return new vscode.Hover(md, new vscode.Range(
                        new vscode.Position(position.line, start),
                        new vscode.Position(position.line, end)
                    ));
                }
            }

            // Hover sobre InputsList.X
            const inputRegex = /InputsList\.(\w+)/g;
            while ((m = inputRegex.exec(line)) !== null) {
                const start = m.index;
                const end = start + m[0].length;
                if (position.character >= start && position.character <= end) {
                    const sanitized = m[1];
                    const input = inputsList.find(i => i.sanitized.toLowerCase() === sanitized.toLowerCase());
                    if (!input) { return undefined; }

                    const md = new vscode.MarkdownString();
                    md.appendMarkdown(`**Input:** \`${input.original}\`\n\n`);
                    if (input.inputType !== undefined) {
                        md.appendMarkdown(`**Type ID:** ${input.inputType}${input.inputType === 9000 ? ' _(GT Title)_' : ''}\n`);
                    }
                    return new vscode.Hover(md);
                }
            }

            // Hover sobre ObjectsList.X
            const objectRegex = /ObjectsList\.(\w+)/g;
            while ((m = objectRegex.exec(line)) !== null) {
                const start = m.index;
                const end = start + m[0].length;
                if (position.character >= start && position.character <= end) {
                    const sanitized = m[1];
                    const obj = objectsList.find(o => o.sanitized.toLowerCase() === sanitized.toLowerCase());
                    if (!obj) { return undefined; }

                    const md = new vscode.MarkdownString();
                    md.appendMarkdown(`**Object:** \`${obj.original}\`\n\n`);
                    if (obj.objectKind) {
                        md.appendMarkdown(`**Kind:** ${obj.objectKind}\n`);
                    }
                    if (obj.parentInput) {
                        md.appendMarkdown(`**Parent Input:** \`${obj.parentInput}\`\n`);
                    }
                    return new vscode.Hover(md);
                }
            }

            // Hover sobre DataSource.X
            const dsRegex = /DataSource\.(\w+)/g;
            while ((m = dsRegex.exec(line)) !== null) {
                const start = m.index;
                const end = start + m[0].length;
                if (position.character >= start && position.character <= end) {
                    const ds = dataSourceTypes.find(d => d.enumName.toLowerCase() === m![1].toLowerCase());
                    if (!ds) { return undefined; }
                    const md = new vscode.MarkdownString();
                    md.appendMarkdown(`**DataSource:** \`${ds.enumName}\`\n\n**vMix native:** \`${ds.nativeValue}\``);
                    return new vscode.Hover(md);
                }
            }

            return undefined;
        }
    });
}

function buildParamLabel(params: any): string {
    if (!params || typeof params !== 'object') { return ''; }
    const parts: string[] = [];
    for (const [key, p] of Object.entries<any>(params)) {
        const suffix = p.optional ? '?' : '';
        parts.push(`${key}${suffix}: ${p.type || 'string'}`);
    }
    return parts.join(', ');
}