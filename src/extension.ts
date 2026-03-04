import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { initI18n, t } from './i18n';
import { setVMixFunctions, setVMixRanges, setDynamicKeywords, dynamicKeywords, inputsList, objectsList } from './globals';
import { loadVMixProjectData, loadScriptsFromProject, createProjectBackup, updateScriptInProject } from './project';
import { exportApiCalls, importApiCalls, importReplaceStringsWithContext } from './transpiler';
import { getCompletionProvider } from './completion';
import { getSignatureProvider } from './signature';
import { updateDiagnostics } from './diagnostics';
import { ProjectStats } from './types';
import { dataSourceTypes } from './datasources';

// ==========================================
// CORRECCIÓN DE INTEGRIDAD DE vMix.json
// ==========================================

function correctVMixJsonIntegrity(jsonPath: string, functions: any[]): void {
    let modified = false;

    for (const func of functions) {
        if (!func.parameters || typeof func.parameters === 'string') {
            continue;
        }

        if ('Duraion' in func.parameters) {
            func.parameters['Duration'] = func.parameters['Duraion'];
            delete func.parameters['Duraion'];
            modified = true;
        }

        if (func.function === 'SetVolumeChannelMixer' && func.parameters?.Value?.composites) {
            func.parameters.Value = {
                type: 'number',
                description: 'Volume value between 0 and 100.',
                optional: false
            };
            modified = true;
        }

        // Eliminar parámetros con \n en el key (basura del scraping)
        for (const key of Object.keys(func.parameters)) {
            if (key.includes('\n')) {
                delete func.parameters[key];
                modified = true;
            }
        }

        // Normalizar: si un parámetro no tiene 'optional', asignar true
        for (const key of Object.keys(func.parameters)) {
            const param = func.parameters[key];
            if (param && typeof param === 'object' && !('optional' in param)) {
                param.optional = true;
                modified = true;
            }
        }
    }

    if (modified) {
        try {
            fs.writeFileSync(jsonPath, JSON.stringify(functions, null, 2), 'utf8');
        } catch (e: any) {
            console.error('Error saving corrected vMix.json', e);
        }
    }
}

// ==========================================
// SANITIZACIÓN DE NOMBRE DE SCRIPT
// ==========================================

function sanitizeScriptName(name: string): string {
    // Solo permitir letras ASCII (a-z, A-Z), dígitos, espacios y guiones bajos
    return name.replace(/[^a-zA-Z0-9_ ]/g, '_').replace(/_+/g, '_').replace(/^\s+|\s+$/g, '');
}

// ==========================================
// ACTIVACIÓN DE LA EXTENSIÓN
// ==========================================

