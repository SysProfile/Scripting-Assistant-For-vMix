import * as vscode from 'vscode';
import { vMixFunctions, inputsList, objectsList } from './globals';
import { findRange, getRangeDescription, getRangeCompletionItems, getRangeProgressiveValues, getRangeProgressiveOverloads } from './ranges';
import { dataSourceTypes, isDataSourceFunction } from './datasources';
import { t } from './i18n';

// ==========================================
// UTILIDADES DE FILTRADO
// ==========================================

function functionHasSelectedParam(funcData: any): boolean {
    if (!funcData || !funcData.parameters || typeof funcData.parameters !== 'object') { return false; }
    return Object.keys(funcData.parameters).some(k => {
        const lower = k.toLowerCase();
        return lower === 'selectedname' || lower === 'selectedindex';
    });
}

function extractInputFromFirstArg(argsTyped: string): string | null {
    const typedArgs = argsTyped.split(',');
    if (typedArgs.length === 0) { return null; }
    const firstArg = typedArgs[0].trim();
    const inputMatch = firstArg.match(/^InputsList\.(\w+)$/i);
    return inputMatch ? inputMatch[1] : null;
}

// ==========================================
// SNIPPET BUILDER CON SOPORTE DE OVERLOADS
// ==========================================

function buildSmartSnippet(funcName: string, parameters: any, includeOptional: boolean): vscode.SnippetString {
    const paramKeys = Object.keys(parameters || {});

    if (paramKeys.length === 0) {
        return new vscode.SnippetString(`${funcName}()`);
    }

    const parts: string[] = [];
    let tabIndex = 1;

    paramKeys.forEach(key => {
        const param = parameters[key];

        if (param.optional && !includeOptional) { return; }

        if (param.composites) {
            if (isDataSourceFunction(funcName)) {
                parts.push(`DataSource\${${tabIndex}}`);
                tabIndex++;
                for (let c = 1; c < param.composites.length; c++) {
                    const comp = param.composites[c];
                    if (comp.type === 'string') {
                        parts.push(`"\${${tabIndex}}"`);
                    } else {
                        parts.push(`\${${tabIndex}}`);
                    }
                    tabIndex++;
                }
                return new vscode.SnippetString(`${funcName}(${parts.join(', ')})`);
            }
            parts.push(`"\${${tabIndex}}"`);
        } else {
            const lowerKey = key.toLowerCase();

            switch (param.type) {
                case 'input':
                    parts.push(`InputsList\${${tabIndex}}`);
                    break;
                case 'string':
                    if (lowerKey === 'selectedname' || lowerKey === 'selectedindex') {
                        parts.push(`ObjectsList\${${tabIndex}}`);
                    } else {
                        parts.push(`"\${${tabIndex}}"`);
                    }
                    break;
                default:
                    parts.push(`\${${tabIndex}}`);
                    break;
            }
        }
        tabIndex++;
    });

    return new vscode.SnippetString(`${funcName}(${parts.join(', ')})`);
}

// Snippet para overloads progresivos: el Input es tab stop y cada letra es su propia constante tab stop
// letters = ["M"] → AudioBus(${1:InputsList}, ${2:M})
// letters = ["M","A"] → AudioBus(${1:InputsList}, ${2:M}, ${3:A})
function buildProgressiveSnippet(funcName: string, parameters: any, letters: string[]): vscode.SnippetString {
    const parts: string[] = [];
    let tabIndex = 1;

    // Primer parámetro: siempre Input
    const paramKeys = Object.keys(parameters || {});
    const inputKey = paramKeys.find(k => (parameters[k] as any).type === 'input');
    if (inputKey) {
        parts.push(`InputsList\${${tabIndex}}`);
        tabIndex++;
    }

    // Cada letra es un parámetro separado sin comillas (constante)
    letters.forEach(letter => {
        parts.push(`\${${tabIndex}:${letter}}`);
        tabIndex++;
    });

    return new vscode.SnippetString(`${funcName}(${parts.join(', ')})`);
}

// Generar label de firma para el detail del CompletionItem
function buildSignatureLabel(parameters: any, includeOptional: boolean): string {
    const paramKeys = Object.keys(parameters || {});
    const parts: string[] = [];

    paramKeys.forEach(key => {
        const param = parameters[key];
        if (param.optional && !includeOptional) { return; }

        const suffix = param.optional ? '?' : '';
        parts.push(`${key}${suffix}`);
    });

    return `(${parts.join(', ')})`;
}

// ==========================================
// COMPLETION PROVIDER
// ==========================================

