import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { initI18n, t } from './i18n';
import {
    setVMixFunctions,
    setVMixRanges,
    setDynamicKeywords,
    inputsList,
    objectsList
} from './globals';
import { getCompletionProvider } from './completion';
import { getSignatureProvider } from './signature';
import { updateDiagnostics } from './diagnostics';
import { exportApiCalls, importApiCalls, importReplaceStringsWithContext } from './transpiler';
import { loadVMixProjectData, loadScriptsFromProject, updateScriptInProject } from './project';
import { getHoverProvider } from './hover';
import { getFoldingProvider } from './folding';
import { getSymbolProvider } from './symbols';
import { getDefinitionProvider } from './definition';
import { getCodeActionProvider } from './codeActions';
import { getStaticSnippetProvider, getDynamicSnippetProvider } from './snippets';
import { isVmixRunning, startScript, getCurrentState } from './vmixApi';
import { startWatching, stopWatching, registerWatcherDisposable, createDebouncer } from './watcher';

let statusBarItem: vscode.StatusBarItem;
let diagnosticCollection: vscode.DiagnosticCollection;
const diagDebouncer = createDebouncer(250);

// ==========================================
// CONSTRUCCIÓN DE DYNAMIC KEYWORDS
// ==========================================
function buildDynamicKeywords(functionsData: any[]): { [key: string]: string } {
    const keywords: { [key: string]: string } = {};

    keywords['api'] = 'API';
    keywords['inputslist'] = 'InputsList';
    keywords['objectslist'] = 'ObjectsList';
    keywords['datasource'] = 'DataSource';
    keywords['input'] = 'Input';
    keywords['shortcut'] = 'Shortcut';
    keywords['find'] = 'Find';
    keywords['value'] = 'Value';

    const cats = new Set<string>();
    const funcs = new Set<string>();

    functionsData.forEach(f => {
        cats.add(f.category);
        funcs.add(f.function);
    });

    cats.forEach(c => { keywords[c.toLowerCase()] = c; });
    funcs.forEach(f => { keywords[f.toLowerCase()] = f; });

    inputsList.forEach(i => { keywords[i.sanitized.toLowerCase()] = i.sanitized; });
    objectsList.forEach(o => { keywords[o.sanitized.toLowerCase()] = o.sanitized; });

    return keywords;
}

// ==========================================
// CARGA DE vMix.json + integridad (con warning)
// ==========================================
async function correctVMixJsonIntegrity(extensionPath: string): Promise<any[]> {
    const jsonPath = path.join(extensionPath, 'vMix.json');
    try {
        const raw = await fs.promises.readFile(jsonPath, 'utf-8');
        let parsed = JSON.parse(raw);

        if (!Array.isArray(parsed)) {
            const out: any[] = [];
            for (const [category, items] of Object.entries<any>(parsed)) {
                if (Array.isArray(items)) {
                    for (const item of items) {
                        out.push({ category, ...item });
                    }
                } else if (typeof items === 'object') {
                    for (const [funcName, def] of Object.entries<any>(items)) {
                        out.push({ category, function: funcName, ...def });
                    }
                }
            }
            parsed = out;
        }

        return parsed;
    } catch (e: any) {
        vscode.window.showWarningMessage(`${t('error.loadJson')} (${e?.message || 'unknown'})`);
        return [];
    }
}

// ==========================================
// STATUS BAR
// ==========================================
function refreshStatusBar(): void {
    const config = vscode.workspace.getConfiguration('vmixScripting');
    const projectPath = config.get<string>('projectPath') || '';

    if (projectPath && fs.existsSync(projectPath)) {
        const fileName = path.basename(projectPath);
        statusBarItem.text = t('statusBar.linked', fileName, inputsList.length);
    } else {
        statusBarItem.text = t('statusBar.notLinked');
    }
    statusBarItem.tooltip = t('statusBar.tooltip');
    statusBarItem.command = 'vmixScripting.showMenu';
    statusBarItem.show();
}

// ==========================================
// HOT RELOAD
// ==========================================
async function setupProjectWatcher(): Promise<void> {
    const config = vscode.workspace.getConfiguration('vmixScripting');
    const projectPath = config.get<string>('projectPath') || '';
    const enabled = config.get<boolean>('enableHotReload', true);

    stopWatching();

    if (!enabled || !projectPath || !fs.existsSync(projectPath)) { return; }

    startWatching(projectPath, async () => {
        const stats = await loadVMixProjectData(projectPath);
        if (stats) {
            const allFuncs = (await correctVMixJsonIntegrity(extContext.extensionPath));
            setDynamicKeywords(buildDynamicKeywords(allFuncs));
            refreshStatusBar();
            vscode.window.setStatusBarMessage(t('project.changed'), 3000);
        }
    });
}

