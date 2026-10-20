import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

const nodeMajor = Number(process.versions.node.split('.')[0])
const canLoadTs = nodeMajor >= 22

if (!canLoadTs) {
  test('map island rows', { skip: 'loads TypeScript source on Node 22+' }, () => {})
} else {
  await register('./ts-resolve.mjs', import.meta.url)
  const { layoutWorld, withPreviewLayout, placePreviewCreates } = await import(
    '../src/layout.ts'
  )

  function file(id, folder) {
    return {
      id,
      name: id.split('/').pop(),
      path: id,
      folder,
      lines: 10,
      language: 'ts',
      symbols: [],
      imports: [],
    }
  }

  function folder(path, name, parent, files, children) {
    return { path, name, parent, files, children }
  }

  const quietFiles = ['a/one.ts', 'a/two.ts']
  const busyFiles = Array.from({ length: 8 }, (_, index) => `b/file-${index}.ts`)

  const graph = {
    root: '.',
    targetName: 'app',
    files: [
      ...quietFiles.map((id) => file(id, 'a')),
      ...busyFiles.map((id) => file(id, 'b')),
      file('a/child/x.ts', 'a/child'),
      file('b/child/x.ts', 'b/child'),
    ],
    folders: [
      folder('.', 'app', null, [], ['a', 'b']),
      folder('a', 'a', '.', quietFiles, ['a/child']),
      folder('b', 'b', '.', busyFiles, ['b/child']),
      folder('a/child', 'child', 'a', ['a/child/x.ts'], []),
      folder('b/child', 'child', 'b', ['b/child/x.ts'], []),
    ],
  }

  function blockBottom(placed) {
    return placed.position[2] + placed.size[2] / 2
  }

  test('a sibling row grows to the busiest island and keeps blocks inside', () => {
    const layout = layoutWorld(graph)
    const quiet = layout.folders.a
    const busy = layout.folders.b
    assert.ok(busy.depth > quiet.depth - 0.001)
    assert.equal(quiet.depth, busy.depth)
    assert.equal(layout.folders['a/child'].z, layout.folders['b/child'].z)

    for (const id of [...quietFiles, ...busyFiles]) {
      const placed = layout.files[id]
      const island = id.startsWith('a/') ? quiet : busy
      assert.ok(blockBottom(placed) <= island.z + island.depth)
      assert.ok(placed.position[2] - placed.size[2] / 2 >= island.z)
    }
  })

  test('preview files grow the island they land on and the rest of that row', () => {
    const layout = layoutWorld(graph)
    const before = layout.folders.a.depth
    const extra = Array.from({ length: 10 }, (_, index) => `a/extra-${index}.ts`)
    const overlay = placePreviewCreates(graph, layout, extra)
    const next = withPreviewLayout(layout, overlay)
    assert.ok(next.folders.a.depth > before)
    assert.equal(next.folders.a.depth, next.folders.b.depth)
    for (const id of [extra[0], extra[extra.length - 1]]) {
      const placed = next.files[id]
      assert.ok(blockBottom(placed) <= next.folders.a.z + next.folders.a.depth)
    }
    assert.equal(next.folders['a/child'].z, next.folders['b/child'].z)
    assert.equal(layout.folders.a.depth, before)
  })
}
