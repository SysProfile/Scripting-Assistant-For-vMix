import * as vscode from 'vscode';
import { getFunction } from './funcIndex';
import { findRange, validateValueAgainstRange } from './ranges';
import { findClosingParen, splitArguments } from './transpiler';
import { dataSourceTypes, isDataSourceFunction } from './datasources';
import { isReservedWord, getReservedWordCanonical } from './reservedWords';
import { checkMissingWaits, checkDirectApiFunction, checkInfiniteLoops } from './linter';
import { t } from './i18n';

export function updateDiagnostics(document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection) {
    if (document.languageId !== 'vmix') {
        return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    const lines = text.split(/\r?\n/);

    // ---- DataSource enum validation ----
    const dataSourceRegex = /API\.\w+\.(\w+)\s*\(([^)]*)\)/gi;
    let dsMatch;
    while ((dsMatch = dataSourceRegex.exec(text)) !== null) {
        const funcName = dsMatch[1];
        if (!isDataSourceFunction(funcName)) { continue; }

        const argsStr = dsMatch[2];
        const firstComma = argsStr.indexOf(',');
        const firstArg = (firstComma >= 0 ? argsStr.substring(0, firstComma) : argsStr).trim();

        if (!firstArg) { continue; }

        if (!firstArg.match(/^DataSource\.\w+$/i)) {
            const argOffset = dsMatch.index + dsMatch[0].indexOf('(') + 1;
            const argStartPos = document.positionAt(argOffset);
            const argEndPos = document.positionAt(argOffset + firstArg.length);
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(argStartPos, argEndPos),
                t('diag.dataSourceRequired'),
                vscode.DiagnosticSeverity.Error
            ));
        } else {
            const memberName = firstArg.split('.')[1];
            const validMember = dataSourceTypes.some(d => d.enumName.toLowerCase() === memberName.toLowerCase());
            if (!validMember) {
                const argOffset = dsMatch.index + dsMatch[0].indexOf('(') + 1;
                const dotPos = firstArg.indexOf('.') + 1;
                const memberStartPos = document.positionAt(argOffset + dotPos);
                const memberEndPos = document.positionAt(argOffset + firstArg.length);
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(memberStartPos, memberEndPos),
                    t('diag.dataSourceInvalidMember', memberName),
                    vscode.DiagnosticSeverity.Error
                ));
            }
        }
    }

    // ---- First line must be a comment with the script name ----
    if (lines.length > 0) {
        const hasContent = lines.some(line => line.trim().length > 0);
        const firstLine = lines[0];
        if (hasContent && !firstLine.trimStart().startsWith("'")) {
            const range = new vscode.Range(
                new vscode.Position(0, 0),
                new vscode.Position(0, Math.max(firstLine.length, 1))
            );
            diagnostics.push(new vscode.Diagnostic(
                range,
                t('diag.firstLineRequired'),
                vscode.DiagnosticSeverity.Error
            ));
        }
    }

    // ---- Sub/Function not allowed + Reserved words as variable names ----
    const dimReservedRegex = /\bDim\s+([a-zA-Z0-9_]+)/i;

    lines.forEach((line, lineIndex) => {
        const trimmed = line.trim().toLowerCase();

        if (trimmed.match(/^sub\s+\w+/) && !trimmed.match(/^end\s+sub/)) {
            const startChar = line.search(/\bsub\b/i);
            const range = new vscode.Range(
                new vscode.Position(lineIndex, startChar),
                new vscode.Position(lineIndex, startChar + 3)
            );
            diagnostics.push(new vscode.Diagnostic(range, t('diag.subNotAllowed'), vscode.DiagnosticSeverity.Error));
        }

        if (trimmed.match(/^function\s+\w+/) && !trimmed.match(/^end\s+function/)) {
            const startChar = line.search(/\bfunction\b/i);
            const range = new vscode.Range(
                new vscode.Position(lineIndex, startChar),
                new vscode.Position(lineIndex, startChar + 8)
            );
            diagnostics.push(new vscode.Diagnostic(range, t('diag.functionNotAllowed'), vscode.DiagnosticSeverity.Error));
        }

        // Reserved word as variable
        const dimMatch = line.match(dimReservedRegex);
        if (dimMatch && !line.trimStart().startsWith("'")) {
            const varName = dimMatch[1];
            if (isReservedWord(varName)) {
                const startChar = line.indexOf(varName, line.search(/\bDim\b/i));
                const range = new vscode.Range(
                    new vscode.Position(lineIndex, startChar),
                    new vscode.Position(lineIndex, startChar + varName.length)
                );
                const canonical = getReservedWordCanonical(varName) || varName;
                diagnostics.push(new vscode.Diagnostic(
                    range,
                    t('diag.reservedWord', canonical),
                    vscode.DiagnosticSeverity.Error
                ));
            }
        }
    });

    // ---- Type mismatch: explicit (As Type) and inferred (= literal) ----
    const varTypes: { [key: string]: string } = {};

    // Explicit: Dim x As Integer
    const dimExplicit = /\bDim\s+([a-zA-Z0-9_]+)\s+As\s+(Integer|String|Double|Boolean)\b/gi;
    let dimMatchExp;
    while ((dimMatchExp = dimExplicit.exec(text)) !== null) {
        varTypes[dimMatchExp[1].toLowerCase()] = dimMatchExp[2].toLowerCase();
    }

    // Inferred: Dim x = literal (without As Type)
    const dimInferred = /\bDim\s+([a-zA-Z0-9_]+)\s*=\s*(.+)$/gim;
    let dimMatchInf;
    while ((dimMatchInf = dimInferred.exec(text)) !== null) {
        const name = dimMatchInf[1].toLowerCase();
        if (varTypes[name]) { continue; }
        const initializer = dimMatchInf[2].trim();
        const inferredType = getLiteralType(initializer);
        if (inferredType) {
            varTypes[name] = inferredType;
        }
    }

    function getLiteralType(value: string): string | null {
        const trimmedVal = value.trim();
        if (trimmedVal.startsWith('"') && trimmedVal.endsWith('"')) { return 'string'; }
        if (trimmedVal.toLowerCase() === 'true' || trimmedVal.toLowerCase() === 'false') { return 'boolean'; }
        if (trimmedVal.match(/^\d+$/)) { return 'integer'; }
        if (trimmedVal.match(/^\d+\.\d+$/)) { return 'double'; }
        return null;
    }

    function areTypesCompatible(typeA: string, typeB: string): boolean {
        if (typeA === typeB) { return true; }
        const numerics = ['integer', 'double'];
        if (numerics.includes(typeA) && numerics.includes(typeB)) { return true; }
        return false;
    }

    const comparisonRegex = /\b([a-zA-Z0-9_]+)\s*(=|<>|<|>|<=|>=)\s*(.+?)(?:\s+(?:Then|And|Or)\b|$)/gi;

    lines.forEach((line, lineIndex) => {
        const trimmedLine = line.trim();

        if (!trimmedLine.match(/^\s*(If|ElseIf|While|Do\s+Until|Do\s+While|Loop\s+Until|Loop\s+While)\b/i)) {
            const assignMatch = trimmedLine.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/i);
            if (assignMatch && !trimmedLine.match(/^\s*Dim\b/i)) {
                const varName = assignMatch[1];
                const assignValue = assignMatch[2].trim();
                const varType = varTypes[varName.toLowerCase()];

                if (varType) {
                    const literalType = getLiteralType(assignValue);
                    if (literalType && !areTypesCompatible(varType, literalType)) {
                        const valueStart = line.indexOf(assignValue, line.indexOf('=') + 1);
                        const range = new vscode.Range(
                            new vscode.Position(lineIndex, valueStart),
                            new vscode.Position(lineIndex, valueStart + assignValue.length)
                        );
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            t('diag.typeMismatch', varName, varType, literalType),
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                }
            }
            return;
        }

        comparisonRegex.lastIndex = 0;
        let compMatch;

        while ((compMatch = comparisonRegex.exec(trimmedLine)) !== null) {
            const varName = compMatch[1];
            const rightSide = compMatch[3].trim();
            const varType = varTypes[varName.toLowerCase()];

            if (varType) {
                const literalType = getLiteralType(rightSide);
                if (literalType && !areTypesCompatible(varType, literalType)) {
                    const rightStart = line.indexOf(rightSide, line.indexOf(compMatch[2]) + compMatch[2].length);
                    if (rightStart >= 0) {
                        const range = new vscode.Range(
                            new vscode.Position(lineIndex, rightStart),
                            new vscode.Position(lineIndex, rightStart + rightSide.length)
                        );
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            t('diag.typeMismatch', varName, varType, literalType),
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                }
            }
        }
    });

    // ---- Input parameters without InputsList ----
    const apiPattern = /API\.(\w+)\.(\w+)\s*\(/g;
    let apiMatch;

    while ((apiMatch = apiPattern.exec(text)) !== null) {
        const category = apiMatch[1];
        const funcName = apiMatch[2];
        const matchLine = document.positionAt(apiMatch.index).line;
        const matchLineText = document.lineAt(matchLine).text.trimStart();
        if (matchLineText.startsWith("'")) {
            continue;
        }

        if (category.toLowerCase() === 'input' || category.toLowerCase() === 'shortcut') {
            continue;
        }

        const openParenIndex = apiMatch.index + apiMatch[0].length - 1;
        const closeParenIndex = findClosingParen(text, openParenIndex);

        if (closeParenIndex === -1) { continue; }

        const argsString = text.substring(openParenIndex + 1, closeParenIndex);
        const argsStartIndex = openParenIndex + 1;

        const funcData = getFunction(category, funcName);

        if (!funcData) { continue; }

        const paramsObj = funcData.parameters;
        const isEmptyParams = !paramsObj || (typeof paramsObj === 'string') || Object.keys(paramsObj).length === 0;

        if (isEmptyParams) {
            const trimmedArgs = argsString.trim();
            if (trimmedArgs.length > 0) {
                const startPos = document.positionAt(argsStartIndex);
                const endPos = document.positionAt(argsStartIndex + argsString.length);
                const range = new vscode.Range(startPos, endPos);
                diagnostics.push(new vscode.Diagnostic(
                    range,
                    t('diag.noParamsExpected', funcName),
                    vscode.DiagnosticSeverity.Error
                ));
            }
            apiPattern.lastIndex = closeParenIndex + 1;
            continue;
        }

        if (paramsObj) {
            const paramKeys = Object.keys(paramsObj);
            const args = splitArguments(argsString);

            let currentOffset = 0;
            args.forEach((arg, index) => {
                if (index < paramKeys.length && arg.length > 0) {
                    const paramName = paramKeys[index];
                    const paramDef = paramsObj[paramName];

                    if (paramDef.type === 'input') {
                        if (!arg.match(/^InputsList\./i)) {
                            const argIndex = argsString.indexOf(arg, currentOffset);
                            const startPos = document.positionAt(argsStartIndex + argIndex);
                            const endPos = document.positionAt(argsStartIndex + argIndex + arg.length);
                            const range = new vscode.Range(startPos, endPos);

                            diagnostics.push(new vscode.Diagnostic(
                                range,
                                t('diag.typeError', paramName),
                                vscode.DiagnosticSeverity.Error
                            ));
                        }
                    }

                    if (paramName.toLowerCase() === 'selectedindex' || paramName.toLowerCase() === 'selectedname') {
                        if (!arg.match(/^ObjectsList\./i) && arg.trim().length > 0) {
                            const argIndex = argsString.indexOf(arg, currentOffset);
                            const startPos = document.positionAt(argsStartIndex + argIndex);
                            const endPos = document.positionAt(argsStartIndex + argIndex + arg.length);
                            const range = new vscode.Range(startPos, endPos);

                            diagnostics.push(new vscode.Diagnostic(
                                range,
                                t('diag.objectsListRequired', paramName),
                                vscode.DiagnosticSeverity.Error
                            ));
                        }
                    }

                    const lowerParamName = paramName.toLowerCase();
                    if (lowerParamName === 'value' || lowerParamName === 'channel' || lowerParamName === 'duration') {
                        const rangeData = findRange(category, funcName);
                        if (rangeData && arg.trim().length > 0 && !paramDef.optional) {
                            const trimmedArg = arg.trim();
                            const isLiteral = trimmedArg.startsWith('"') || trimmedArg.match(/^-?\d+\.?\d*$/);

                            if (isLiteral) {
                                const validationError = validateValueAgainstRange(trimmedArg, rangeData.range, paramDef.type || 'string');
                                if (validationError) {
                                    const argIndex = argsString.indexOf(arg, currentOffset);
                                    const startPos = document.positionAt(argsStartIndex + argIndex);
                                    const endPos = document.positionAt(argsStartIndex + argIndex + arg.length);
                                    const range = new vscode.Range(startPos, endPos);

                                    diagnostics.push(new vscode.Diagnostic(
                                        range,
                                        `${paramName}: ${validationError}`,
                                        vscode.DiagnosticSeverity.Warning
                                    ));
                                }
                            }
                        }
                    }
                }
                currentOffset = argsString.indexOf(arg, currentOffset) + arg.length;
            });
        }

        apiPattern.lastIndex = closeParenIndex + 1;
    }

    // ---- Linter (good practices) ----
    const config = vscode.workspace.getConfiguration('vmixScripting');
    const linterEnabled = config.get<boolean>('enableLinter', true);

    if (linterEnabled) {
        diagnostics.push(...checkMissingWaits(document));
        diagnostics.push(...checkDirectApiFunction(document));
        diagnostics.push(...checkInfiniteLoops(document));
    }

    diagnosticCollection.set(document.uri, diagnostics);
}