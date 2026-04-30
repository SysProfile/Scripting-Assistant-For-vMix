// ==========================================
// SNIPPETS PARA VMIX SCRIPT
// Estáticos (patrones comunes) + dinámicos (por Inputs del proyecto)
// ==========================================

import * as vscode from 'vscode';
import { inputsList, objectsList } from './globals';

interface SnippetDef {
    prefix: string;
    body: string;
    description: string;
}

const STATIC_SNIPPETS: SnippetDef[] = [
    {
        prefix: 'wait',
        body: 'API.Function("Wait", Value:="${1:1000}")',
        description: 'Pausa la ejecución (ms)'
    },
    {
        prefix: 'ifprogram',
        body: [
            'Dim ${1:miInput} = API.Input.Find("${2:NombreInput}")',
            'If ${1:miInput}.State = "Running" Then',
            '\t$0',
            'End If'
        ].join('\n'),
        description: 'Bloque condicional: ejecutar si input está activo'
    },
    {
        prefix: 'fadein',
        body: [
            'API.Audio.AudioOn(InputsList.${1:MiInput})',
            'API.Function("SetVolume", Input:="${2:NombreInput}", Value:="0")',
            'API.Function("SetVolumeFade", Input:="${2:NombreInput}", Value:="100,${3:1000}")'
        ].join('\n'),
        description: 'Fade in de audio'
    },
    {
        prefix: 'fadeout',
        body: [
            'API.Function("SetVolumeFade", Input:="${1:NombreInput}", Value:="0,${2:1000}")',
            'API.Function("Wait", Value:="${2:1000}")',
            'API.Audio.AudioOff(InputsList.${3:MiInput})'
        ].join('\n'),
        description: 'Fade out de audio'
    },
    {
        prefix: 'looploop',
        body: [
            'Do',
            '\t$0',
            '\tAPI.Function("Wait", Value:="${1:1000}")',
            'Loop Until ${2:condicionDeSalida}'
        ].join('\n'),
        description: 'Loop con condición de salida segura'
    },
    {
        prefix: 'cycleinputs',
        body: [
            "'${1:Cycle_Inputs}",
            'Dim inputs As String = "${2:Input1,Input2,Input3}"',
            'Dim arr() As String = inputs.Split(",")',
            'For Each name As String In arr',
            '\tAPI.Function("ActiveInput", Input:=name)',
            '\tAPI.Function("Wait", Value:="${3:5000}")',
            'Next'
        ].join('\n'),
        description: 'Ciclar entre múltiples inputs en Program'
    },
    {
        prefix: 'gtsettext',
        body: 'API.Title.SetText(InputsList.${1:MiTitulo}, ObjectsList.${2:MiTextBlock}, "${3:texto}")',
        description: 'Cambiar texto de un GT Title'
    },
    {
        prefix: 'gtsetimage',
        body: 'API.Title.SetImage(InputsList.${1:MiTitulo}, ObjectsList.${2:MiImagen}, "${3:C:/ruta/imagen.png}")',
        description: 'Cambiar imagen de un GT Title'
    },
    {
        prefix: 'cutto',
        body: 'API.Function("CutDirect", Input:="${1:NombreInput}")',
        description: 'Corte directo a un input (sin afectar Preview)'
    },
    {
        prefix: 'fadeto',
        body: 'API.Function("Fade", Input:="${1:NombreInput}", Value:="${2:1000}")',
        description: 'Transición fade a un input'
    },
    {
        prefix: 'overlayon',
        body: 'API.Function("OverlayInput${1:1}In", Input:="${2:NombreInput}")',
        description: 'Activar overlay channel 1-4'
    },
    {
        prefix: 'overlayoff',
        body: 'API.Function("OverlayInput${1:1}Out")',
        description: 'Desactivar overlay channel 1-4'
    },
    {
        prefix: 'tally',
        body: [
            'Dim ${1:miInput} = API.Input.Find("${2:NombreInput}")',
            'If ${1:miInput}.State = "Running" Then',
            "\t' Está en Program",
            '\t$0',
            'Else',
            "\t' No está en Program",
            'End If'
        ].join('\n'),
        description: 'Reaccionar al estado tally de un input'
    }
];

export function getStaticSnippetProvider(): vscode.Disposable {
    return vscode.languages.registerCompletionItemProvider(
        'vmix',
        {
            provideCompletionItems(document, position) {
                const linePrefix = document.lineAt(position).text.substring(0, position.character);
                if (linePrefix.trimStart().startsWith("'")) { return undefined; }
                if (linePrefix.match(/\.[a-zA-Z0-9_]*$/)) { return undefined; }

                return STATIC_SNIPPETS.map(s => {
                    const item = new vscode.CompletionItem(s.prefix, vscode.CompletionItemKind.Snippet);
                    item.insertText = new vscode.SnippetString(s.body);
                    item.detail = s.description;
                    item.documentation = new vscode.MarkdownString('```vb\n' + s.body.replace(/\$\{?\d+:?([^}]*)\}?/g, '$1') + '\n```');
                    return item;
                });
            }
        }
    );
}

// Snippets dinámicos: para cada Input del proyecto, crear un atajo gt-Nombre o cut-Nombre
export function getDynamicSnippetProvider(): vscode.Disposable {
    return vscode.languages.registerCompletionItemProvider(
        'vmix',
        {
            provideCompletionItems(document, position) {
                const linePrefix = document.lineAt(position).text.substring(0, position.character);
                if (linePrefix.trimStart().startsWith("'")) { return undefined; }
                if (linePrefix.match(/\.[a-zA-Z0-9_]*$/)) { return undefined; }

                const items: vscode.CompletionItem[] = [];

                inputsList.forEach(input => {
                    // Snippet de cut-Nombre
                    const cutItem = new vscode.CompletionItem(`cut-${input.sanitized}`, vscode.CompletionItemKind.Snippet);
                    cutItem.insertText = new vscode.SnippetString(`API.Function("CutDirect", Input:="${input.original}")`);
                    cutItem.detail = `Cut directo a "${input.original}"`;
                    items.push(cutItem);

                    // Snippet de fade-Nombre
                    const fadeItem = new vscode.CompletionItem(`fade-${input.sanitized}`, vscode.CompletionItemKind.Snippet);
                    fadeItem.insertText = new vscode.SnippetString(`API.Function("Fade", Input:="${input.original}", Value:="\${1:1000}")`);
                    fadeItem.detail = `Fade a "${input.original}"`;
                    items.push(fadeItem);

                    // Para GT Titles: snippet gt-Nombre que prepara estructura para SetText/SetImage
                    if (input.inputType === 9000) {
                        const childObjects = objectsList.filter(o => o.parentInput === input.sanitized);
                        if (childObjects.length > 0) {
                            const firstText = childObjects.find(o => o.objectKind === 'text');
                            if (firstText) {
                                const gtItem = new vscode.CompletionItem(`gt-${input.sanitized}`, vscode.CompletionItemKind.Snippet);
                                gtItem.insertText = new vscode.SnippetString(
                                    `API.Title.SetText(InputsList.${input.sanitized}, ObjectsList.${firstText.sanitized}, "\${1:texto}")`
                                );
                                gtItem.detail = `SetText a "${input.original}"`;
                                items.push(gtItem);
                            }
                        }
                    }
                });

                return items;
            }
        }
    );
}