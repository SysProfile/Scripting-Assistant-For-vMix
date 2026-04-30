// ==========================================
// ÍNDICE DE FUNCIONES vMix
// Acceso O(1) por categoría+función. Reemplaza linear .find()
// ==========================================

import { vMixFunctions } from './globals';

let funcIndex: Map<string, any> | null = null;
let funcsByCategory: Map<string, any[]> | null = null;

function buildKey(category: string, funcName: string): string {
    return `${category.toLowerCase()}|${funcName.toLowerCase()}`;
}

export function rebuildFunctionIndex(): void {
    funcIndex = new Map();
    funcsByCategory = new Map();

    for (const f of vMixFunctions) {
        const key = buildKey(f.category, f.function);
        funcIndex.set(key, f);

        const catKey = f.category.toLowerCase();
        if (!funcsByCategory.has(catKey)) {
            funcsByCategory.set(catKey, []);
        }
        funcsByCategory.get(catKey)!.push(f);
    }
}

export function getFunction(category: string, funcName: string): any | undefined {
    if (!funcIndex) { rebuildFunctionIndex(); }
    return funcIndex!.get(buildKey(category, funcName));
}

export function getFunctionByName(funcName: string): any | undefined {
    if (!funcIndex) { rebuildFunctionIndex(); }
    const lowerName = funcName.toLowerCase();
    for (const f of funcIndex!.values()) {
        if (f.function.toLowerCase() === lowerName) { return f; }
    }
    return undefined;
}

export function getFunctionsByCategory(category: string): any[] {
    if (!funcsByCategory) { rebuildFunctionIndex(); }
    return funcsByCategory!.get(category.toLowerCase()) || [];
}

export function getAllCategories(): string[] {
    if (!funcsByCategory) { rebuildFunctionIndex(); }
    const cats = new Set<string>();
    for (const f of vMixFunctions) {
        cats.add(f.category);
    }
    return Array.from(cats);
}