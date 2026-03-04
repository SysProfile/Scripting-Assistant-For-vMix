import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip = require('adm-zip');
import * as xml2js from 'xml2js';
import { setInputsList, setObjectsList } from './globals';
import { ProjectStats, VMixItem, VMixScript } from './types';

export function readProjectXml(projectPath: string): string {
    let xmlString = '';
    const lowerPath = projectPath.toLowerCase();

    if (lowerPath.endsWith('.gtzip')) {
        const zip = new AdmZip(projectPath);
        const zipEntries = zip.getEntries();
        const xmlEntry = zipEntries.find((entry: AdmZip.IZipEntry) =>
            entry.entryName.toLowerCase() === 'document.xml'
        );
        if (xmlEntry) {
            xmlString = zip.readAsText(xmlEntry);
        }
    }
    else if (lowerPath.endsWith('.vmix')) {
        xmlString = fs.readFileSync(projectPath, 'utf8');
    }

    return xmlString;
}

// ==========================================
// EXTRACCIÓN DE OBJETOS DESDE COMPOSICIÓN GT
// ==========================================

function extractObjectsFromComposition(obj: any, parentInputSanitized: string, objects: VMixItem[]): void {
    if (!obj || typeof obj !== 'object') { return; }

    if (Array.isArray(obj)) {
        obj.forEach(item => extractObjectsFromComposition(item, parentInputSanitized, objects));
        return;
    }

    if (obj.TextBlock) {
        const blocks = Array.isArray(obj.TextBlock) ? obj.TextBlock : [obj.TextBlock];
        blocks.forEach((block: any) => {
            if (block.$ && block.$.Name) {
                const name = block.$.Name;
                objects.push({
                    sanitized: name.replace(/[^a-zA-Z0-9]/g, '_'),
                    original: `${name}.Text`,
                    objectKind: 'text',
                    parentInput: parentInputSanitized
                });
            }
        });
    }

    if (obj.Image) {
        const images = Array.isArray(obj.Image) ? obj.Image : [obj.Image];
        images.forEach((img: any) => {
            if (img.$ && img.$.Name) {
                const name = img.$.Name;
                objects.push({
                    sanitized: name.replace(/[^a-zA-Z0-9]/g, '_'),
                    original: `${name}.Source`,
                    objectKind: 'image',
                    parentInput: parentInputSanitized
                });
            }
        });
    }

    for (const key in obj) {
        if (key === '$' || key === '_' || key === 'TextBlock' || key === 'Image') { continue; }
        extractObjectsFromComposition(obj[key], parentInputSanitized, objects);
    }
}

// ==========================================
// LECTURA DE OBJETOS DESDE .GTZIP REFERENCIADO
// ==========================================

function extractObjectsFromGtzip(gtzipPath: string, parentInputSanitized: string, objects: VMixItem[]): void {
    try {
        if (!fs.existsSync(gtzipPath)) { return; }

        const zip = new AdmZip(gtzipPath);
        const docEntry = zip.getEntries().find((e: AdmZip.IZipEntry) =>
            e.entryName.toLowerCase() === 'document.xml'
        );
        if (!docEntry) { return; }

        const xmlContent = zip.readAsText(docEntry);

        xml2js.parseString(xmlContent, (err: any, result: any) => {
            if (err || !result) { return; }
            extractObjectsFromComposition(result, parentInputSanitized, objects);
        });
    } catch (e: any) {
        console.warn(`Could not read .gtzip: ${gtzipPath}`, e.message || e);
    }
}

// ==========================================
// CARGA DE DATOS DEL PROYECTO
// ==========================================