// ==========================================
// COMANDOS
// ==========================================
let extContext: vscode.ExtensionContext;

async function cmdOpenProject(): Promise<void> {
    const result = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: t('dialog.openProject.label'),
        filters: { [t('dialog.openProject.filter')]: ['vmix'] }
    });

    if (!result || result.length === 0) { return; }

    const selected = result[0].fsPath;
    const config = vscode.workspace.getConfiguration('vmixScripting');
    await config.update('projectPath', selected, vscode.ConfigurationTarget.Global);

    const stats = await loadVMixProjectData(selected);
    if (stats) {
        const allFuncs = await correctVMixJsonIntegrity(extContext.extensionPath);
        setDynamicKeywords(buildDynamicKeywords(allFuncs));
        vscode.window.showInformationMessage(t('project.loaded', path.basename(selected), stats.inputs, stats.objects));
    }

    refreshStatusBar();
    setupProjectWatcher();
}

async function cmdExportScript(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage(t('error.noEditor'));
        return;
    }

    const sourceText = editor.document.getText();
    const lines = sourceText.split(/\r?\n/);

    if (lines.length === 0 || !lines[0].trimStart().startsWith("'")) {
        vscode.window.showErrorMessage(t('export.noScriptName'));
        return;
    }

    const scriptName = lines[0].replace(/^'+/, '').trim();

    const { result: stage1, unknownFunctions } = exportApiCalls(sourceText);

    let exported = stage1;
    inputsList.forEach(i => {
        const re = new RegExp(`InputsList\\.${i.sanitized}`, 'g');
        exported = exported.replace(re, `"${i.original}"`);
    });
    objectsList.forEach(o => {
        const re = new RegExp(`ObjectsList\\.${o.sanitized}`, 'g');
        exported = exported.replace(re, `"${o.original}"`);
    });

    await vscode.env.clipboard.writeText(exported);

    if (unknownFunctions.length > 0) {
        vscode.window.showWarningMessage(t('export.unknownFunctions', unknownFunctions.length, unknownFunctions.join(', ')));
    } else {
        vscode.window.showInformationMessage(t('export.success'));
    }

    const config = vscode.workspace.getConfiguration('vmixScripting');
    const projectPath = config.get<string>('projectPath') || '';
    if (projectPath && fs.existsSync(projectPath)) {
        const choice = await vscode.window.showInformationMessage(
            t('export.askUpdateProject', scriptName),
            t('export.optYes'),
            t('export.optNo')
        );
        if (choice === t('export.optYes')) {
            const result = await updateScriptInProject(projectPath, scriptName, exported);
            if (!result.ok) {
                if (result.error === 'backup-failed') {
                    vscode.window.showErrorMessage(t('export.backupError'));
                } else {
                    vscode.window.showErrorMessage(`Error: ${result.error}`);
                }
            } else {
                if (result.backupPath) {
                    vscode.window.showInformationMessage(t('export.backupCreated', path.basename(result.backupPath)));
                }
                if (result.replaced) {
                    vscode.window.showInformationMessage(t('export.projectUpdated', scriptName));
                } else {
                    vscode.window.showInformationMessage(t('export.projectAdded', scriptName));
                }
            }
        }
    }
}

async function cmdImportScript(): Promise<void> {
    const config = vscode.workspace.getConfiguration('vmixScripting');
    const projectPath = config.get<string>('projectPath') || '';

    if (!projectPath || !fs.existsSync(projectPath)) {
        vscode.window.showWarningMessage(t('import.noProject'));
        return;
    }

    const scripts = await loadScriptsFromProject(projectPath);
    if (scripts.length === 0) {
        vscode.window.showWarningMessage(t('import.noScripts'));
        return;
    }

    const items = scripts.map(s => ({
        label: s.name,
        detail: `${s.lines} ${t('import.linesDetail')}`,
        script: s
    }));

    const picked = await vscode.window.showQuickPick(items, { placeHolder: t('import.selectScript') });
    if (!picked) { return; }

    const transpiled = transpileImported(picked.script.content, picked.script.name);

    const doc = await vscode.workspace.openTextDocument({ language: 'vmix', content: transpiled });
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(t('import.success'));
}

function transpileImported(content: string, scriptName: string): string {
    let result = content;
    if (!result.split(/\r?\n/)[0]?.trimStart().startsWith("'")) {
        result = `'${scriptName}\n` + result;
    }
    result = importApiCalls(result);
    result = importReplaceStringsWithContext(result);
    return result;
}

