// ==========================================
// DATASOURCE ENUM - Tipos predefinidos de DataSource
// Ref: https://www.vmix.com/help29/DataSourcesTypes.html
// ==========================================

export interface DataSourceEntry {
    enumName: string;    // Nombre en el lenguaje tipado: Excel_CSV, GoogleSheets, etc.
    nativeValue: string; // String que espera vMix: "Excel/CSV", "Google Sheets", etc.
}

// Mapa de tipos de DataSource: enum → string nativo de vMix
export const dataSourceTypes: DataSourceEntry[] = [
    { enumName: 'Excel_CSV', nativeValue: 'Excel/CSV' },
    { enumName: 'GoogleSheets', nativeValue: 'Google Sheets' },
    { enumName: 'RSS', nativeValue: 'RSS' },
    { enumName: 'Text', nativeValue: 'Text' },
    { enumName: 'XML', nativeValue: 'XML' },
    { enumName: 'JSON', nativeValue: 'JSON' },
    { enumName: 'ZoomChat', nativeValue: 'Zoom Chat' }
];

// Funciones que usan DataSource como primer parámetro composite
export const dataSourceFunctions: string[] = [
    'DataSourceAutoNextOff',
    'DataSourceAutoNextOn',
    'DataSourceAutoNextOnOff',
    'DataSourceNextRow',
    'DataSourcePause',
    'DataSourcePlay',
    'DataSourcePlayPause',
    'DataSourcePreviousRow',
    'DataSourceSelectRow'
];

// Buscar enum por nombre (case-insensitive)
export function findDataSourceByEnum(name: string): DataSourceEntry | undefined {
    const lower = name.toLowerCase();
    return dataSourceTypes.find(d => d.enumName.toLowerCase() === lower);
}

// Buscar enum por valor nativo (case-insensitive)
export function findDataSourceByNative(nativeValue: string): DataSourceEntry | undefined {
    const lower = nativeValue.toLowerCase();
    return dataSourceTypes.find(d => d.nativeValue.toLowerCase() === lower);
}

// Verificar si una función es DataSource
export function isDataSourceFunction(functionName: string): boolean {
    return dataSourceFunctions.some(f => f.toLowerCase() === functionName.toLowerCase());
}