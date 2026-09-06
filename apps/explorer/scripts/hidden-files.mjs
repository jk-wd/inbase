export function isHiddenPath(relative) {
  return String(relative ?? '')
    .split('/')
    .filter(Boolean)
    .some((part) => part.startsWith('.') && part !== '.')
}

function folderParent(folderPath) {
  if (!folderPath || folderPath === '.') return null
  return folderPath.includes('/')
    ? folderPath.split('/').slice(0, -1).join('/')
    : '.'
}

function folderOfFile(fileId) {
  return fileId.includes('/') ? fileId.split('/').slice(0, -1).join('/') : '.'
}

/** Drop dotfiles and folders whose names start with `.`, except user-created items. */
export function filterGraphHiddenFiles(graph) {
  const keepFiles = new Set(
    graph.files
      .filter((file) => file.userCreated || !isHiddenPath(file.id))
      .map((file) => file.id),
  )
  const paths = new Set(['.'])
  const filesById = new Map(graph.files.map((file) => [file.id, file]))
  const addAncestors = (start) => {
    let current = start
    while (current) {
      paths.add(current)
      current = folderParent(current)
    }
  }
  for (const id of keepFiles) {
    const file = filesById.get(id)
    addAncestors(file?.folder ?? folderOfFile(id))
  }
  for (const folder of graph.folders) {
    if (folder.userCreated) addAncestors(folder.path)
  }
  return {
    ...graph,
    files: graph.files.filter((file) => keepFiles.has(file.id)),
    folders: graph.folders
      .filter((folder) => paths.has(folder.path))
      .map((folder) => ({
        ...folder,
        files: folder.files.filter((id) => keepFiles.has(id)),
        children: folder.children.filter((path) => paths.has(path)),
      })),
  }
}
