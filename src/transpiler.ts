import { inputsList, objectsList } from './globals';
import { getFunction, getFunctionByName } from './funcIndex';
import { findDataSourceByEnum, findDataSourceByNative, isDataSourceFunction } from './datasources';
import { findRange, getRangeProgressiveValues } from './ranges';

export function findClosingParen(text: string, openIndex: number): number {
    let depth = 0;
    let inString = false;

    for (let i = openIndex; i < text.length; i++) {
        const ch = text[i];

        if (ch === '"') {
            if (inString) {
                if (i + 1 < text.length && text[i + 1] === '"') {
                    i++;
                    continue;
                }
                inString = false;
            } else {
                inString = true;
            }
            continue;
        }

        if (!inString) {
            if (ch === '(') { depth++; }
            if (ch === ')') {
                depth--;
                if (depth === 0) { return i; }
            }
        }
    }
    return -1;
}

export function splitArguments(argsString: string): string[] {
    const args: string[] = [];
    let current = '';
    let depth = 0;
    let inString = false;

    for (let i = 0; i < argsString.length; i++) {
        const ch = argsString[i];

        if (ch === '"') {
            if (inString) {
                if (i + 1 < argsString.length && argsString[i + 1] === '"') {
                    current += '""';
                    i++;
                    continue;
                }
                inString = false;
            } else {
                inString = true;
            }
            current += ch;
            continue;
        }

        if (!inString) {
            if (ch === '(') { depth++; }
            if (ch === ')') { depth--; }

            if (ch === ',' && depth === 0) {
                args.push(current.trim());
                current = '';
                continue;
            }
        }

        current += ch;
    }

    if (current.trim().length > 0) {
        args.push(current.trim());
    }

    return args;
}

export function exportApiCalls(text: string): { result: string; unknownFunctions: string[] } {
    const pattern = /API\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\s*\(/g;
    let result = '';
    let lastIndex = 0;
    let match;
    const unknownFunctions: string[] = [];

    pattern.lastIndex = 0;

    while ((match = pattern.exec(text)) !== null) {
        const category = match[1];
        const funcName = match[2];

        if (category.toLowerCase() === 'input' && funcName.toLowerCase() === 'find') {
            continue;
        }

        if (category.toLowerCase() === 'shortcut' && funcName.toLowerCase() === 'value') {
            continue;
        }

        const openParenIndex = match.index + match[0].length - 1;
        const closeParenIndex = findClosingParen(text, openParenIndex);

        if (closeParenIndex === -1) {
            continue;
        }

        const argsString = text.substring(openParenIndex + 1, closeParenIndex);

        result += text.substring(lastIndex, match.index);

        const funcData = getFunction(category, funcName);

        if (funcData && funcData.parameters) {
            const paramKeys = Object.keys(funcData.parameters);
            const args = splitArguments(argsString);
            const namedArgs: string[] = [];

            const rangeData = findRange(category, funcName);
            if (rangeData && rangeData.range.startsWith('!') && args.length > 0) {
                namedArgs.push(`Input:=${args[0]}`);
                if (args.length > 1) {
                    const busStr = args.slice(1).map(a => a.replace(/^"|"$/g, '')).join('');
                    namedArgs.push(`Value:="${busStr}"`);
                }
            } else if (isDataSourceFunction(funcData.function) && args.length > 0) {
                const dsMatch = args[0].match(/^DataSource\.(\w+)$/i);
                if (dsMatch) {
                    const dsEntry = findDataSourceByEnum(dsMatch[1]);
                    if (dsEntry) {
                        const parts = [dsEntry.nativeValue];
                        for (let i = 1; i < args.length; i++) {
                            parts.push(args[i].replace(/^"|"$/g, ''));
                        }
                        namedArgs.push(`Value:="${parts.join(',')}"`);
                    }
                }
            } else {
                args.forEach((arg, i) => {
                    if (arg && paramKeys[i]) {
                        namedArgs.push(`${paramKeys[i]}:=${arg}`);
                    }
                });
            }

            const argsPart = namedArgs.length > 0 ? `, ${namedArgs.join(', ')}` : '';
            result += `API.Function("${funcData.function}"${argsPart})`;
        } else {
            const displayName = `${category}.${funcName}`;
            if (!unknownFunctions.includes(displayName)) {
                unknownFunctions.push(displayName);
            }
            const argsPart = argsString.trim().length > 0 ? `, ${argsString}` : '';
            result += `API.Function("${funcName}"${argsPart})`;
        }

        lastIndex = closeParenIndex + 1;
        pattern.lastIndex = closeParenIndex + 1;
    }

    result += text.substring(lastIndex);
    return { result, unknownFunctions };
}

export function importApiCalls(text: string): string {
    const pattern = /API\.Function\(\s*"([^"]+)"\s*/g;
    let result = '';
    let lastIndex = 0;
    let match;

    pattern.lastIndex = 0;

    while ((match = pattern.exec(text)) !== null) {
        const funcName = match[1];

        const fullMatchStart = match.index;
        const openParenIndex = text.indexOf('(', fullMatchStart);
        const closeParenIndex = findClosingParen(text, openParenIndex);

        if (closeParenIndex === -1) {
            continue;
        }

        const fullContent = text.substring(openParenIndex + 1, closeParenIndex);

        result += text.substring(lastIndex, fullMatchStart);

        const funcData = getFunctionByName(funcName);

        if (funcData) {
            let positionalArgs: string[] = [];

            const funcNameToken = `"${funcName}"`;
            const tokenIndex = fullContent.indexOf(funcNameToken);
            const afterNameIndex = tokenIndex >= 0 ? tokenIndex + funcNameToken.length : 0;
            const argsString = fullContent.substring(afterNameIndex).replace(/^\s*,?\s*/, '');

            if (argsString.trim().length > 0 && funcData.parameters) {
                const paramKeys = Object.keys(funcData.parameters);
                const argsObj: { [key: string]: string } = {};

                const namedArgRegex = /([a-zA-Z0-9_]+)\s*:=\s*/g;
                let namedMatch;
                const namedPositions: { key: string; start: number }[] = [];

                while ((namedMatch = namedArgRegex.exec(argsString)) !== null) {
                    namedPositions.push({ key: namedMatch[1], start: namedMatch.index + namedMatch[0].length });
                }

                if (namedPositions.length > 0) {
                    for (let i = 0; i < namedPositions.length; i++) {
                        const valueStart = namedPositions[i].start;
                        let valueEnd: number;

                        if (i + 1 < namedPositions.length) {
                            const nextArgKeyStart = argsString.lastIndexOf(',', namedPositions[i + 1].start - namedPositions[i + 1].key.length - 3);
                            valueEnd = nextArgKeyStart !== -1 ? nextArgKeyStart : namedPositions[i + 1].start;
                        } else {
                            valueEnd = argsString.length;
                        }

                        const value = argsString.substring(valueStart, valueEnd).replace(/,\s*$/, '').trim();
                        argsObj[namedPositions[i].key.toLowerCase()] = value;
                    }

                    paramKeys.forEach(pk => {
                        if (argsObj[pk.toLowerCase()]) {
                            positionalArgs.push(argsObj[pk.toLowerCase()]);
                        }
                    });
                } else {
                    positionalArgs = splitArguments(argsString);
                }
            }

            const rangeData = findRange(funcData.category, funcData.function);
            if (rangeData && rangeData.range.startsWith('!')) {
                const inputArg = positionalArgs.length > 0 ? positionalArgs[0] : '';
                const valueArg = positionalArgs.length > 1 ? positionalArgs[1] : '';
                const busStr = valueArg.replace(/^"|"$/g, '');
                const validLetters = getRangeProgressiveValues(rangeData.range).map(v => v.toUpperCase());
                const busLetters = busStr.toUpperCase().split('').filter(ch => validLetters.includes(ch));
                positionalArgs = inputArg ? [inputArg, ...busLetters] : busLetters;
            } else if (isDataSourceFunction(funcData.function) && positionalArgs.length > 0) {
                const firstArg = positionalArgs[0].replace(/^"|"$/g, '');
                const dsEntry = findDataSourceByNative(firstArg);
                if (dsEntry) {
                    positionalArgs[0] = `DataSource.${dsEntry.enumName}`;
                }
            }

            result += `API.${funcData.category}.${funcData.function}(${positionalArgs.join(', ')})`;
        } else {
            result += text.substring(fullMatchStart, closeParenIndex + 1);
        }

        lastIndex = closeParenIndex + 1;
        pattern.lastIndex = closeParenIndex + 1;
    }

    result += text.substring(lastIndex);
    return result;
}