export async function activate(context: vscode.ExtensionContext) {

    initI18n(context.extensionPath, vscode.env.language);

    // ==========================================
    // NOTIFICACIONES DEL PROYECTO
    // ==========================================

    function showProjectNotification(stats: ProjectStats) {
        if (!stats.success) {
            switch (stats.errorMessage) {
                case 'no-path':
                    break;
                case 'not-found':
                    vscode.window.showWarningMessage(t('project.notFound', stats.fileName));
                    break;
                case 'empty-xml':
                    vscode.window.showWarningMessage(t('project.emptyXml', stats.fileName));
                    break;
                default:
                    vscode.window.showErrorMessage(t('project.parseError', stats.fileName));
                    break;
            }
            return;
        }

        vscode.window.showInformationMessage(
            t('project.loaded', stats.fileName, stats.inputCount, stats.objectCount)
        );
    }

    // ==========================================
    // CARGA INICIAL DE DATOS (con mensaje visible)
    // ==========================================

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: t('loading.functions'),
            cancellable: false
        },
        async (progress) => {

            progress.report({ increment: 0 });

            const jsonPath = path.join(context.extensionPath, 'vMix.json');
            try {
                const fileContent = fs.readFileSync(jsonPath, 'utf8');
                const loadedFunctions = JSON.parse(fileContent);

                correctVMixJsonIntegrity(jsonPath, loadedFunctions);

                setVMixFunctions(loadedFunctions);

                const baseKeywords: { [key: string]: string } = {
                    'dim': 'Dim', 'if': 'If', 'then': 'Then', 'else': 'Else', 'elseif': 'ElseIf',
                    'end': 'End', 'select': 'Select', 'case': 'Case', 'for': 'For', 'to': 'To',
                    'step': 'Step', 'next': 'Next', 'while': 'While', 'wend': 'Wend', 'do': 'Do',
                    'loop': 'Loop', 'until': 'Until',
                    'as': 'As', 'true': 'True', 'false': 'False', 'and': 'And', 'or': 'Or',
                    'not': 'Not', 'integer': 'Integer', 'string': 'String', 'double': 'Double',
                    'boolean': 'Boolean', 'api': 'API', 'inputslist': 'InputsList', 'objectslist': 'ObjectsList',
                    'text': 'Text', 'image': 'Image', 'state': 'State', 'position': 'Position', 'duration': 'Duration',
                    'datasource': 'DataSource'
                };

                const dynamicKeywordsLocal = { ...baseKeywords };

                // Registrar DataSource y sus miembros para corrección de casing
                dynamicKeywordsLocal['datasource'] = 'DataSource';
                dataSourceTypes.forEach(ds => {
                    dynamicKeywordsLocal[ds.enumName.toLowerCase()] = ds.enumName;
                });

                loadedFunctions.forEach((f: any) => {
                    dynamicKeywordsLocal[f.function.toLowerCase()] = f.function;
                    dynamicKeywordsLocal[f.category.toLowerCase()] = f.category;
                });

                setDynamicKeywords(dynamicKeywordsLocal);

                progress.report({ increment: 50 });

            } catch (error) {
                vscode.window.showErrorMessage(t('error.loadJson'));
            }

            const rangePath = path.join(context.extensionPath, 'vMixValuesRange.json');
            try {
                const rangeContent = fs.readFileSync(rangePath, 'utf8');
                setVMixRanges(JSON.parse(rangeContent));
            } catch (error) {
                console.warn('vMixValuesRange.json not found or invalid, range features disabled.');
                setVMixRanges([]);
            }

            progress.report({ increment: 100 });

            await new Promise<void>(resolve => setTimeout(resolve, 1200));
        }
    );

    const initialStats = loadVMixProjectData();
    showProjectNotification(initialStats);

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('vmixScripting.projectPath')) {
                const stats = loadVMixProjectData();
                showProjectNotification(stats);
            }
        })
    );

    // ==========================================
    // AUTO-INSERT NOMBRE DE SCRIPT EN ARCHIVOS NUEVOS
    // ==========================================

    const autoInsertDisposable = vscode.workspace.onDidOpenTextDocument(doc => {
        if (doc.languageId !== 'vmix') { return; }
        if (doc.getText().trim().length > 0) { return; }

        setTimeout(() => {
            const editor = vscode.window.visibleTextEditors.find(e => e.document === doc);
            if (editor && doc.getText().trim().length === 0) {
                editor.edit(editBuilder => {
                    editBuilder.insert(new vscode.Position(0, 0), `'${t('editor.defaultScriptName')}\n`);
                });
            }
        }, 150);
    });

    context.subscriptions.push(autoInsertDisposable);

    // ==========================================
    // IMPORTADOR / EXPORTADOR (TRANSPILADOR)
    // ==========================================

    const exportScriptCommand = vscode.commands.registerCommand('vmixScripting.exportScript', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showErrorMessage(t('error.noEditor')); return; }

        // Validar primera línea: debe ser comentario con nombre del script
        const firstLine = editor.document.lineAt(0).text;
        if (!firstLine.trimStart().startsWith("'")) {
            vscode.window.showErrorMessage(t('export.noScriptName'));
            return;
        }
        const rawScriptName = firstLine.trimStart().substring(1).trim();
        if (!rawScriptName) {
            vscode.window.showErrorMessage(t('export.noScriptName'));
            return;
        }

        // Sanitizar nombre: solo letras ASCII, dígitos, espacios y guiones bajos
        const scriptName = sanitizeScriptName(rawScriptName);

        // Obtener texto sin la primera línea (nombre del script)
        let exportedText = editor.document.getText();
        const eolMatch = exportedText.match(/\r?\n/);
        if (eolMatch && eolMatch.index !== undefined) {
            exportedText = exportedText.substring(eolMatch.index + eolMatch[0].length);
        } else {
            exportedText = '';
        }

        // Reemplazar InputsList/ObjectsList por strings originales
        inputsList.forEach(i => {
            const regex = new RegExp(`InputsList\\.${i.sanitized}\\b`, 'gi');
            exportedText = exportedText.replace(regex, `"${i.original}"`);
        });
        objectsList.forEach(o => {
            const regex = new RegExp(`ObjectsList\\.${o.sanitized}\\b`, 'gi');
            exportedText = exportedText.replace(regex, `"${o.original}"`);
        });

        exportedText = exportedText.replace(/API\.Input\.Find/gi, 'Input.Find');
        exportedText = exportedText.replace(/API\.Shortcut\.Value/gi, 'Shortcut.Value');

        const exportResult = exportApiCalls(exportedText);
        exportedText = exportResult.result;

        if (exportResult.unknownFunctions.length > 0) {
            vscode.window.showWarningMessage(
                t('export.unknownFunctions', exportResult.unknownFunctions.length, exportResult.unknownFunctions.join(', '))
            );
        }

        // Mostrar código exportado
        const newDoc = await vscode.workspace.openTextDocument({ content: exportedText, language: 'vb' });
        await vscode.window.showTextDocument(newDoc);
        vscode.window.showInformationMessage(t('export.success'));

        // Ofrecer actualización del proyecto vinculado
        const config = vscode.workspace.getConfiguration('vmixScripting');
        const projectPath = config.get<string>('projectPath') || '';

        if (projectPath && fs.existsSync(projectPath) && projectPath.toLowerCase().endsWith('.vmix')) {
            const answer = await vscode.window.showInformationMessage(
                t('export.askUpdateProject', scriptName),
                t('export.optYes'),
                t('export.optNo')
            );

            if (answer === t('export.optYes')) {
                const backupName = createProjectBackup();
                if (!backupName) {
                    vscode.window.showErrorMessage(t('export.backupError'));
                    return;
                }
                vscode.window.showInformationMessage(t('export.backupCreated', backupName));

                const updateResult = updateScriptInProject(scriptName, exportedText);
                if (updateResult.success) {
                    const msgKey = updateResult.added ? 'export.projectAdded' : 'export.projectUpdated';
                    vscode.window.showInformationMessage(t(msgKey, scriptName));
                } else if (updateResult.errorKey) {
                    vscode.window.showErrorMessage(t(updateResult.errorKey));
                }
            }
        }
    });

    const importScriptCommand = vscode.commands.registerCommand('vmixScripting.importScript', async () => {
        const config = vscode.workspace.getConfiguration('vmixScripting');
        const projectPath = config.get<string>('projectPath') || '';

        if (!projectPath || !fs.existsSync(projectPath)) {
            vscode.window.showErrorMessage(t('import.noProject'));
            return;
        }

        const scripts = loadScriptsFromProject();

        if (scripts.length === 0) {
            vscode.window.showWarningMessage(t('import.noScripts'));
            return;
        }

        const maxPreviewLines = 8;
        const items = scripts.map(s => {
            const codeLines = s.code.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
            const preview = codeLines.slice(0, maxPreviewLines).map(l => l.trimEnd()).join('\n');
            const suffix = codeLines.length > maxPreviewLines ? '\n...' : '';
            return {
                label: s.name,
                description: `${codeLines.length} ${t('import.linesDetail')}`,
                detail: preview + suffix
            };
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: t('import.selectScript'),
            matchOnDetail: false,
            matchOnDescription: false
        });

        if (!selected) { return; }

        const script = scripts.find(s => s.name === selected.label);
        if (!script) { return; }

        let importedText = script.code;

        importedText = importApiCalls(importedText);
        importedText = importedText.replace(/(?<!API\.)Input\.Find/gi, 'API.Input.Find');
        importedText = importedText.replace(/(?<!API\.)Shortcut\.Value/gi, 'API.Shortcut.Value');
        importedText = importReplaceStringsWithContext(importedText);

        // Anteponer nombre del script como comentario en la primera línea
        importedText = `'${script.name}\n${importedText}`;

        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document.languageId === 'vmix') {
            await activeEditor.edit(editBuilder => {
                editBuilder.insert(activeEditor.selection.active, importedText);
            });
        } else {
            const newDoc = await vscode.workspace.openTextDocument({ content: importedText, language: 'vmix' });
            await vscode.window.showTextDocument(newDoc);
        }

        vscode.window.showInformationMessage(t('import.success'));
    });

    context.subscriptions.push(exportScriptCommand, importScriptCommand);

    // ==========================================
    // MENÚ Y BARRA DE ESTADO
    // ==========================================

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = t('statusBar.text');
    statusBarItem.tooltip = t('statusBar.tooltip');
    statusBarItem.command = 'vmixScripting.showMenu';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    const showMenuCommand = vscode.commands.registerCommand('vmixScripting.showMenu', async () => {
        const options: vscode.QuickPickItem[] = [
            { label: t('menu.export.label'), detail: t('menu.export.detail') },
            { label: t('menu.import.label'), detail: t('menu.import.detail') },
            { label: t('menu.openProject.label'), detail: t('menu.openProject.detail') },
            { label: t('menu.settings.label'), detail: t('menu.settings.detail') },
            { label: t('menu.keymap.label'), detail: t('menu.keymap.detail') }
        ];

        const selection = await vscode.window.showQuickPick(options, {
            placeHolder: t('menu.selectAction')
        });

        if (selection) {
            if (selection.label === t('menu.export.label')) {
                vscode.commands.executeCommand('vmixScripting.exportScript');
            } else if (selection.label === t('menu.import.label')) {
                vscode.commands.executeCommand('vmixScripting.importScript');
            } else if (selection.label === t('menu.openProject.label')) {
                vscode.commands.executeCommand('vmixScripting.openProject');
            } else if (selection.label === t('menu.settings.label')) {
                vscode.commands.executeCommand('vmixScripting.openSettings');
            } else if (selection.label === t('menu.keymap.label')) {
                vscode.commands.executeCommand('vmixScripting.installKeymap');
            }
        }
    });

    const openProjectCommand = vscode.commands.registerCommand('vmixScripting.openProject', async () => {
        const fileUris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: t('dialog.openProject.label'),
            filters: { [t('dialog.openProject.filter')]: ['vmix'] }
        });

        if (fileUris && fileUris[0]) {
            const filePath = fileUris[0].fsPath;
            const config = vscode.workspace.getConfiguration('vmixScripting');
            await config.update('projectPath', filePath, vscode.ConfigurationTarget.Global);
        }
    });

    const openSettingsCommand = vscode.commands.registerCommand('vmixScripting.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'vmixScripting');
    });

    const installKeymapCommand = vscode.commands.registerCommand('vmixScripting.installKeymap', async () => {
        vscode.window.showInformationMessage(t('keymap.installing'));
        try {
            await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode.vs-keybindings');
            vscode.window.showInformationMessage(t('keymap.success'));
        } catch (error) {
            vscode.window.showErrorMessage(t('keymap.error'));
        }
    });

    context.subscriptions.push(showMenuCommand, openProjectCommand, openSettingsCommand, installKeymapCommand);

    // ==========================================
    // PROVEEDORES DE LENGUAJE
    // ==========================================

    const provider = getCompletionProvider();

    const formatListener = vscode.workspace.onDidChangeTextDocument(event => {
        const changes = event.contentChanges;
        if (changes.length === 0) { return; }

        const change = changes[0];

        if (change.text === '\n' || change.text === '\r\n') {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === event.document) {
                const lineNum = change.range.start.line;
                const lineText = event.document.lineAt(lineNum).text;
                const trimmed = lineText.trim();
                const lower = trimmed.toLowerCase();

                let shouldClose = false;
                let blockStart = lineText;
                let blockEnd = '';
                let isMiddleBlock = false;

                if (lower.startsWith('if ')) {
                    if (!lower.match(/^if\s+.*\s+then\s+.+$/)) {
                        shouldClose = true;
                        blockStart = lineText.replace(/^(\s*)if\b/i, '$1If');
                        if (!lower.endsWith(' then')) {
                            blockStart += ' Then';
                        } else {
                            blockStart = blockStart.replace(/\bthen$/i, 'Then');
                        }
                        blockEnd = 'End If';
                    }
                } else if (lower.startsWith('elseif ')) {
                    if (!lower.match(/^elseif\s+.*\s+then\s+.+$/)) {
                        shouldClose = true;
                        isMiddleBlock = true;
                        blockStart = lineText.replace(/^(\s*)elseif\b/i, '$1ElseIf');
                        if (!lower.endsWith(' then')) {
                            blockStart += ' Then';
                        } else {
                            blockStart = blockStart.replace(/\bthen$/i, 'Then');
                        }
                    }
                } else if (lower === 'else') {
                    shouldClose = true;
                    isMiddleBlock = true;
                    blockStart = lineText.replace(/^(\s*)else\b/i, '$1Else');
                } else if (lower.startsWith('for ')) {
                    shouldClose = true;
                    blockStart = lineText.replace(/^(\s*)for\b/i, '$1For');
                    blockEnd = 'Next';
                } else if (lower.startsWith('while ')) {
                    shouldClose = true;
                    blockStart = lineText.replace(/^(\s*)while\b/i, '$1While');
                    blockEnd = 'End While';
                } else if (lower.startsWith('do') && (lower === 'do' || lower.startsWith('do '))) {
                    shouldClose = true;
                    blockStart = lineText.replace(/^(\s*)do\b/i, '$1Do');
                    blockEnd = 'Loop';
                } else if (lower.startsWith('select case ')) {
                    shouldClose = true;
                    blockStart = lineText.replace(/^(\s*)select case\b/i, '$1Select Case');
                    blockEnd = 'End Select';
                }

                if (shouldClose) {
                    const leadingSpaces = lineText.match(/^\s*/)?.[0] || '';
                    const replaceRange = new vscode.Range(
                        new vscode.Position(lineNum, 0),
                        new vscode.Position(lineNum + 1, event.document.lineAt(lineNum + 1).text.length)
                    );

                    let snippetStr = '';
                    if (isMiddleBlock) {
                        snippetStr = `${blockStart}\n${leadingSpaces}\t$0`;
                    } else {
                        snippetStr = `${blockStart}\n${leadingSpaces}\t$0\n${leadingSpaces}${blockEnd}`;
                    }

                    const snippet = new vscode.SnippetString(snippetStr);
                    setTimeout(() => { editor.insertSnippet(snippet, replaceRange); }, 10);
                    return;
                }
            }
        }

        if (change.text === ' ' || change.text === '.' || change.text === '\n' || change.text === '\r\n' || change.text === '(' || change.text === ',') {
            const document = event.document;

            const lineToAnalyze = change.range.start.line;

            const line = document.lineAt(lineToAnalyze).text;
            const textBeforeTrigger = line.substring(0, change.range.start.character);
            const matchResult = textBeforeTrigger.match(/([a-zA-Z0-9_]+)$/);

            if (matchResult) {
                const lastWord = matchResult[1];
                const lowerLastWord = lastWord.toLowerCase();

                const docText = document.getText();
                const varRegex = /Dim\s+([a-zA-Z0-9_]+)\s*(?:As\s+\w+\s*)?=\s*API\.Input\.Find/gi;
                let varMatch;
                const localKeywords = { ...dynamicKeywords };
                while ((varMatch = varRegex.exec(docText)) !== null) {
                    localKeywords[varMatch[1].toLowerCase()] = varMatch[1];
                }

                if (localKeywords[lowerLastWord] && lastWord !== localKeywords[lowerLastWord]) {
                    const wordStart = change.range.start.character - lastWord.length;
                    const replaceRange = new vscode.Range(
                        new vscode.Position(lineToAnalyze, wordStart),
                        new vscode.Position(lineToAnalyze, change.range.start.character)
                    );

                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(document.uri, replaceRange, localKeywords[lowerLastWord]);

                    vscode.workspace.applyEdit(edit).then(() => {
                        if (change.text === '.') {
                            setTimeout(() => {
                                vscode.commands.executeCommand('editor.action.triggerSuggest');
                            }, 50);
                        }
                    });
                }
            }
        }
    });

    const signatureProvider = getSignatureProvider();

    // ==========================================
    // DIAGNÓSTICOS
    // ==========================================

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('vmix');

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => updateDiagnostics(event.document, diagnosticCollection))
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                updateDiagnostics(editor.document, diagnosticCollection);
            }
        })
    );

    if (vscode.window.activeTextEditor) {
        updateDiagnostics(vscode.window.activeTextEditor.document, diagnosticCollection);
    }

    context.subscriptions.push(provider, formatListener, signatureProvider, diagnosticCollection);
}

export function deactivate() {}