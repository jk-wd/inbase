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
