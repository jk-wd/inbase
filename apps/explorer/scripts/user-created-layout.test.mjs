import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

const nodeMajor = Number(process.versions.node.split('.')[0])
const canLoadTs = nodeMajor >= 22

if (!canLoadTs) {
  test(
    'nested blueprint folders across layers',
    { skip: 'loads TypeScript source on Node 22+' },
    () => {},
  )
} else {
  await register('./ts-resolve.mjs', import.meta.url)

  const {
    layoutBlueprintLayers,
    moveCreatedItems,
    sortCreatedIslandsParentFirst,
    withUserCreatedGraph,
    withUserCreatedLayout,
  } = await import('../src/userCreated.ts')

  const src = {
    id: 'src',
    name: 'src',
    path: 'src',
    parent: '.',
  }

  const lambda = {
    id: 'src/lambda',
    name: 'lambda',
    path: 'src/lambda',
    parent: 'src',
  }

  function emptyGraph() {
    return {
      root: '.',
      targetName: 'app',
      files: [],
      folders: [
        {
          path: '.',
          name: 'app',
          parent: null,
          files: [],
          children: [],
        },
      ],
    }
  }

  function emptyLayout() {
    return {
      files: {},
      folders: {
        '.': {
          path: '.',
          name: 'app',
          x: 0,
          z: 0,
          width: 40,
          depth: 12,
        },
      },
      bridges: [],
      spawn: [0, 0, 0],
    }
  }

  test('sortCreatedIslandsParentFirst puts parent folders before nested children', () => {
    const ordered = sortCreatedIslandsParentFirst([lambda, src])
    assert.deepEqual(
      ordered.map((island) => island.path),
      ['src', 'src/lambda'],
    )
  })

  test('withUserCreatedGraph links a nested folder even when it is listed first', () => {
    const graph = withUserCreatedGraph(emptyGraph(), [], [lambda, src])
    const parent = graph.folders.find((folder) => folder.path === 'src')
    const child = graph.folders.find((folder) => folder.path === 'src/lambda')
    assert.ok(parent)
    assert.ok(child)
    assert.equal(child.parent, 'src')
    assert.ok(parent.children.includes('src/lambda'))
  })

  test('withUserCreatedLayout places a nested folder whose parent is listed later', () => {
    const layout = withUserCreatedLayout(emptyLayout(), [], [lambda, src])
    assert.ok(layout.folders.src)
    assert.ok(layout.folders['src/lambda'])
    assert.ok(
      layout.bridges.some(
        (bridge) => bridge.id === 'src→src/lambda' || bridge.label === 'lambda',
      ),
    )
  })

  test('moveCreatedItems moves a file and its notes onto another color', () => {
    const source = {
      blocks: [
        {
          id: 'src/New.tsx',
          name: 'New.tsx',
          path: 'src/New.tsx',
          folder: 'src',
        },
      ],
      islands: [],
      functions: [{ file: 'src/New.tsx', name: 'render' }],
      variables: [],
      imports: [],
      notes: [{ file: 'src/New.tsx', kind: 'file', note: 'build this' }],
      pointers: [{ kind: 'file', path: 'src/New.tsx' }],
    }
    const dest = {
      blocks: [],
      islands: [],
      functions: [],
      variables: [],
      imports: [],
      notes: [],
      pointers: [],
    }
    const moved = moveCreatedItems(source, dest, ['src/New.tsx'])
    assert.deepEqual(moved.source.blocks, [])
    assert.deepEqual(moved.source.notes, [])
    assert.equal(moved.dest.blocks[0]?.id, 'src/New.tsx')
    assert.equal(moved.dest.functions[0]?.name, 'render')
    assert.equal(moved.dest.notes[0]?.note, 'build this')
    assert.equal(moved.dest.pointers[0]?.path, 'src/New.tsx')
  })

  test('moveCreatedItems moves a folder and nested files together', () => {
    const source = {
      blocks: [
        {
          id: 'src/lambda/handler.ts',
          name: 'handler.ts',
          path: 'src/lambda/handler.ts',
          folder: 'src/lambda',
        },
      ],
      islands: [src, lambda],
      functions: [],
      variables: [],
      imports: [],
      notes: [{ file: 'src/lambda', kind: 'folder', note: 'new service' }],
      pointers: [],
    }
    const dest = {
      blocks: [],
      islands: [],
      functions: [],
      variables: [],
      imports: [],
      notes: [],
      pointers: [],
    }
    const moved = moveCreatedItems(
      source,
      dest,
      ['src/lambda/handler.ts'],
      ['src', 'src/lambda'],
    )
    assert.deepEqual(moved.source.blocks, [])
    assert.deepEqual(moved.source.islands, [])
    assert.equal(moved.dest.islands.length, 2)
    assert.equal(moved.dest.blocks[0]?.id, 'src/lambda/handler.ts')
    assert.equal(moved.dest.notes[0]?.file, 'src/lambda')
  })

  test('layoutBlueprintLayers nests a folder from another blueprint inside a later parent layer', () => {
    const layers = layoutBlueprintLayers(emptyLayout(), [
      {
        id: 'coral',
        hex: '#f87171',
        blocks: [],
        islands: [lambda],
      },
      {
        id: 'global',
        hex: '#38bdf8',
        blocks: [],
        islands: [src],
      },
    ])
    const coral = layers.find((layer) => layer.id === 'coral')
    const global = layers.find((layer) => layer.id === 'global')
    assert.ok(global?.folders.src)
    assert.ok(coral?.folders['src/lambda'])
  })
}
