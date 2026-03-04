import * as fs from 'fs';
import * as path from 'path';

let translations: { [key: string]: string } = {};
let fallbackTranslations: { [key: string]: string } = {};

export function initI18n(extensionPath: string, language: string): void {
    const i18nDir = path.join(extensionPath, 'i18n');

    const enPath = path.join(i18nDir, 'en.json');
    if (fs.existsSync(enPath)) {
        fallbackTranslations = JSON.parse(fs.readFileSync(enPath, 'utf8'));
    }

    const lang = language.split('-')[0];
    if (lang !== 'en') {
        const langPath = path.join(i18nDir, `${lang}.json`);
        if (fs.existsSync(langPath)) {
            translations = JSON.parse(fs.readFileSync(langPath, 'utf8'));
        }
    }
}

export function t(key: string, ...args: (string | number)[]): string {
    let text = translations[key] || fallbackTranslations[key] || key;
    args.forEach((arg, i) => {
        text = text.replace(new RegExp(`\\{${i}\\}`, 'g'), String(arg));
    });
    return text;
}