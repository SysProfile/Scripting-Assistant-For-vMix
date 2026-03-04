export interface VMixItem {
    sanitized: string;
    original: string;
    inputType?: number;            // For inputs: vMix type ID (0=Video, 9000=GT Title, etc.)
    objectKind?: 'text' | 'image'; // For objects: element type from .gtzip
    parentInput?: string;          // For objects: sanitized name of the parent Input
}

export interface VMixScript {
    name: string;
    code: string;
}

export interface ProjectStats {
    inputCount: number;
    objectCount: number;
    fileName: string;
    success: boolean;
    errorMessage?: string;
}

export interface VMixValueRange {
    category: string;
    function: string;
    range: string;
}