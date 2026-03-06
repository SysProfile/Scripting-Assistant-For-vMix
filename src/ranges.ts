import { VMixValueRange } from './types';
import { vMixRanges } from './globals';

export function findRange(category: string, funcName: string): VMixValueRange | undefined {
    return vMixRanges.find(r =>
        r.category.toLowerCase() === category.toLowerCase() &&
        r.function.toLowerCase() === funcName.toLowerCase()
    );
}

export function getRangeDescription(range: string): string {
    if (!range && range !== '') { return ''; }

    if (range === 'url') {
        return 'URL (http://, https://, file://)';
    }
    if (range.startsWith('@')) {
        const parts = range.substring(1).split(',');
        return 'Composite: ' + parts.map((p, i) => {
            const colonIdx = p.indexOf(':');
            if (colonIdx >= 0) {
                return `[${i + 1}] ${p.substring(colonIdx + 1)} (${p.substring(0, colonIdx)})`;
            }
            return `[${i + 1}] ${p}`;
        }).join(', ');
    }
    if (range.startsWith('{') && range.endsWith('}')) {
        return `Format: ${range.substring(1, range.length - 1)}`;
    }
    if (range.startsWith('!') && range.includes(',')) {
        const vals = range.substring(1).split(',').map(v => v.trim());
        return `Bus letters (one per parameter): ${vals.join(', ')}`;
    }
    if (range.startsWith('+') && range.includes(',')) {
        const vals = range.substring(1).split(',');
        return `Accumulative values: ${vals.join(', ')} (can combine, e.g. ${vals.slice(0, 3).join('')})`;
    }
    if (range.startsWith('=') && range.includes(',')) {
        const vals = range.substring(1).split(',');
        return `Valid values: ${vals.join(', ')}`;
    }
    if (range === '+') {
        return 'Non-empty string';
    }
    if (range === '') {
        return 'Any string (can be empty)';
    }
    if (range === '<?:?') {
        return 'Any number (negative to positive)';
    }
    if (range === '?:?') {
        return 'Number >= 0';
    }
    if (range.includes(':')) {
        const parts = range.split(':');
        return `Range: ${parts[0]} to ${parts[1]}`;
    }
    if (range.includes(',') && !range.startsWith('+') && !range.startsWith('=')) {
        return `Valid values: ${range}`;
    }
    return range;
}

// Devuelve los valores individuales del rango ! (e.g. ["M","A","B","C","D","E","F","G"])
export function getRangeProgressiveValues(range: string): string[] {
    if (!range.startsWith('!') || !range.includes(',')) { return []; }
    return range.substring(1).split(',').map(v => v.trim());
}

// Devuelve un array de arrays, uno por overload.
// !M,A,B → [["M"], ["M","A"], ["M","A","B"]]
export function getRangeProgressiveOverloads(range: string): string[][] {
    const values = getRangeProgressiveValues(range);
    const result: string[][] = [];
    for (let i = 0; i < values.length; i++) {
        result.push(values.slice(0, i + 1));
    }
    return result;
}

export function getRangeCompletionItems(range: string): string[] {
    if (range.startsWith('!') && range.includes(',')) {
        return getRangeProgressiveValues(range);
    }
    if (range.startsWith('+') && range.includes(',')) {
        return range.substring(1).split(',').map(v => v.trim());
    }
    if (range.startsWith('=') && range.includes(',')) {
        return range.substring(1).split(',').map(v => v.trim());
    }
    if (!range.startsWith('+') && !range.startsWith('=') && !range.startsWith('!') && !range.startsWith('{') && !range.startsWith('@') && !range.startsWith('<') && !range.startsWith('?') && range !== 'url' && range !== '' && range.includes(',') && !range.includes(':')) {
        return range.split(',').map(v => v.trim());
    }
    return [];
}

export function validateValueAgainstRange(value: string, range: string, valueType: string): string | null {
    if (!range && range !== '') { return null; }

    const trimmedValue = value.trim();

    if (range === 'url') {
        if (!trimmedValue.match(/^"(https?:\/\/|file:\/\/)/i)) {
            return 'URL must start with http://, https:// or file://';
        }
        return null;
    }

    if (range.startsWith('@')) { return null; }
    if (range.startsWith('{') && range.endsWith('}')) { return null; }

    if (range === '+') {
        if (trimmedValue === '""') { return 'Value cannot be empty'; }
        return null;
    }

    if (range === '') { return null; }

    // Para ! el valor es un identificador sin comillas (constante de letra)
    if (range.startsWith('!') && range.includes(',')) {
        const validVals = getRangeProgressiveValues(range).map(v => v.toLowerCase());
        const unquoted = trimmedValue.replace(/^"|"$/g, '').toLowerCase();
        if (!validVals.includes(unquoted)) {
            return `Invalid bus letter '${trimmedValue}'. Valid: ${getRangeProgressiveValues(range).join(', ')}`;
        }
        return null;
    }

    const unquoted = trimmedValue.replace(/^"|"$/g, '');

    if (range.startsWith('=') && range.includes(',')) {
        const validVals = range.substring(1).split(',').map(v => v.trim().toLowerCase());
        if (!validVals.includes(unquoted.toLowerCase())) {
            return `Invalid value. Valid options: ${range.substring(1)}`;
        }
        return null;
    }

    if (range.startsWith('+') && range.includes(',')) {
        const validChars = range.substring(1).split(',').map(v => v.trim().toLowerCase());
        for (const ch of unquoted) {
            if (!validChars.includes(ch.toLowerCase())) {
                return `Invalid character '${ch}'. Valid: ${range.substring(1)}`;
            }
        }
        if (unquoted.length === 0) { return 'Value cannot be empty'; }
        return null;
    }

    if (range === '<?:?' || range === '?:?') {
        const num = parseFloat(unquoted);
        if (isNaN(num)) { return 'Value must be a number'; }
        if (range === '?:?' && num < 0) { return 'Value must be >= 0'; }
        return null;
    }

    if (range.includes(':') && !range.startsWith('{')) {
        const parts = range.split(':');
        const min = parseFloat(parts[0]);
        const max = parseFloat(parts[1]);
        const num = parseFloat(unquoted);
        if (isNaN(num)) { return 'Value must be a number'; }
        if (num < min || num > max) { return `Value out of range. Expected: ${min} to ${max}`; }
        return null;
    }

    if (!range.startsWith('+') && !range.startsWith('=') && !range.startsWith('!') && !range.startsWith('{') && !range.startsWith('@') && !range.startsWith('<') && !range.startsWith('?') && range !== 'url' && range !== '' && range.includes(',') && !range.includes(':')) {
        const validVals = range.split(',').map(v => v.trim());
        if (!validVals.includes(unquoted)) { return `Invalid value. Valid options: ${range}`; }
        return null;
    }

    return null;
}