import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';
import { setInputsList, setObjectsList } from './globals';
import { VMixItem } from './types';
import { t } from './i18n';

function sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

function getInputType(input: any): number {
    if (!input.$) { return 0; }
    const type = parseInt(input.$.Type, 10);
    return isNaN(type) ? 0 : type;
}

export async function readProjectXml(filePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf-8', async (err, data) => {
            if (err) { return reject(err); }
            if (!data || !data.trim()) { return reject(new Error('empty')); }
            try {
                const parsed = await xml2js.parseStringPromise(data, { explicitArray: true, mergeAttrs: false });
                resolve(parsed);
            } catch (e) {
                reject(e);
            }
        });
    });
}

export async function loadVMixProjectData(projectPath: string): Promise<{ inputs: number; objects: number } | null> {
    if (!projectPath) {
        setInputsList([]);
        setObjectsList([]);
        return null;
    }

    if (!fs.existsSync(projectPath)) {
        vscode.window.showWarningMessage(t('project.notFound', projectPath));
        setInputsList([]);
        setObjectsList([]);
        return null;
    }

    let parsed: any;
    try {
        parsed = await readProjectXml(projectPath);
    } catch (e: any) {
        if (e?.message === 'empty') {
            vscode.window.showWarningMessage(t('project.emptyXml', projectPath));
        } else {
            vscode.window.showWarningMessage(t('project.parseError', projectPath));
        }
        setInputsList([]);
        setObjectsList([]);
        return null;
    }

    const inputs: VMixItem[] = [];
    const objects: VMixItem[] = [];

    const root = parsed?.vmix || parsed?.VMix || parsed?.VMIX;
    if (!root) {
        setInputsList([]);
        setObjectsList([]);
        return { inputs: 0, objects: 0 };
    }

    const inputsRoot = root.inputs?.[0]?.input || root.Inputs?.[0]?.Input || [];
    const seenSanitized = new Set<string>();

    for (const inp of inputsRoot) {
        const original = inp.$?.Title || inp.$?.title || '';
        if (!original) { continue; }
        let sanitized = sanitizeName(original);
        let counter = 1;
        const baseSanitized = sanitized;
        while (seenSanitized.has(sanitized.toLowerCase())) {
            sanitized = `${baseSanitized}_${counter++}`;
        }
        seenSanitized.add(sanitized.toLowerCase());

        const inputType = getInputType(inp);
        inputs.push({ original, sanitized, inputType });

        if (inputType === 9000 && inp.text) {
            const seenObjSan = new Set<string>();
            for (const txt of inp.text) {
                const objName = txt.$?.Name || txt.$?.name;
                if (!objName) { continue; }
                let objSan = sanitizeName(objName);
                let oc = 1;
                const objBase = objSan;
                while (seenObjSan.has(objSan.toLowerCase())) {
                    objSan = `${objBase}_${oc++}`;
                }
                seenObjSan.add(objSan.toLowerCase());

                let kind: 'text' | 'image' | undefined = undefined;
                const idx = parseInt(txt.$?.Index || '0', 10);
                if (idx >= 0 && idx < 200) { kind = 'text'; }
                else if (idx >= 200) { kind = 'image'; }
                if (objName.toLowerCase().includes('image') || objName.toLowerCase().includes('logo') || objName.toLowerCase().includes('img')) {
                    kind = 'image';
                }

                objects.push({
                    original: objName,
                    sanitized: objSan,
                    objectKind: kind,
                    parentInput: sanitized
                });
            }
        }
    }

    setInputsList(inputs);
    setObjectsList(objects);

    return { inputs: inputs.length, objects: objects.length };
}

export async function loadScriptsFromProject(projectPath: string): Promise<{ name: string; content: string; lines: number }[]> {
    if (!projectPath || !fs.existsSync(projectPath)) { return []; }

    let parsed: any;
    try {
        parsed = await readProjectXml(projectPath);
    } catch {
        return [];
    }

    const root = parsed?.vmix || parsed?.VMix || parsed?.VMIX;
    if (!root) { return []; }

    const scriptsNode = root.scripts?.[0]?.script || root.Scripts?.[0]?.Script || [];
    const out: { name: string; content: string; lines: number }[] = [];

    for (const sc of scriptsNode) {
        const name = sc.$?.Name || sc.$?.name || 'Untitled';
        const content = typeof sc === 'string' ? sc : (sc._ || '');
        out.push({ name, content, lines: content.split(/\r?\n/).length });
    }

    return out;
}

export async function createProjectBackup(projectPath: string): Promise<string | null> {
    try {
        const dir = path.dirname(projectPath);
        const base = path.basename(projectPath, '.vmix');
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(dir, `${base}.backup_${ts}.vmix`);
        await fs.promises.copyFile(projectPath, backupPath);
        return backupPath;
    } catch (e) {
        return null;
    }
}

// Atomic write: tmp + rename. Backup primero.
export async function updateScriptInProject(projectPath: string, scriptName: string, newContent: string): Promise<{ ok: boolean; replaced: boolean; backupPath: string | null; error?: string }> {
    if (!projectPath || !fs.existsSync(projectPath)) {
        return { ok: false, replaced: false, backupPath: null, error: 'not-found' };
    }

    const backupPath = await createProjectBackup(projectPath);
    if (!backupPath) {
        return { ok: false, replaced: false, backupPath: null, error: 'backup-failed' };
    }

    let parsed: any;
    try {
        parsed = await readProjectXml(projectPath);
    } catch {
        return { ok: false, replaced: false, backupPath, error: 'parse-failed' };
    }

    const root = parsed?.vmix || parsed?.VMix || parsed?.VMIX;
    if (!root) {
        return { ok: false, replaced: false, backupPath, error: 'no-root' };
    }

    if (!root.scripts) { root.scripts = [{}]; }
    if (!root.scripts[0]) { root.scripts[0] = {}; }
    if (!root.scripts[0].script) { root.scripts[0].script = []; }

    const scripts: any[] = root.scripts[0].script;
    let replaced = false;

    for (const sc of scripts) {
        const name = sc.$?.Name || sc.$?.name;
        if (name && name.toLowerCase() === scriptName.toLowerCase()) {
            sc._ = newContent;
            replaced = true;
            break;
        }
    }

    if (!replaced) {
        scripts.push({ _: newContent, $: { Name: scriptName } });
    }

    const builder = new xml2js.Builder({ headless: false, renderOpts: { pretty: true, indent: '  ', newline: '\n' } });
    const xml = builder.buildObject(parsed);

    // Escritura atómica
    const tmpPath = projectPath + '.tmp_' + Date.now();
    try {
        await fs.promises.writeFile(tmpPath, xml, 'utf-8');
        await fs.promises.rename(tmpPath, projectPath);
    } catch (e: any) {
        try { await fs.promises.unlink(tmpPath); } catch { /* noop */ }
        return { ok: false, replaced, backupPath, error: e?.message || 'write-failed' };
    }

    return { ok: true, replaced, backupPath };
}