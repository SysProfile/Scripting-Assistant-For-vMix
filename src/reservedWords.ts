// ==========================================
// PALABRAS RESERVADAS DE VB.NET
// No pueden usarse como nombres de variables, métodos,
// enums ni structures (rompen vMix scripts silenciosamente).
// ==========================================

export const VB_RESERVED_WORDS: string[] = [
    'AddHandler', 'AddressOf', 'Alias', 'And', 'AndAlso', 'As', 'Boolean',
    'ByRef', 'Byte', 'ByVal', 'Call', 'Case', 'Catch', 'CBool', 'CByte',
    'CChar', 'CDate', 'CDbl', 'CDec', 'Char', 'CInt', 'Class', 'CLng',
    'CObj', 'Const', 'Continue', 'CSByte', 'CShort', 'CSng', 'CStr', 'CType',
    'CUInt', 'CULng', 'CUShort', 'Date', 'Decimal', 'Declare', 'Default',
    'Delegate', 'Dim', 'DirectCast', 'Do', 'Double', 'Each', 'Else',
    'ElseIf', 'End', 'EndIf', 'Enum', 'Erase', 'Error', 'Event', 'Exit',
    'False', 'Finally', 'For', 'Friend', 'Function', 'Get', 'GetType',
    'GetXMLNamespace', 'Global', 'GoSub', 'GoTo', 'Handles', 'If',
    'Implements', 'Imports', 'In', 'Inherits', 'Integer', 'Interface', 'Is',
    'IsNot', 'Let', 'Lib', 'Like', 'Long', 'Loop', 'Me', 'Mod', 'Module',
    'MustInherit', 'MustOverride', 'MyBase', 'MyClass', 'Namespace',
    'Narrowing', 'New', 'Next', 'Not', 'Nothing', 'NotInheritable',
    'NotOverridable', 'Object', 'Of', 'On', 'Open', 'Operator', 'Option',
    'Optional', 'Or', 'OrElse', 'Out', 'Overloads', 'Overridable',
    'Overrides', 'ParamArray', 'Partial', 'Private', 'Property', 'Protected',
    'Public', 'RaiseEvent', 'ReadOnly', 'ReDim', 'REM', 'RemoveHandler',
    'Resume', 'Return', 'SByte', 'Select', 'Set', 'Shadows', 'Shared',
    'Short', 'Single', 'Static', 'Step', 'Stop', 'String', 'Structure',
    'Sub', 'SyncLock', 'Then', 'Throw', 'To', 'True', 'Try', 'TryCast',
    'TypeOf', 'UInteger', 'ULong', 'UShort', 'Using', 'Variant', 'Wend',
    'When', 'While', 'Widening', 'With', 'WithEvents', 'WriteOnly', 'Xor'
];

const reservedSet = new Set(VB_RESERVED_WORDS.map(w => w.toLowerCase()));

export function isReservedWord(name: string): boolean {
    return reservedSet.has(name.toLowerCase());
}

export function getReservedWordCanonical(name: string): string | null {
    const lower = name.toLowerCase();
    return VB_RESERVED_WORDS.find(w => w.toLowerCase() === lower) || null;
}