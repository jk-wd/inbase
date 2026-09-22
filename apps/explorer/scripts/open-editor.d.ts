export function configuredEditorId(editorId?: string | null): string | null
export function editorFileUri(filePath: string, editorId?: string | null): string
export function defaultCursorUserDataDir(): string
export function discoverCursorUserDataDirs(): string[]
export function openFoldersFromStorage(storage: unknown): string[]
export function cursorUserDataDirForFile(filePath: string): string | null
export function openInEditor(filePath: string, editorId?: string | null): boolean