export function loadVMixProjectData(): ProjectStats {
    let newInputsList: VMixItem[] = [];
    let newObjectsList: VMixItem[] = [];

    const config = vscode.workspace.getConfiguration('vmixScripting');
    const projectPath = config.get<string>('projectPath') || '';

    if (!projectPath) {
        setInputsList([]);
        setObjectsList([]);
        return { inputCount: 0, objectCount: 0, fileName: '', success: false, errorMessage: 'no-path' };
    }

    if (!fs.existsSync(projectPath)) {
        setInputsList([]);
        setObjectsList([]);
        return { inputCount: 0, objectCount: 0, fileName: path.basename(projectPath), success: false, errorMessage: 'not-found' };
    }

    const fileName = path.basename(projectPath);
    const projectDir = path.dirname(projectPath);

    try {
        const xmlString = readProjectXml(projectPath);

        if (!xmlString) {
            setInputsList([]);
            setObjectsList([]);
            return { inputCount: 0, objectCount: 0, fileName, success: false, errorMessage: 'empty-xml' };
        }

        xml2js.parseString(xmlString, (err: any, result: any) => {
            if (!err && result) {

                // ---- Estructura de proyecto .vmix: <XML><Input>... ----
                if (result.XML && result.XML.Input) {
                    result.XML.Input.forEach((input: any) => {
                        let inputName = '';
                        let inputType = 0;

                        if (input.$ && input.$.Title) {
                            inputName = input.$.Title;
                        } else if (input.$ && input.$.Name) {
                            inputName = input.$.Name;
                        }

                        if (input.$ && input.$.Type) {
                            inputType = parseInt(input.$.Type, 10) || 0;
                        }

                        if (!inputName) { return; }

                        const sanitizedInput = inputName.replace(/[^a-zA-Z0-9]/g, '_');

                        newInputsList.push({
                            sanitized: sanitizedInput,
                            original: inputName,
                            inputType
                        });

                        // Para inputs GT Title (Type 9000): leer el .gtzip y extraer objetos
                        if (inputType === 9000) {
                            const gtzipAbsPath = input._ ? String(input._).trim() : '';

                            if (gtzipAbsPath) {
                                if (fs.existsSync(gtzipAbsPath)) {
                                    extractObjectsFromGtzip(gtzipAbsPath, sanitizedInput, newObjectsList);
                                } else {
                                    // Fallback: buscar por OriginalTitle en el directorio del proyecto
                                    const origTitle = (input.$ && input.$.OriginalTitle) ? input.$.OriginalTitle : '';
                                    if (origTitle) {
                                        const localPath = path.join(projectDir, origTitle);
                                        if (fs.existsSync(localPath)) {
                                            extractObjectsFromGtzip(localPath, sanitizedInput, newObjectsList);
                                        }
                                    }
                                }
                            }
                        }
                    });
                }
                // ---- Estructura de GT Title .gtzip standalone: <Composition>... ----
                else if (result.Composition) {
                    extractObjectsFromComposition(result, '', newObjectsList);
                }
                else {
                    const extractNames = (obj: any) => {
                        if (typeof obj === 'object' && obj !== null) {
                            for (const key in obj) {
                                if (key === '$' && obj[key].Name) {
                                    newObjectsList.push({
                                        sanitized: obj[key].Name.replace(/[^a-zA-Z0-9]/g, '_'),
                                        original: obj[key].Name
                                    });
                                } else {
                                    extractNames(obj[key]);
                                }
                            }
                        }
                    };
                    extractNames(result);
                }

                newInputsList = newInputsList.filter((v, i, a) => a.findIndex(item => (item.sanitized === v.sanitized)) === i);
                newObjectsList = newObjectsList.filter((v, i, a) => a.findIndex(item => (item.sanitized === v.sanitized && item.parentInput === v.parentInput)) === i);
            }
        });

        setInputsList(newInputsList);
        setObjectsList(newObjectsList);
        return { inputCount: newInputsList.length, objectCount: newObjectsList.length, fileName, success: true };

    } catch (e: any) {
        console.error('Error parsing vMix project', e);
        setInputsList([]);
        setObjectsList([]);
        return { inputCount: 0, objectCount: 0, fileName, success: false, errorMessage: e.message || 'unknown' };
    }
}

export function loadScriptsFromProject(): VMixScript[] {
    const scripts: VMixScript[] = [];

    const config = vscode.workspace.getConfiguration('vmixScripting');
    const projectPath = config.get<string>('projectPath') || '';

    if (!projectPath || !fs.existsSync(projectPath)) {
        return scripts;
    }

    try {
        const xmlString = readProjectXml(projectPath);
        if (!xmlString) { return scripts; }

        xml2js.parseString(xmlString, (err: any, result: any) => {
            if (err || !result) { return; }

            const findScripts = (obj: any): void => {
                if (!obj || typeof obj !== 'object') { return; }

                if (Array.isArray(obj)) {
                    obj.forEach(item => findScripts(item));
                    return;
                }

                if (obj.Script) {
                    const scriptNodes = Array.isArray(obj.Script) ? obj.Script : [obj.Script];
                    scriptNodes.forEach((script: any) => {
                        const name = Array.isArray(script.Name) ? script.Name[0] : (script.Name || '');
                        const code = Array.isArray(script.Code) ? script.Code[0] : (script.Code || '');
                        if (name && code) {
                            scripts.push({ name, code });
                        }
                    });
                }

                for (const key in obj) {
                    if (key !== 'Script') {
                        findScripts(obj[key]);
                    }
                }
            };

            findScripts(result);
        });
    } catch (e: any) {
        console.error('Error loading scripts from project', e);
    }

    return scripts;
}

