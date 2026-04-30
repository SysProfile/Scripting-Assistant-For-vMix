// ==========================================
// CLIENTE HTTP PARA LA API DE vMix
// vMix expone API REST en http://localhost:8088/api/
// ==========================================

import * as http from 'http';
import * as vscode from 'vscode';

export interface VMixApiResult {
    success: boolean;
    body?: string;
    error?: string;
}

function getApiUrl(): string {
    const config = vscode.workspace.getConfiguration('vmixScripting');
    return config.get<string>('apiUrl') || 'http://localhost:8088';
}

function performRequest(url: string, timeoutMs: number = 3000): Promise<VMixApiResult> {
    return new Promise((resolve) => {
        try {
            const req = http.get(url, { timeout: timeoutMs }, (res) => {
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve({ success: true, body });
                    } else {
                        resolve({ success: false, error: `HTTP ${res.statusCode}` });
                    }
                });
            });
            req.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
            req.on('timeout', () => {
                req.destroy();
                resolve({ success: false, error: 'timeout' });
            });
        } catch (e: any) {
            resolve({ success: false, error: e.message || 'unknown' });
        }
    });
}

// Verifica si vMix está corriendo y respondiendo
export async function isVmixRunning(): Promise<boolean> {
    const url = `${getApiUrl()}/api/`;
    const result = await performRequest(url, 1500);
    return result.success;
}

// Ejecuta un script por nombre: ScriptStart
export async function startScript(scriptName: string): Promise<VMixApiResult> {
    const encoded = encodeURIComponent(scriptName);
    const url = `${getApiUrl()}/api/?Function=ScriptStart&Value=${encoded}`;
    return performRequest(url);
}

// Detiene un script en ejecución
export async function stopScript(scriptName: string): Promise<VMixApiResult> {
    const encoded = encodeURIComponent(scriptName);
    const url = `${getApiUrl()}/api/?Function=ScriptStop&Value=${encoded}`;
    return performRequest(url);
}

// Obtiene el XML de estado actual de vMix (incluye Inputs en vivo)
export async function getCurrentState(): Promise<VMixApiResult> {
    const url = `${getApiUrl()}/api/`;
    return performRequest(url, 5000);
}

// Ejecuta una función arbitraria (SendKeys, etc.)
export async function executeFunction(funcName: string, params: { [key: string]: string } = {}): Promise<VMixApiResult> {
    const queryParts = [`Function=${encodeURIComponent(funcName)}`];
    for (const [k, v] of Object.entries(params)) {
        queryParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    const url = `${getApiUrl()}/api/?${queryParts.join('&')}`;
    return performRequest(url);
}