async function cmdRunScript(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage(t('error.noEditor'));
        return;
    }
    const lines = editor.document.getText().split(/\r?\n/);
    if (!lines[0]?.trimStart().startsWith("'")) {
        vscode.window.showErrorMessage(t('export.noScriptName'));
        return;
    }
    const scriptName = lines[0].replace(/^'+/, '').trim();

    const config = vscode.workspace.getConfiguration('vmixScripting');
    const apiUrl = config.get<string>('apiUrl') || 'http://localhost:8088';

    if (!(await isVmixRunning())) {
        vscode.window.showErrorMessage(t('vmixApi.notRunning', apiUrl));
        return;
    }

    const result = await startScript(scriptName);
    if (result.success) {
        vscode.window.showInformationMessage(t('vmixApi.scriptStarted', scriptName));
    } else {
        vscode.window.showErrorMessage(t('vmixApi.scriptError', scriptName, result.error || 'unknown'));
    }
}

async function cmdRefreshFromVmix(): Promise<void> {
    const config = vscode.workspace.getConfiguration('vmixScripting');
    const apiUrl = config.get<string>('apiUrl') || 'http://localhost:8088';

    if (!(await isVmixRunning())) {
        vscode.window.showErrorMessage(t('vmixApi.notRunning', apiUrl));
        return;
    }

    const state = await getCurrentState();
    if (!state.success || !state.body) {
        vscode.window.showErrorMessage(t('vmixApi.refreshFailed', state.error || 'unknown'));
        return;
    }

    try {
        const xml2js = require('xml2js');
        const parsed = await xml2js.parseStringPromise(state.body, { explicitArray: true });
        const inputsCount = parsed?.vmix?.inputs?.[0]?.input?.length || 0;
        vscode.window.showInformationMessage(t('vmixApi.refreshSuccess', inputsCount));
    } catch (e: any) {
        vscode.window.showErrorMessage(t('vmixApi.refreshFailed', e?.message || 'parse-failed'));
    }
}

async function cmdVerifyRoundTrip(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage(t('error.noEditor'));
        return;
    }

    const original = editor.document.getText();
    const lines = original.split(/\r?\n/);
    if (!lines[0]?.trimStart().startsWith("'")) {
        vscode.window.showErrorMessage(t('export.noScriptName'));
        return;
    }
    const scriptName = lines[0].replace(/^'+/, '').trim();

    const { result: stage1 } = exportApiCalls(original);
    let exported = stage1;
    inputsList.forEach(i => {
        const re = new RegExp(`InputsList\\.${i.sanitized}`, 'g');
        exported = exported.replace(re, `"${i.original}"`);
    });
    objectsList.forEach(o => {
        const re = new RegExp(`ObjectsList\\.${o.sanitized}`, 'g');
        exported = exported.replace(re, `"${o.original}"`);
    });

    const reimported = transpileImported(exported, scriptName);

    if (reimported.trim() === original.trim()) {
        vscode.window.showInformationMessage(t('roundTrip.success'));
        return;
    }

    const tmpDir = require('os').tmpdir();
    const origPath = path.join(tmpDir, `vmix_orig_${Date.now()}.vmixscript`);
    const newPath = path.join(tmpDir, `vmix_roundtrip_${Date.now()}.vmixscript`);
    await fs.promises.writeFile(origPath, original, 'utf-8');
    await fs.promises.writeFile(newPath, reimported, 'utf-8');

    await vscode.commands.executeCommand(
        'vscode.diff',
        vscode.Uri.file(origPath),
        vscode.Uri.file(newPath),
        'Round-trip diff'
    );

    vscode.window.showWarningMessage(t('roundTrip.diff'));
}

async function cmdExportStandalone(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage(t('error.noEditor'));
        return;
    }

    const sourceText = editor.document.getText();
    const lines = sourceText.split(/\r?\n/);
    if (!lines[0]?.trimStart().startsWith("'")) {
        vscode.window.showErrorMessage(t('export.noScriptName'));
        return;
    }

    const { result: stage1 } = exportApiCalls(sourceText);
    let exported = stage1;
    inputsList.forEach(i => {
        const re = new RegExp(`InputsList\\.${i.sanitized}`, 'g');
        exported = exported.replace(re, `"${i.original}"`);
    });
    objectsList.forEach(o => {
        const re = new RegExp(`ObjectsList\\.${o.sanitized}`, 'g');
        exported = exported.replace(re, `"${o.original}"`);
    });

    const target = await vscode.window.showSaveDialog({
        saveLabel: t('export.standaloneAsk'),
        filters: { 'VB.NET': ['vb'] }
    });

    if (!target) { return; }

    await fs.promises.writeFile(target.fsPath, exported, 'utf-8');
    vscode.window.showInformationMessage(t('export.standaloneSuccess', target.fsPath));
}

