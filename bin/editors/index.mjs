import * as cursor from './cursor.mjs'

/** Ordered editor adapters. Add a module here to install skills for another editor. */
export const editors = [cursor]

export function installEditors(projectRoot) {
  return editors.map((editor) => editor.install(projectRoot))
}