// ==========================================
// BACKUP DEL PROYECTO
// ==========================================

export function createProjectBackup(): string | null {
    const config = vscode.workspace.getConfiguration('vmixScripting');
    const projectPath = config.get<string>('projectPath') || '';

    if (!projectPath || !fs.existsSync(projectPath)) {
        return null;
    }

    const dir = path.dirname(projectPath);
    const ext = path.extname(projectPath);
    const base = path.basename(projectPath, ext);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const backupName = `${base} backup ${timestamp}${ext}`;
    const backupPath = path.join(dir, backupName);

    try {
        fs.copyFileSync(projectPath, backupPath);
        return backupName;
    } catch (e: any) {
        console.error('Error creating project backup', e);
        return null;
    }
}

// ==========================================
// ACTUALIZACIÓN DE SCRIPT EN EL PROYECTO
// ==========================================

function findAndUpdateScript(obj: any, scriptName: string, code: string): boolean {
    if (!obj || typeof obj !== 'object') { return false; }

    if (Array.isArray(obj)) {
        for (const item of obj) {
            if (findAndUpdateScript(item, scriptName, code)) { return true; }
        }
        return false;
    }

    if (obj.Script) {
        const scripts = Array.isArray(obj.Script) ? obj.Script : [obj.Script];
        for (const script of scripts) {
            const name = Array.isArray(script.Name) ? script.Name[0] : (script.Name || '');
            if (name.toLowerCase() === scriptName.toLowerCase()) {
                if (Array.isArray(script.Code)) {
                    script.Code[0] = code;
                } else {
                    script.Code = [code];
                }
                return true;
            }
        }
    }

    for (const key in obj) {
        if (key !== 'Script') {
            if (findAndUpdateScript(obj[key], scriptName, code)) { return true; }
        }
    }

    return false;
}

function findScriptsContainer(obj: any): any {
    if (!obj || typeof obj !== 'object') { return null; }

    if (Array.isArray(obj)) {
        for (const item of obj) {
            const found = findScriptsContainer(item);
            if (found) { return found; }
        }
        return null;
    }

    if (obj.Script) { return obj; }

    for (const key in obj) {
        const found = findScriptsContainer(obj[key]);
        if (found) { return found; }
    }

    return null;
}

export function updateScriptInProject(scriptName: string, code: string): { success: boolean; added: boolean; errorKey?: string } {
    const config = vscode.workspace.getConfiguration('vmixScripting');
    const projectPath = config.get<string>('projectPath') || '';

    if (!projectPath || !fs.existsSync(projectPath)) {
        return { success: false, added: false, errorKey: 'import.noProject' };
    }

    try {
        const xmlString = fs.readFileSync(projectPath, 'utf8');

        const xmlDeclMatch = xmlString.match(/^(<\?xml[^?]*\?>\s*)/);
        let parsedResult: any = null;

        xml2js.parseString(xmlString, (err: any, result: any) => {
            if (!err) { parsedResult = result; }
        });

        if (!parsedResult) {
            return { success: false, added: false, errorKey: 'project.parseError' };
        }

        const replaced = findAndUpdateScript(parsedResult, scriptName, code);
        let added = false;

        if (!replaced) {
            let container = findScriptsContainer(parsedResult);

            if (!container) {
                if (parsedResult.XML) {
                    if (!parsedResult.XML.Scripts) {
                        parsedResult.XML.Scripts = [{}];
                    }
                    container = Array.isArray(parsedResult.XML.Scripts) ? parsedResult.XML.Scripts[0] : parsedResult.XML.Scripts;
                }
            }

            if (container) {
                if (!container.Script) {
                    container.Script = [];
                }
                if (!Array.isArray(container.Script)) {
                    container.Script = [container.Script];
                }
                container.Script.push({
                    Name: [scriptName],
                    Code: [code]
                });
                added = true;
            } else {
                return { success: false, added: false, errorKey: 'project.parseError' };
            }
        }

        const builder = new xml2js.Builder({
            headless: true,
            renderOpts: { pretty: true, indent: '  ', newline: '\r\n' }
        });
        let newXml = builder.buildObject(parsedResult);

        if (xmlDeclMatch) {
            newXml = xmlDeclMatch[1].trimEnd() + '\r\n' + newXml;
        }

        fs.writeFileSync(projectPath, newXml, 'utf8');

        return { success: true, added };

    } catch (e: any) {
        console.error('Error updating script in project', e);
        return { success: false, added: false, errorKey: 'project.parseError' };
    }
}