const TEMPLATES: { [key: string]: { label: string; body: string } } = {
    lowerThird: {
        label: 'template.lowerThird',
        body: `'Lower_Third
API.Title.SetText(InputsList.MyTitle, ObjectsList.Headline, "Title text here")
API.Title.SetText(InputsList.MyTitle, ObjectsList.Subtitle, "Subtitle text here")
API.Function("OverlayInput1In", Input:="MyTitle")
API.Function("Wait", Value:="5000")
API.Function("OverlayInput1Out")
`
    },
    cycleInputs: {
        label: 'template.cycleInputs',
        body: `'Cycle_Inputs
Dim inputs As String = "Camera1,Camera2,Camera3"
Dim arr() As String = inputs.Split(",")
For Each name As String In arr
    API.Function("ActiveInput", Input:=name)
    API.Function("Wait", Value:="5000")
Next
`
    },
    toggleAudio: {
        label: 'template.toggleAudio',
        body: `'Toggle_Audio_Bus
API.Function("BusXAudioToggle", Value:="A")
API.Function("Wait", Value:="500")
`
    },
    tallyReact: {
        label: 'template.tallyReact',
        body: `'Tally_React
Dim cam = API.Input.Find("Camera1")
If cam.State = "Running" Then
    API.Function("OverlayInput1In", Input:="LiveBadge")
Else
    API.Function("OverlayInput1Out")
End If
`
    }
};

async function cmdNewFromTemplate(): Promise<void> {
    const items = Object.entries(TEMPLATES).map(([key, tpl]) => ({
        label: t(tpl.label),
        key
    }));

    const picked = await vscode.window.showQuickPick(items, { placeHolder: t('template.selectPlaceholder') });
    if (!picked) { return; }

    const tpl = TEMPLATES[picked.key];
    const doc = await vscode.workspace.openTextDocument({ language: 'vmix', content: tpl.body });
    await vscode.window.showTextDocument(doc);
}

async function cmdInstallKeymap(): Promise<void> {
    vscode.window.showInformationMessage(t('keymap.installing'));
    try {
        await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode.vs-keybindings');
        vscode.window.showInformationMessage(t('keymap.success'));
    } catch {
        vscode.window.showErrorMessage(t('keymap.error'));
    }
}

async function cmdShowMenu(): Promise<void> {
    const items: vscode.QuickPickItem[] = [
        { label: t('menu.export.label'), detail: t('menu.export.detail') },
        { label: t('menu.import.label'), detail: t('menu.import.detail') },
        { label: t('menu.runScript.label'), detail: t('menu.runScript.detail') },
        { label: t('menu.refreshFromVmix.label'), detail: t('menu.refreshFromVmix.detail') },
        { label: t('menu.verifyRoundTrip.label'), detail: t('menu.verifyRoundTrip.detail') },
        { label: t('menu.exportStandalone.label'), detail: t('menu.exportStandalone.detail') },
        { label: t('menu.newFromTemplate.label'), detail: t('menu.newFromTemplate.detail') },
        { label: t('menu.openProject.label'), detail: t('menu.openProject.detail') },
        { label: t('menu.settings.label'), detail: t('menu.settings.detail') },
        { label: t('menu.keymap.label'), detail: t('menu.keymap.detail') }
    ];

    const picked = await vscode.window.showQuickPick(items, { placeHolder: t('menu.selectAction') });
    if (!picked) { return; }

    if (picked.label === t('menu.export.label')) { return cmdExportScript(); }
    if (picked.label === t('menu.import.label')) { return cmdImportScript(); }
    if (picked.label === t('menu.runScript.label')) { return cmdRunScript(); }
    if (picked.label === t('menu.refreshFromVmix.label')) { return cmdRefreshFromVmix(); }
    if (picked.label === t('menu.verifyRoundTrip.label')) { return cmdVerifyRoundTrip(); }
    if (picked.label === t('menu.exportStandalone.label')) { return cmdExportStandalone(); }
    if (picked.label === t('menu.newFromTemplate.label')) { return cmdNewFromTemplate(); }
    if (picked.label === t('menu.openProject.label')) { return cmdOpenProject(); }
    if (picked.label === t('menu.settings.label')) {
        return vscode.commands.executeCommand('workbench.action.openSettings', 'vmixScripting') as any;
    }
    if (picked.label === t('menu.keymap.label')) { return cmdInstallKeymap(); }
}