export function getCompletionProvider(): vscode.Disposable {
    return vscode.languages.registerCompletionItemProvider(
        'vmix',
        {
            provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {

                const linePrefix = document.lineAt(position).text.substring(0, position.character);

                // Saltar líneas comentadas
                if (linePrefix.trimStart().startsWith("'")) {
                    return undefined;
                }

                // Rastrear variables de Input.Find
                const textUntilCursor = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
                const inputVarRegex = /Dim\s+([a-zA-Z0-9_]+)\s*(?:As\s+\w+\s*)?=\s*API\.Input\.Find/gi;
                let inputVarMatch;
                const trackedInputs: string[] = [];

                while ((inputVarMatch = inputVarRegex.exec(textUntilCursor)) !== null) {
                    trackedInputs.push(inputVarMatch[1]);
                }

                // Rastrear TODAS las variables Dim
                const allVarRegex = /Dim\s+([a-zA-Z0-9_]+)\s*(?:As\s+(\w+))?/gi;
                let allVarMatch;
                const trackedVars: { name: string; varType: string }[] = [];

                while ((allVarMatch = allVarRegex.exec(textUntilCursor)) !== null) {
                    trackedVars.push({
                        name: allVarMatch[1],
                        varType: allVarMatch[2] || 'Variant'
                    });
                }

                // Propiedades de variables Input.Find (miVar.)
                const currentVarMatch = linePrefix.match(/([a-zA-Z0-9_]+)\.$/);
                if (currentVarMatch) {
                    const typedVar = currentVarMatch[1].toLowerCase();

                    if (trackedInputs.some(v => v.toLowerCase() === typedVar)) {
                        const inputProps = [
                            { name: 'Text', desc: t('prop.text') },
                            { name: 'Image', desc: t('prop.image') },
                            { name: 'State', desc: t('prop.state') },
                            { name: 'Position', desc: t('prop.position') },
                            { name: 'Duration', desc: t('prop.duration') }
                        ];

                        return inputProps.map(p => {
                            const item = new vscode.CompletionItem(p.name, vscode.CompletionItemKind.Property);
                            item.detail = p.desc;
                            if (p.name === 'Text' || p.name === 'Image') {
                                item.kind = vscode.CompletionItemKind.Method;
                                item.insertText = new vscode.SnippetString(`${p.name}($1)`);
                            }
                            return item;
                        });
                    }
                }

                if (linePrefix.match(/InputsList\.$/i)) {
                    return inputsList.map(i => {
                        const item = new vscode.CompletionItem(i.sanitized, vscode.CompletionItemKind.EnumMember);
                        item.detail = i.original;
                        return item;
                    });
                }

                // ObjectsList. con filtrado contextual
                if (linePrefix.match(/ObjectsList\.$/i)) {
                    let filteredObjects = [...objectsList];

                    const funcContext = linePrefix.match(/API\.(\w+)\.(\w+)\s*\(([^)]*?)ObjectsList\.$/i);
                    if (funcContext) {
                        const ctxFuncName = funcContext[2];

                        const parentInputName = extractInputFromFirstArg(funcContext[3]);
                        if (parentInputName) {
                            filteredObjects = filteredObjects.filter(o =>
                                o.parentInput?.toLowerCase() === parentInputName.toLowerCase()
                            );
                        }

                        const lowerFunc = ctxFuncName.toLowerCase();
                        if (lowerFunc.includes('text') && !lowerFunc.includes('image')) {
                            filteredObjects = filteredObjects.filter(o => o.objectKind === 'text');
                        } else if (lowerFunc.includes('image') && !lowerFunc.includes('text')) {
                            filteredObjects = filteredObjects.filter(o => o.objectKind === 'image');
                        }
                    }

                    return filteredObjects.map(o => {
                        const item = new vscode.CompletionItem(o.sanitized, vscode.CompletionItemKind.EnumMember);
                        item.detail = o.original;
                        return item;
                    });
                }

                if (linePrefix.match(/DataSource\.$/i)) {
                    return dataSourceTypes.map(ds => {
                        const item = new vscode.CompletionItem(ds.enumName, vscode.CompletionItemKind.EnumMember);
                        item.detail = ds.nativeValue;
                        return item;
                    });
                }

                if (linePrefix.match(/API\.$/i)) {
                    const categories = [...new Set(vMixFunctions.map(f => f.category))];

                    const specialCategories = ['Input', 'Shortcut'];
                    specialCategories.forEach(sc => {
                        if (!categories.some(c => (c as string).toLowerCase() === sc.toLowerCase())) {
                            categories.push(sc);
                        }
                    });

                    return categories.map(c => {
                        const item = new vscode.CompletionItem(c as string, vscode.CompletionItemKind.Module);
                        item.commitCharacters = ['.'];
                        return item;
                    });
                }

                // Funciones de una categoría con overloads
                const categoryMatch = linePrefix.match(/API\.(\w+)\.$/i);
                if (categoryMatch) {
                    const category = categoryMatch[1].toLowerCase();

                    if (category === 'input') {
                        const findItem = new vscode.CompletionItem('Find', vscode.CompletionItemKind.Method);
                        findItem.detail = t('prop.inputFind');
                        findItem.insertText = new vscode.SnippetString('Find($1)');
                        return [findItem];
                    }

                    if (category === 'shortcut') {
                        const valueItem = new vscode.CompletionItem('Value', vscode.CompletionItemKind.Method);
                        valueItem.detail = t('prop.shortcutValue');
                        valueItem.insertText = new vscode.SnippetString('Value($1)');
                        return [valueItem];
                    }

                    const functions = vMixFunctions.filter(f => f.category.toLowerCase() === category);
                    const completionItems: vscode.CompletionItem[] = [];

                    functions.forEach((f, funcIndex) => {
                        const rangeData = findRange(f.category, f.function);
                        const rangeDesc = rangeData ? ` | ${getRangeDescription(rangeData.range)}` : '';
                        const params = f.parameters;

                        // Overloads progresivos para rangos tipo !
                        // Genera un overload por cada profundidad: (Input, M), (Input, M, A), ...
                        if (rangeData && rangeData.range.startsWith('!')) {
                            const overloads = getRangeProgressiveOverloads(rangeData.range);
                            overloads.forEach((letters, overloadIndex) => {
                                const item = new vscode.CompletionItem(f.function, vscode.CompletionItemKind.Method);
                                item.detail = `${f.function}(Input, ${letters.join(', ')})`;
                                item.documentation = new vscode.MarkdownString(f.description + rangeDesc);
                                item.insertText = buildProgressiveSnippet(f.function, params, letters);
                                item.sortText = `${String(funcIndex).padStart(4, '0')}${String.fromCharCode(97 + overloadIndex)}`;
                                completionItems.push(item);
                            });
                            return;
                        }

                        const hasParams = params && typeof params === 'object' && Object.keys(params).length > 0;
                        const hasOptional = hasParams && Object.values(params).some((p: any) => p.optional);

                        // Overload 1: solo parámetros requeridos (siempre)
                        const requiredItem = new vscode.CompletionItem(f.function, vscode.CompletionItemKind.Method);
                        const requiredLabel = hasParams ? buildSignatureLabel(params, false) : '()';
                        requiredItem.detail = `${f.function}${requiredLabel}`;
                        requiredItem.documentation = new vscode.MarkdownString(f.description + rangeDesc);
                        requiredItem.insertText = buildSmartSnippet(f.function, params, false);
                        requiredItem.sortText = `${String(funcIndex).padStart(4, '0')}a`;
                        completionItems.push(requiredItem);

                        // Overload 2: todos los parámetros (solo si hay opcionales)
                        if (hasOptional) {
                            const fullItem = new vscode.CompletionItem(f.function, vscode.CompletionItemKind.Method);
                            const fullLabel = buildSignatureLabel(params, true);
                            fullItem.detail = `${f.function}${fullLabel}`;
                            fullItem.documentation = new vscode.MarkdownString(f.description + rangeDesc);
                            fullItem.insertText = buildSmartSnippet(f.function, params, true);
                            fullItem.sortText = `${String(funcIndex).padStart(4, '0')}b`;
                            completionItems.push(fullItem);
                        }
                    });

                    return completionItems;
                }

                // Autocompletado contextual dentro de parámetros de funciones API
                const insideFuncMatch = linePrefix.match(/API\.(\w+)\.(\w+)\s*\(([^)]*?)$/i);
                if (insideFuncMatch) {
                    const category = insideFuncMatch[1];
                    const funcName = insideFuncMatch[2];
                    const argsTyped = insideFuncMatch[3];
                    const currentArgIndex = (argsTyped.match(/,/g) || []).length;

                    if (currentArgIndex === 0 && isDataSourceFunction(funcName)) {
                        return dataSourceTypes.map(ds => {
                            const item = new vscode.CompletionItem(`DataSource.${ds.enumName}`, vscode.CompletionItemKind.EnumMember);
                            item.detail = ds.nativeValue;
                            return item;
                        });
                    }

                    const funcData = vMixFunctions.find(f =>
                        f.category.toLowerCase() === category.toLowerCase() &&
                        f.function.toLowerCase() === funcName.toLowerCase()
                    );

                    // Para funciones con rango !, ofrecer letras de bus como constantes en posición 1+
                    if (funcData) {
                        const rangeData = findRange(category, funcName);
                        if (rangeData && rangeData.range.startsWith('!') && currentArgIndex >= 1) {
                            const values = getRangeProgressiveValues(rangeData.range);
                            // Excluir letras ya usadas en args anteriores
                            const alreadyUsed = argsTyped.split(',').slice(1).map(a => a.trim().toUpperCase());
                            return values
                                .filter(v => !alreadyUsed.includes(v.toUpperCase()))
                                .map(v => {
                                    const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.Constant);
                                    item.detail = `Bus letter`;
                                    item.insertText = v;
                                    return item;
                                });
                        }
                    }

                    if (funcData && funcData.parameters && typeof funcData.parameters === 'object') {
                        const paramKeys = Object.keys(funcData.parameters);
                        const hasSelected = functionHasSelectedParam(funcData);

                        if (currentArgIndex < paramKeys.length) {
                            const currentParamKey = paramKeys[currentArgIndex];
                            const currentParam = funcData.parameters[currentParamKey];

                            if (currentParam && currentParam.type === 'input') {
                                let filteredInputs = inputsList;

                                if (hasSelected) {
                                    filteredInputs = inputsList.filter(i => i.inputType === 9000);
                                }

                                return filteredInputs.map(i => {
                                    const item = new vscode.CompletionItem(`InputsList.${i.sanitized}`, vscode.CompletionItemKind.EnumMember);
                                    item.detail = i.original;
                                    return item;
                                });
                            }

                            if (currentParamKey.toLowerCase() === 'selectedindex' || currentParamKey.toLowerCase() === 'selectedname') {
                                let filteredObjects = [...objectsList];

                                const parentInputName = extractInputFromFirstArg(argsTyped);
                                if (parentInputName) {
                                    filteredObjects = filteredObjects.filter(o =>
                                        o.parentInput?.toLowerCase() === parentInputName.toLowerCase()
                                    );
                                }

                                const lowerFunc = funcName.toLowerCase();
                                if (lowerFunc.includes('text') && !lowerFunc.includes('image')) {
                                    filteredObjects = filteredObjects.filter(o => o.objectKind === 'text');
                                } else if (lowerFunc.includes('image') && !lowerFunc.includes('text')) {
                                    filteredObjects = filteredObjects.filter(o => o.objectKind === 'image');
                                }

                                return filteredObjects.map(o => {
                                    const item = new vscode.CompletionItem(`ObjectsList.${o.sanitized}`, vscode.CompletionItemKind.EnumMember);
                                    item.detail = o.original;
                                    return item;
                                });
                            }

                            const rangeData = findRange(category, funcName);
                            if (rangeData) {
                                const completionVals = getRangeCompletionItems(rangeData.range);
                                if (completionVals.length > 0) {
                                    const isAccumulative = rangeData.range.startsWith('+');
                                    return completionVals.map(v => {
                                        const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.Value);
                                        item.detail = isAccumulative ? `Accumulative (can combine)` : `Valid option`;
                                        if (currentParam && currentParam.type === 'string') {
                                            item.insertText = `"${v}"`;
                                        }
                                        return item;
                                    });
                                }
                            }
                        }
                    }

                    // Dentro de una función: no mostrar root items
                    return [];
                }

                // Items raíz
                if (!linePrefix.match(/\.[a-zA-Z0-9_]*$/)) {
                    const rootItems: vscode.CompletionItem[] = [];

                    const apiItem = new vscode.CompletionItem('API', vscode.CompletionItemKind.Class);
                    apiItem.commitCharacters = ['.'];
                    rootItems.push(apiItem);

                    const inputsListItem = new vscode.CompletionItem('InputsList', vscode.CompletionItemKind.Enum);
                    inputsListItem.commitCharacters = ['.'];
                    rootItems.push(inputsListItem);

                    const objectsListItem = new vscode.CompletionItem('ObjectsList', vscode.CompletionItemKind.Enum);
                    objectsListItem.commitCharacters = ['.'];
                    rootItems.push(objectsListItem);

                    const dataSourceItem = new vscode.CompletionItem('DataSource', vscode.CompletionItemKind.Enum);
                    dataSourceItem.commitCharacters = ['.'];
                    rootItems.push(dataSourceItem);

                    const addedVars = new Set<string>();

                    trackedVars.forEach(v => {
                        const lowerName = v.name.toLowerCase();
                        if (addedVars.has(lowerName)) { return; }
                        addedVars.add(lowerName);

                        const varItem = new vscode.CompletionItem(v.name, vscode.CompletionItemKind.Variable);
                        varItem.detail = `Dim ${v.name} As ${v.varType}`;

                        if (trackedInputs.some(ti => ti.toLowerCase() === lowerName)) {
                            varItem.commitCharacters = ['.'];
                        }

                        rootItems.push(varItem);
                    });

                    return rootItems;
                }

                return undefined;
            }
        },
        '.', ',', '('
    );
}