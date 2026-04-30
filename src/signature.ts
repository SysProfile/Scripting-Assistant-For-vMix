import * as vscode from 'vscode';
import { getFunction } from './funcIndex';
import { findRange, getRangeDescription } from './ranges';

export function getSignatureProvider(): vscode.Disposable {
    return vscode.languages.registerSignatureHelpProvider(
        'vmix',
        {
            provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position) {
                const linePrefix = document.lineAt(position).text.substring(0, position.character);
                const sigMatch = linePrefix.match(/API\.(\w+)\.(\w+)\s*\([^)]*$/i);
                if (!sigMatch) { return undefined; }

                const category = sigMatch[1];
                const funcName = sigMatch[2];

                const funcData = getFunction(category, funcName);

                if (!funcData || !funcData.parameters) { return undefined; }

                const paramKeys = Object.keys(funcData.parameters);
                if (paramKeys.length === 0) { return undefined; }

                const rangeData = findRange(category, funcName);

                const signatureHelp = new vscode.SignatureHelp();
                const paramStrings = paramKeys.map(key => {
                    const param = funcData.parameters[key];
                    if (param.composites) {
                        return `${key}: composite string`;
                    }
                    return `${key}${param.optional ? '?' : ''}: ${param.type}`;
                });
                const signatureLabel = `${funcData.function}(${paramStrings.join(', ')})`;

                let sigDescription = funcData.description;
                if (rangeData) {
                    sigDescription += `\n\n📐 ${getRangeDescription(rangeData.range)}`;
                }

                const signature = new vscode.SignatureInformation(signatureLabel, new vscode.MarkdownString(sigDescription));

                signature.parameters = paramKeys.map(key => {
                    const param = funcData.parameters[key];
                    let paramDoc = param.description || key;

                    if (param.type === 'input') {
                        paramDoc += '\n\n🔗 Use InputsList.<name>';
                    }

                    if (key.toLowerCase() === 'selectedindex' || key.toLowerCase() === 'selectedname') {
                        paramDoc += '\n\n🔗 Use ObjectsList.<name>';
                    }

                    if ((key.toLowerCase() === 'value' || key.toLowerCase() === 'channel' || key.toLowerCase() === 'duration') && rangeData) {
                        paramDoc += `\n\n📐 ${getRangeDescription(rangeData.range)}`;
                    }

                    if (param.composites) {
                        const parts = param.composites.map((c: any, idx: number) =>
                            `[${idx + 1}] ${c.description} (${c.type}${c.optional ? ', optional' : ''})`
                        );
                        paramDoc = 'Composite value separated by commas:\n' + parts.join('\n');
                    }

                    return new vscode.ParameterInformation(
                        `${key}${param.optional ? '?' : ''}: ${param.composites ? 'composite string' : param.type}`,
                        new vscode.MarkdownString(paramDoc)
                    );
                });

                signatureHelp.signatures = [signature];
                signatureHelp.activeSignature = 0;

                const textInsideParen = linePrefix.substring(sigMatch.index! + sigMatch[0].indexOf('(') + 1);
                signatureHelp.activeParameter = (textInsideParen.match(/,/g) || []).length;

                return signatureHelp;
            }
        },
        '(', ','
    );
}