// ==========================================
// ACTIVATE
// ==========================================
export async function activate(context: vscode.ExtensionContext) {
    extContext = context;

    initI18n(context.extensionPath, vscode.env.language);

    // Cargar funciones desde vMix.json
    const allFuncs = await correctVMixJsonIntegrity(context.extensionPath);
    setVMixFunctions(allFuncs);

    // Cargar rangos desde vMixValuesRange.json
    try {
        const rangesPath = path.join(context.extensionPath, 'vMixValuesRange.json');
        if (fs.existsSync(rangesPath)) {
            const rangesRaw = await fs.promises.readFile(rangesPath, 'utf-8');
            const rangesData = JSON.parse(rangesRaw);
            setVMixRanges(Array.isArray(rangesData) ? rangesData : []);
        }
    } catch (e: any) {
        vscode.window.showWarningMessage(`No se pudo cargar vMixValuesRange.json: ${e?.message || 'unknown'}`);
    }

    // Cargar proyecto vinculado si existe
    const config = vscode.workspace.getConfiguration('vmixScripting');
    const projectPath = config.get<string>('projectPath') || '';
    if (projectPath && fs.existsSync(projectPath)) {
        await loadVMixProjectData(projectPath);
    }

    setDynamicKeywords(buildDynamicKeywords(allFuncs));

    // Status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    refreshStatusBar();
    context.subscriptions.push(statusBarItem);

    // Diagnostics
    diagnosticCollection = vscode.languages.createDiagnosticCollection('vmix');
    context.subscriptions.push(diagnosticCollection);

    if (vscode.window.activeTextEditor) {
        updateDiagnostics(vscode.window.activeTextEditor.document, diagnosticCollection);
    }

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            diagDebouncer.run(() => updateDiagnostics(e.document, diagnosticCollection));
        }),
        vscode.workspace.onDidOpenTextDocument(doc => updateDiagnostics(doc, diagnosticCollection)),
        vscode.window.onDidChangeActiveTextEditor(ed => {
            if (ed) { updateDiagnostics(ed.document, diagnosticCollection); }
        })
    );

    // Providers
    context.subscriptions.push(
        getCompletionProvider(),
        getSignatureProvider(),
        getHoverProvider(),
        getFoldingProvider(),
        getSymbolProvider(),
        getDefinitionProvider(),
        getCodeActionProvider(),
        getStaticSnippetProvider(),
        getDynamicSnippetProvider()
    );

    // Comandos
    context.subscriptions.push(
        vscode.commands.registerCommand('vmixScripting.showMenu', cmdShowMenu),
        vscode.commands.registerCommand('vmixScripting.openProject', cmdOpenProject),
        vscode.commands.registerCommand('vmixScripting.openSettings', () =>
            vscode.commands.executeCommand('workbench.action.openSettings', 'vmixScripting')),
        vscode.commands.registerCommand('vmixScripting.installKeymap', cmdInstallKeymap),
        vscode.commands.registerCommand('vmixScripting.exportScript', cmdExportScript),
        vscode.commands.registerCommand('vmixScripting.importScript', cmdImportScript),
        vscode.commands.registerCommand('vmixScripting.runScript', cmdRunScript),
        vscode.commands.registerCommand('vmixScripting.refreshFromVmix', cmdRefreshFromVmix),
        vscode.commands.registerCommand('vmixScripting.verifyRoundTrip', cmdVerifyRoundTrip),
        vscode.commands.registerCommand('vmixScripting.exportStandalone', cmdExportStandalone),
        vscode.commands.registerCommand('vmixScripting.newFromTemplate', cmdNewFromTemplate)
    );

    // Configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('vmixScripting.projectPath') ||
                e.affectsConfiguration('vmixScripting.enableHotReload')) {
                const newPath = vscode.workspace.getConfiguration('vmixScripting').get<string>('projectPath') || '';
                if (newPath && fs.existsSync(newPath)) {
                    loadVMixProjectData(newPath).then(() => {
                        setDynamicKeywords(buildDynamicKeywords(allFuncs));
                        refreshStatusBar();
                        setupProjectWatcher();
                    });
                } else {
                    refreshStatusBar();
                    setupProjectWatcher();
                }
            }
        })
    );

    // Iniciar watcher
    setupProjectWatcher();
    registerWatcherDisposable(context);
}

export function deactivate() {
    stopWatching();
    diagDebouncer.cancel();
}