export function importReplaceStringsWithContext(text: string): string {
    const inputOriginals = new Set(inputsList.map(i => i.original.toLowerCase()));
    const objectOriginals = new Set(objectsList.map(o => o.original.toLowerCase()));

    const sortedObjects = [...objectsList].sort((a, b) => b.original.length - a.original.length);
    sortedObjects.forEach(o => {
        const safeOriginal = o.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const contextRegex = new RegExp(`(\\.(Text|Image)\\()\\s*"${safeOriginal}"`, 'gi');
        text = text.replace(contextRegex, `$1ObjectsList.${o.sanitized}`);
    });

    const sortedInputs = [...inputsList].sort((a, b) => b.original.length - a.original.length);
    sortedInputs.forEach(i => {
        const safeOriginal = i.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const namedParamRegex = new RegExp(`(Input\\s*:=\\s*)"${safeOriginal}"`, 'gi');
        text = text.replace(namedParamRegex, `$1InputsList.${i.sanitized}`);
    });

    sortedInputs.forEach(i => {
        const safeOriginal = i.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const findRegex = new RegExp(`(Input\\.Find\\()\\s*"${safeOriginal}"`, 'gi');
        text = text.replace(findRegex, `$1InputsList.${i.sanitized}`);
    });

    const allItems = [...inputsList, ...objectsList];
    const sortedAll = allItems.sort((a, b) => b.original.length - a.original.length);
    const alreadyProcessed = new Set<string>();

    sortedAll.forEach(item => {
        const lowerOriginal = item.original.toLowerCase();
        if (alreadyProcessed.has(lowerOriginal)) { return; }
        alreadyProcessed.add(lowerOriginal);

        const safeOriginal = item.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const isInput = inputOriginals.has(lowerOriginal);
        const isObject = objectOriginals.has(lowerOriginal);

        const remainingRegex = new RegExp(`"${safeOriginal}"`, 'gi');

        if (isInput) {
            const inputItem = inputsList.find(i => i.original.toLowerCase() === lowerOriginal);
            if (inputItem) {
                text = text.replace(remainingRegex, `InputsList.${inputItem.sanitized}`);
            }
        } else if (isObject) {
            const objectItem = objectsList.find(o => o.original.toLowerCase() === lowerOriginal);
            if (objectItem) {
                text = text.replace(remainingRegex, `ObjectsList.${objectItem.sanitized}`);
            }
        }
    });

    return text;
}