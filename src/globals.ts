import { VMixItem, VMixValueRange } from './types';
import { rebuildFunctionIndex } from './funcIndex';

export let vMixFunctions: any[] = [];
export let vMixRanges: VMixValueRange[] = [];
export let inputsList: VMixItem[] = [];
export let objectsList: VMixItem[] = [];
export let dynamicKeywords: { [key: string]: string } = {};

export function setVMixFunctions(data: any[]) {
    vMixFunctions = data;
    rebuildFunctionIndex();
}

export function setVMixRanges(data: VMixValueRange[]) {
    vMixRanges = data;
}

export function setInputsList(data: VMixItem[]) {
    inputsList = data;
}

export function setObjectsList(data: VMixItem[]) {
    objectsList = data;
}

export function setDynamicKeywords(data: { [key: string]: string }) {
    dynamicKeywords = data;
}