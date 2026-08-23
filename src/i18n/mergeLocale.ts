import type { TranslationDict } from './types';

export type LocalePatch = {
  [K in keyof TranslationDict]?: Partial<TranslationDict[K]>;
};

/** Deep-merge a partial locale patch onto a base dictionary. */
export function mergeLocale(base: TranslationDict, patch: LocalePatch): TranslationDict {
  const result = structuredClone(base) as TranslationDict;
  for (const section of Object.keys(patch) as (keyof TranslationDict)[]) {
    const sectionPatch = patch[section];
    if (!sectionPatch) continue;
    Object.assign(result[section], sectionPatch);
  }
  return result;
}
