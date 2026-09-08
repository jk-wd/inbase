import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cleanupProject, initProject, isCliEntry, main } from './inbase.mjs'
import { editors } from './editors/index.mjs'
import { CURSOR_INBASE_ALLOW_INSTRUCTION } from './editors/cursor.mjs'
import { prependYamlFrontmatter, copySkillTree } from './editors/layout.mjs'
import { stripYamlFrontmatter, toClineExecuteCommand } from './editors/cline.mjs'
import {
  applyHostEnv,
  copyDir,
  ensureDataDir,
  ensureGitignoreEntry,
  globalInbaseDir,
  removeGitignoreEntry,
  skillTemplateDir,
  writeRunningInstance,
} from './project.mjs'
import { initGitRepo, runGit } from '../apps/explorer/scripts/git-test.mjs'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function tempProject() {
  const root = fs.mkdtempSync(path.join(packageRoot, '.tmp-cli-'))
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

function snapshotEnv(...keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]))
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

test('registers Cursor, Claude Code, Agent Skills, Copilot, and Cline adapters', () => {
  assert.deepEqual(
    editors.map((editor) => editor.id),
    ['cursor', 'claude', 'agents', 'copilot', 'cline'],
  )
})

test('Cline command markdown becomes execute_command XML', () => {
  const xml = toClineExecuteCommand(
    'Run:\n\n```bash\nnpx inbase accept --session "<session-id>"\n```\n',
  )
  assert.match(xml, /<execute_command>/)
  assert.match(xml, /<command>npx inbase accept --session "SESSION_ID"<\/command>/)
  assert.match(xml, /<requires_approval>false<\/requires_approval>/)
  assert.equal(stripYamlFrontmatter('---\nname: inbase\n---\n\nBody\n'), 'Body\n')
})

test('prependYamlFrontmatter inserts keys once', () => {
  const { root, cleanup } = tempProject()
  try {
    const file = path.join(root, 'SKILL.md')
    fs.writeFileSync(file, '---\nname: inbase\n---\n\nBody\n')
    prependYamlFrontmatter(file, ['user-invocable: false', 'name: inbase'])
    prependYamlFrontmatter(file, ['user-invocable: false'])
    assert.equal(
      fs.readFileSync(file, 'utf8'),
      '---\nuser-invocable: false\nname: inbase\n---\n\nBody\n',
    )
  } finally {
    cleanup()
  }
})

test('copyDir installs the skill template', () => {
  const { root, cleanup } = tempProject()
  try {
    const dest = path.join(root, 'skills/inbase')
    copyDir(skillTemplateDir, dest)
    const skillText = fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')
    assert.match(skillText, /npx inbase attach/)
    assert.match(skillText, /VISUAL_CODER_ACK/)
    assert.match(skillText, /Direct response/)
    assert.match(skillText, /VISUAL_CODER_NOT_RUNNING/)
    assert.match(skillText, /VISUAL_CODER_CHAT_LIMIT/)
    assert.match(skillText, /VISUAL_CODER_COLOR/)
    assert.match(skillText, /Connecting to the Coral session/)
    assert.match(skillText, /I see on the blueprint/)
    assert.match(skillText, /VISUAL_CODER_BLUEPRINT_ONLY/)
    assert.match(skillText, /VISUAL_CODER_NO_REQUEST/)
    assert.match(skillText, /VISUAL_CODER_DIFF/)
    assert.match(skillText, /Always work via the plan/)
    assert.match(skillText, /Do not ask the user to review or `\/accept` a mid-plan step/)
    assert.match(skillText, /Keep the applied project files/)
    assert.match(skillText, /from the point of the last proposal/)
    assert.match(skillText, /replaces the waiting proposal/)
    assert.match(skillText, /close the session/)
    assert.match(skillText, /Stay in this session/)
    assert.match(skillText, /never attach again/)
    assert.match(skillText, /starts clean/)
    assert.match(skillText, /different empty slot/)
    assert.match(skillText, /do \*\*not\*\* restart from step 1/)
    assert.match(skillText, /`\.claude`/)
    assert.match(skillText, /`\.agents`/)
    assert.match(skillText, /`\.cline`/)
    assert.match(skillText, /`\.clinerules`/)
    assert.match(skillText, /`\.github\/skills`/)
    assert.match(skillText, /\/extract-blueprint/)
    assert.match(skillText, /\/stop/)
    assert.match(skillText, /Do not prefix it with/)
    assert.match(skillText, /not wait for the user to click Run/)
    assert.match(skillText, /or wait for the user to approve `propose-patch`/)
    assert.doesNotMatch(skillText, /\/go/)
    assert.doesNotMatch(skillText, /user-invocable:/)
    assert.doesNotMatch(skillText, /allowed-tools:/)
  } finally {
    cleanup()
  }
})

test('init copies editor skills and gitignores .inbase', () => {
  const { root, cleanup } = tempProject()
  const env = snapshotEnv('VISUAL_CODER_TARGET', 'INBASE_DATA_DIR', 'INBASE_CONFIG')
  try {
    const result = initProject(root)
    fs.writeFileSync(path.join(root, '.cursor/commands/accept.md'), 'legacy /accept command\n')
    fs.writeFileSync(path.join(root, '.cursor/commands/go.md'), 'retired /go command\n')
    initProject(root)
    const skill = path.join(root, '.cursor/skills/inbase/SKILL.md')
    assert.equal(result.skillDir, path.join(root, '.cursor/skills/inbase'))
    assert.deepEqual(
      result.editors.map((editor) => editor.id),
      ['cursor', 'claude', 'agents', 'copilot', 'cline'],
    )
    assert.equal(fs.existsSync(skill), true)
    const skillText = fs.readFileSync(skill, 'utf8')
    assert.match(skillText, /npx inbase attach/)
    assert.match(skillText, /VISUAL_CODER_ACK/)
    assert.match(skillText, /VISUAL_CODER_NOT_RUNNING/)
    assert.match(skillText, /VISUAL_CODER_CHAT_LIMIT/)
    assert.match(skillText, /VISUAL_CODER_COLOR/)
    assert.match(skillText, /\/accept/)
    assert.doesNotMatch(skillText, /\/go/)
    assert.match(skillText, /\/explain/)
    assert.match(skillText, /\/stop/)
    assert.match(skillText, /I see on the blueprint/)
    assert.match(skillText, /VISUAL_CODER_BLUEPRINT_ONLY/)
    assert.match(skillText, /VISUAL_CODER_NO_REQUEST/)
    assert.match(skillText, /VISUAL_CODER_DIFF/)
    assert.match(skillText, /Always work via the plan/)
    assert.match(skillText, /Do not ask the user to review or `\/accept` a mid-plan step/)
    assert.match(skillText, /Keep the applied project files/)
    assert.match(skillText, /from the point of the last proposal/)
    assert.match(skillText, /replaces the waiting proposal/)
    assert.match(skillText, /close the session/)
    assert.match(skillText, /Stay in this session/)
    assert.match(skillText, /never attach again/)
    assert.match(skillText, /starts clean/)
    assert.match(skillText, /different empty slot/)
    assert.match(skillText, /do \*\*not\*\* restart from step 1/)
    assert.match(skillText, /`\.claude`/)
    assert.match(skillText, /`\.agents`/)
    assert.match(skillText, /`\.cline`/)
    assert.match(skillText, /`\.clinerules`/)
    assert.match(skillText, /`\.github\/skills`/)
    assert.match(skillText, /\/extract-blueprint/)
    assert.doesNotMatch(skillText, /npx inbase wait-for-approval/)
    assert.doesNotMatch(skillText, /npx inbase explain wait/)
    assert.doesNotMatch(skillText, /direct chat interaction not allowed/)
    assert.doesNotMatch(skillText, /npx inbase start-session/)
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/inbase.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/inbase.md'), 'utf8'),
      /npx inbase attach/,
    )
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/inbase.md'), 'utf8'),
      /If this chat has no request text/,
    )
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/inbase.md'), 'utf8'),
      /already printed `VISUAL_CODER_SESSION`/,
    )
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/coral.md'), 'utf8'),
      /already printed `VISUAL_CODER_SESSION`/,
    )
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/skipinbase.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/skipinbase.md'), 'utf8'),
      /\$ARGUMENTS/,
    )
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/explain.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/explain.md'), 'utf8'),
      /npx inbase explain start/,
    )
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/extract-blueprint.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/extract-blueprint.md'), 'utf8'),
      /npx inbase extract-blueprint/,
    )
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/extract-blueprint.md'), 'utf8'),
      /Do \*\*not\*\* attach/,
    )
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/extract-blueprint.md'), 'utf8'),
      /Do not extract everything/,
    )
    assert.doesNotMatch(
      fs.readFileSync(path.join(root, '.cursor/commands/explain.md'), 'utf8'),
      /npx inbase explain wait/,
    )
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/explain.md'), 'utf8'),
      /VISUAL_CODER_PROPOSAL/,
    )
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/explain.md'), 'utf8'),
      /VISUAL_CODER_DIFF/,
    )
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/go.md')), false)
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/accept.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/accept.md'), 'utf8'),
      /npx inbase accept/,
    )
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/stop.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/stop.md'), 'utf8'),
      /npx inbase stop/,
    )
    assert.doesNotMatch(
      fs.readFileSync(path.join(root, '.cursor/commands/accept.md'), 'utf8'),
      /\/go/,
    )
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/accept.md'), 'utf8'),
      /last proposal/,
    )
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/accept.md'), 'utf8'),
      /VISUAL_CODER_FINISHED/,
    )
    assert.doesNotMatch(
      fs.readFileSync(path.join(root, '.cursor/commands/accept.md'), 'utf8'),
      /legacy \/accept command/,
    )
    assert.equal(fs.existsSync(path.join(packageRoot, 'skill/commands/accept.md')), true)
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/coral.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/coral.md'), 'utf8'),
      /npx inbase attach --color coral/,
    )
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/coral.md'), 'utf8'),
      /If `\$ARGUMENTS` is empty/,
    )
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/coral.md'), 'utf8'),
      /I see on the blueprint/,
    )
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/violet.md'), 'utf8'),
      /If `\$ARGUMENTS` is empty/,
    )
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/red.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/red.md'), 'utf8'),
      /npx inbase attach --color red/,
    )
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/blue.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/blue.md'), 'utf8'),
      /global blueprint/,
    )
    assert.doesNotMatch(skillText, /user-invocable:/)
    assert.doesNotMatch(skillText, /allowed-tools:/)
    const permissions = JSON.parse(
      fs.readFileSync(path.join(root, '.cursor/permissions.json'), 'utf8'),
    )
    assert.deepEqual(permissions.autoRun.allow_instructions, [
      CURSOR_INBASE_ALLOW_INSTRUCTION,
    ])
    const sandbox = JSON.parse(
      fs.readFileSync(path.join(root, '.cursor/sandbox.json'), 'utf8'),
    )
    assert.equal(sandbox.enableSharedBuildCache, true)
    assert.doesNotMatch(
      fs.readFileSync(path.join(root, '.cursor/commands/accept.md'), 'utf8'),
      /disable-model-invocation:/,
    )
    const claude = result.editors.find((editor) => editor.id === 'claude')
    assert.equal(claude?.label, 'Claude Code')
    assert.equal(claude?.skillDir, path.join(root, '.claude/skills/inbase'))
    assert.equal(claude?.commandDir, path.join(root, '.claude/commands'))
    const claudeSkill = fs.readFileSync(
      path.join(root, '.claude/skills/inbase/SKILL.md'),
      'utf8',
    )
    assert.match(claudeSkill, /npx inbase attach/)
    assert.match(claudeSkill, /user-invocable: false/)
    assert.equal(claudeSkill.split('user-invocable: false').length - 1, 1)
    assert.match(claudeSkill, /allowed-tools: Bash\(npx inbase \*\)/)
    assert.equal(fs.existsSync(path.join(root, '.claude/commands/inbase.md')), true)
    assert.equal(fs.existsSync(path.join(root, '.claude/commands/coral.md')), true)
    const claudeGo = fs.readFileSync(path.join(root, '.claude/commands/accept.md'), 'utf8')
    assert.match(claudeGo, /npx inbase accept/)
    assert.match(claudeGo, /disable-model-invocation: true/)
    assert.match(claudeGo, /allowed-tools: Bash\(npx inbase \*\)/)
    const claudeCoral = fs.readFileSync(
      path.join(root, '.claude/commands/coral.md'),
      'utf8',
    )
    assert.match(claudeCoral, /npx inbase attach --color coral/)
    assert.match(claudeCoral, /disable-model-invocation: true/)
    const agents = result.editors.find((editor) => editor.id === 'agents')
    assert.equal(agents?.label, 'Agent Skills')
    assert.equal(agents?.skillDir, path.join(root, '.agents/skills/inbase'))
    assert.equal(fs.existsSync(path.join(root, '.agents/skills/accept/SKILL.md')), true)
    assert.equal(fs.existsSync(path.join(root, '.agents/skills/stop/SKILL.md')), true)
    assert.equal(
      fs.existsSync(path.join(root, '.agents/skills/extract-blueprint/SKILL.md')),
      true,
    )
    const agentsSkill = fs.readFileSync(
      path.join(root, '.agents/skills/inbase/SKILL.md'),
      'utf8',
    )
    assert.match(agentsSkill, /Always work via the plan/)
    const copilot = result.editors.find((editor) => editor.id === 'copilot')
    assert.equal(copilot?.label, 'GitHub Copilot')
    assert.equal(copilot?.skillDir, path.join(root, '.github/skills/inbase'))
    assert.equal(fs.existsSync(path.join(root, '.github/skills/coral/SKILL.md')), true)
    const cline = result.editors.find((editor) => editor.id === 'cline')
    assert.equal(cline?.label, 'Cline')
    assert.equal(cline?.skillDir, path.join(root, '.cline/skills/inbase'))
    assert.equal(cline?.commandDir, path.join(root, '.cline/workflows'))
    assert.equal(fs.existsSync(path.join(root, '.cline/skills/accept/SKILL.md')), false)
    fs.mkdirSync(path.join(root, '.cline/skills/accept'), { recursive: true })
    fs.writeFileSync(path.join(root, '.cline/skills/accept/SKILL.md'), 'legacy command skill\n')
    initProject(root)
    assert.equal(fs.existsSync(path.join(root, '.cline/skills/accept/SKILL.md')), false)
    assert.equal(fs.existsSync(path.join(root, '.cline/workflows/accept.md')), true)
    assert.equal(fs.existsSync(path.join(root, '.cline/workflows/coral.md')), true)
    assert.equal(fs.existsSync(path.join(root, '.clinerules/workflows')), false)
    assert.equal(fs.existsSync(path.join(root, '.clinerules/skills')), false)
    assert.equal(fs.statSync(path.join(root, '.clinerules')).isFile(), true)
    const clineSkill = fs.readFileSync(
      path.join(root, '.cline/skills/inbase/SKILL.md'),
      'utf8',
    )
    assert.match(clineSkill, /npx inbase attach/)
    assert.match(clineSkill, /<execute_command>/)
    assert.doesNotMatch(clineSkill, /allowed-tools:/)
    const clineRootSkill = fs.readFileSync(path.join(root, '.cline/SKILL.md'), 'utf8')
    assert.match(clineRootSkill, /^---\nname: inbase\n/)
    assert.match(clineRootSkill, /<execute_command>/)
    const clineAccept = fs.readFileSync(
      path.join(root, '.cline/workflows/accept.md'),
      'utf8',
    )
    assert.match(clineAccept, /npx inbase accept/)
    const clineRule = fs.readFileSync(path.join(root, '.cline/rules/inbase.md'), 'utf8')
    assert.match(clineRule, /<execute_command>/)
    assert.match(clineRule, /npx inbase attach/)
    assert.match(clineRule, /SESSION_ID/)
    assert.match(clineRule, /I see on the blueprint/)
    assert.match(clineRule, /\/extract-blueprint/)
    assert.match(clineAccept, /<execute_command>/)
    assert.match(clineAccept, /npx inbase accept --session "SESSION_ID"/)
    assert.equal(fs.statSync(path.join(root, '.clinerules')).isFile(), true)
    assert.match(
      fs.readFileSync(path.join(root, '.clinerules'), 'utf8'),
      /<execute_command>/,
    )
    fs.rmSync(path.join(root, '.clinerules'))
    fs.mkdirSync(path.join(root, '.clinerules/workflows'), { recursive: true })
    fs.writeFileSync(path.join(root, '.clinerules/inbase.md'), 'legacy folder rule\n')
    initProject(root)
    assert.equal(fs.statSync(path.join(root, '.clinerules')).isFile(), true)
    assert.equal(fs.existsSync(path.join(root, '.clinerules/inbase.md')), false)
    assert.equal(fs.existsSync(path.join(root, '.inbase/user-context.json')), true)
    assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /\.inbase\//)
    assert.equal(result.configAdded, true)
    const config = JSON.parse(fs.readFileSync(path.join(root, 'inbase.json'), 'utf8'))
    assert.equal(config.target, '.')
    assert.equal(config.port, 5173)
    assert.deepEqual(config.ignore, [])
    assert.equal(initProject(root).configAdded, false)
  } finally {
    restoreEnv(env)
    cleanup()
  }
})

test('init cline installs only Cline files', () => {
  const { root, cleanup } = tempProject()
  const env = snapshotEnv('VISUAL_CODER_TARGET', 'INBASE_DATA_DIR', 'INBASE_CONFIG')
  try {
    const result = initProject(root, 'cline')
    assert.deepEqual(
      result.editors.map((editor) => editor.id),
      ['cline'],
    )
    assert.equal(fs.existsSync(path.join(root, '.cline/skills/inbase/SKILL.md')), true)
    assert.equal(fs.existsSync(path.join(root, '.clinerules')), true)
    assert.equal(fs.existsSync(path.join(root, '.cursor/skills/inbase/SKILL.md')), false)
    assert.equal(fs.existsSync(path.join(root, '.claude/skills/inbase/SKILL.md')), false)
    assert.equal(fs.existsSync(path.join(root, '.agents/skills/inbase/SKILL.md')), false)
    assert.equal(fs.existsSync(path.join(root, '.github/skills/inbase/SKILL.md')), false)
    assert.throws(() => initProject(root, 'vim'), /Unknown editor 'vim'/)
    const codex = initProject(root, 'codex')
    assert.deepEqual(
      codex.editors.map((editor) => editor.id),
      ['agents'],
    )
    assert.equal(fs.existsSync(path.join(root, '.agents/skills/inbase/SKILL.md')), true)
  } finally {
    restoreEnv(env)
    cleanup()
  }
})

test('copySkillTree writes command skills and keeps the inbase skill', () => {
  const { root, cleanup } = tempProject()
  try {
    const first = copySkillTree(root, { id: 'agents', skillsRel: '.agents/skills' })
    copySkillTree(root, { id: 'agents', skillsRel: '.agents/skills' })
    assert.equal(first.skillDir, path.join(root, '.agents/skills/inbase'))
    assert.equal(first.commandDir, path.join(root, '.agents/skills'))
    const skillText = fs.readFileSync(path.join(first.skillDir, 'SKILL.md'), 'utf8')
    assert.match(skillText, /Always work via the plan/)
    assert.match(skillText, /allowed-tools: Bash\(npx inbase \*\)/)
    assert.equal(skillText.split('allowed-tools: Bash(npx inbase *)').length - 1, 1)
    assert.doesNotMatch(skillText, /user-invocable:/)
    assert.equal(fs.existsSync(path.join(first.commandDir, 'inbase.md')), false)
    const accept = fs.readFileSync(path.join(first.commandDir, 'accept/SKILL.md'), 'utf8')
    assert.match(accept, /^---\nname: accept\n/)
    assert.match(accept, /npx inbase accept/)
    assert.match(accept, /disable-model-invocation: true/)
    assert.match(accept, /allow_implicit_invocation: false/)
    assert.equal(accept.split('disable-model-invocation: true').length - 1, 1)
    assert.equal(fs.existsSync(path.join(first.commandDir, 'go/SKILL.md')), false)
    fs.mkdirSync(path.join(root, '.agents/skills/go'), { recursive: true })
    fs.writeFileSync(path.join(root, '.agents/skills/go/SKILL.md'), 'retired /go\n')
    copySkillTree(root, { id: 'agents', skillsRel: '.agents/skills' })
    assert.equal(fs.existsSync(path.join(root, '.agents/skills/go/SKILL.md')), false)
    const coral = fs.readFileSync(path.join(first.commandDir, 'coral/SKILL.md'), 'utf8')
    assert.match(coral, /npx inbase attach --color coral/)
    assert.match(coral, /name: coral/)
    assert.match(coral, /\$ARGUMENTS/)
  } finally {
    cleanup()
  }
})

test('Cursor init auto-runs Inbase CLI and preserves other permissions', () => {
  const { root, cleanup } = tempProject()
  const env = snapshotEnv('VISUAL_CODER_TARGET', 'INBASE_DATA_DIR', 'INBASE_CONFIG')
  try {
    fs.mkdirSync(path.join(root, '.cursor'), { recursive: true })
    fs.writeFileSync(
      path.join(root, '.cursor/permissions.json'),
      `${JSON.stringify(
        {
          autoRun: {
            allow_instructions: ['Keep this existing allow rule.'],
            block_instructions: ['Keep this existing block rule.'],
          },
        },
        null,
        2,
      )}\n`,
    )
    fs.writeFileSync(
      path.join(root, '.cursor/sandbox.json'),
      `${JSON.stringify({ networkPolicy: { default: 'deny' } }, null, 2)}\n`,
    )
    initProject(root, 'cursor')
    initProject(root, 'cursor')
    const permissions = JSON.parse(
      fs.readFileSync(path.join(root, '.cursor/permissions.json'), 'utf8'),
    )
    assert.deepEqual(permissions.autoRun.allow_instructions, [
      'Keep this existing allow rule.',
      CURSOR_INBASE_ALLOW_INSTRUCTION,
    ])
    assert.deepEqual(permissions.autoRun.block_instructions, [
      'Keep this existing block rule.',
    ])
    const sandbox = JSON.parse(
      fs.readFileSync(path.join(root, '.cursor/sandbox.json'), 'utf8'),
    )
    assert.equal(sandbox.enableSharedBuildCache, true)
    assert.deepEqual(sandbox.networkPolicy, { default: 'deny' })
    cleanupProject(root, 'cursor')
    const leftover = JSON.parse(
      fs.readFileSync(path.join(root, '.cursor/permissions.json'), 'utf8'),
    )
    assert.deepEqual(leftover, {
      autoRun: {
        allow_instructions: ['Keep this existing allow rule.'],
        block_instructions: ['Keep this existing block rule.'],
      },
    })
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(root, '.cursor/sandbox.json'), 'utf8')),
      { networkPolicy: { default: 'deny' }, enableSharedBuildCache: true },
    )
  } finally {
    restoreEnv(env)
    cleanup()
  }
})

test('gitignore helper is idempotent', () => {
  const { root, cleanup } = tempProject()
  try {
    assert.equal(ensureGitignoreEntry(root), true)
    assert.equal(ensureGitignoreEntry(root), false)
    const text = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
    assert.equal(text.split('.inbase/').length - 1, 1)
  } finally {
    cleanup()
  }
})

test('init appends .inbase to an existing gitignore', () => {
  const { root, cleanup } = tempProject()
  const env = snapshotEnv('VISUAL_CODER_TARGET', 'INBASE_DATA_DIR', 'INBASE_CONFIG')
  try {
    const gitignore = path.join(root, '.gitignore')
    fs.writeFileSync(gitignore, 'node_modules/\ndist\n*.local')
    assert.equal(ensureGitignoreEntry(root), true)
    assert.equal(ensureGitignoreEntry(root), false)
    initProject(root)
    assert.equal(
      fs.readFileSync(gitignore, 'utf8'),
      'node_modules/\ndist\n*.local\n.inbase/\n',
    )
  } finally {
    restoreEnv(env)
    cleanup()
  }
})

test('gitignore helper can remove the .inbase entry', () => {
  const { root, cleanup } = tempProject()
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n.inbase/\ndist\n')
    assert.equal(removeGitignoreEntry(root), true)
    assert.equal(removeGitignoreEntry(root), false)
    assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'node_modules/\ndist\n')
    fs.writeFileSync(path.join(root, '.gitignore'), '.inbase/\n')
    assert.equal(removeGitignoreEntry(root), true)
    assert.equal(fs.existsSync(path.join(root, '.gitignore')), false)
  } finally {
    cleanup()
  }
})

test('cleanup reverses init and keeps unrelated editor files', () => {
  const { root, cleanup } = tempProject()
  const env = snapshotEnv('VISUAL_CODER_TARGET', 'INBASE_DATA_DIR', 'INBASE_CONFIG')
  try {
    fs.mkdirSync(path.join(root, '.cursor/commands'), { recursive: true })
    fs.mkdirSync(path.join(root, '.cursor/skills/other'), { recursive: true })
    fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true })
    fs.writeFileSync(path.join(root, '.cursor/commands/mine.md'), 'my command\n')
    fs.writeFileSync(path.join(root, '.cursor/skills/other/SKILL.md'), 'other skill\n')
    fs.writeFileSync(path.join(root, '.github/workflows/ci.yml'), 'name: ci\n')
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n')
    initProject(root)
    const result = cleanupProject(root)
    assert.equal(result.dataDirRemoved, true)
    assert.equal(result.configRemoved, true)
    assert.equal(result.gitignoreRemoved, true)
    assert.equal(fs.existsSync(path.join(root, '.cursor/skills/inbase')), false)
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/accept.md')), false)
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/blue.md')), false)
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/skipinbase.md')), false)
    assert.equal(fs.existsSync(path.join(root, '.claude')), false)
    assert.equal(fs.existsSync(path.join(root, '.agents')), false)
    assert.equal(fs.existsSync(path.join(root, '.cline')), false)
    assert.equal(fs.existsSync(path.join(root, '.clinerules')), false)
    assert.equal(fs.existsSync(path.join(root, '.github/skills')), false)
    assert.equal(fs.existsSync(path.join(root, '.inbase')), false)
    assert.equal(fs.existsSync(path.join(root, 'inbase.json')), false)
    assert.equal(fs.existsSync(path.join(root, '.cursor/permissions.json')), false)
    assert.equal(fs.existsSync(path.join(root, '.cursor/sandbox.json')), false)
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/mine.md')), true)
    assert.equal(fs.existsSync(path.join(root, '.cursor/skills/other/SKILL.md')), true)
    assert.equal(fs.existsSync(path.join(root, '.github/workflows/ci.yml')), true)
    assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'node_modules/\n')
    const again = initProject(root)
    assert.equal(fs.existsSync(path.join(again.skillDir, 'SKILL.md')), true)
    assert.equal(again.configAdded, true)
  } finally {
    restoreEnv(env)
    cleanup()
  }
})

test('cleanup removes leftover skills and rules', () => {
  const { root, cleanup } = tempProject()
  const env = snapshotEnv('VISUAL_CODER_TARGET', 'INBASE_DATA_DIR', 'INBASE_CONFIG')
  try {
    initProject(root)
    fs.mkdirSync(path.join(root, '.cursor/skills/visual-edits'), { recursive: true })
    fs.writeFileSync(
      path.join(root, '.cursor/skills/visual-edits/SKILL.md'),
      'Use npx inbase attach for visual edits.\n',
    )
    fs.mkdirSync(path.join(root, '.cursor/rules'), { recursive: true })
    fs.writeFileSync(path.join(root, '.cursor/rules/inbase.mdc'), 'alwaysApply: true\n')
    fs.writeFileSync(
      path.join(root, '.cursor/rules/visual-edits.mdc'),
      'After VISUAL_CODER_EXECUTE, run npx inbase propose-patch.\n',
    )
    fs.writeFileSync(path.join(root, '.cursor/rules/style.mdc'), 'Use 2-space indent.\n')
    fs.mkdirSync(path.join(root, '.claude/rules'), { recursive: true })
    fs.writeFileSync(
      path.join(root, '.claude/rules/inbase.md'),
      'Run npx inbase attach before edits.\n',
    )
    fs.mkdirSync(path.join(root, '.agents/skills/visual-edits'), { recursive: true })
    fs.writeFileSync(
      path.join(root, '.agents/skills/visual-edits/SKILL.md'),
      'Follow npx inbase attach. Stay in this session.\n',
    )
    fs.mkdirSync(path.join(root, '.cline/skills/accept'), { recursive: true })
    fs.writeFileSync(
      path.join(root, '.cline/skills/accept/SKILL.md'),
      'Run npx inbase accept --session SESSION_ID\n',
    )
    fs.rmSync(path.join(root, '.clinerules'))
    fs.mkdirSync(path.join(root, '.clinerules/workflows'), { recursive: true })
    fs.writeFileSync(
      path.join(root, '.clinerules/inbase.md'),
      'legacy Inbase folder rule with npx inbase attach\n',
    )

    cleanupProject(root)

    assert.equal(fs.existsSync(path.join(root, '.cursor/skills/inbase')), false)
    assert.equal(fs.existsSync(path.join(root, '.cursor/skills/visual-edits')), false)
    assert.equal(fs.existsSync(path.join(root, '.cursor/rules/inbase.mdc')), false)
    assert.equal(fs.existsSync(path.join(root, '.cursor/rules/visual-edits.mdc')), false)
    assert.equal(fs.existsSync(path.join(root, '.cursor/rules/style.mdc')), true)
    assert.equal(fs.existsSync(path.join(root, '.claude/skills/inbase')), false)
    assert.equal(fs.existsSync(path.join(root, '.claude/rules')), false)
    assert.equal(fs.existsSync(path.join(root, '.agents/skills/inbase')), false)
    assert.equal(fs.existsSync(path.join(root, '.agents/skills/visual-edits')), false)
    assert.equal(fs.existsSync(path.join(root, '.cline/skills/inbase')), false)
    assert.equal(fs.existsSync(path.join(root, '.cline/skills/accept')), false)
    assert.equal(fs.existsSync(path.join(root, '.cline/rules/inbase.md')), false)
    assert.equal(fs.existsSync(path.join(root, '.cline/SKILL.md')), false)
    assert.equal(fs.existsSync(path.join(root, '.clinerules')), false)
  } finally {
    restoreEnv(env)
    cleanup()
  }
})

test('cleanup cline removes only Cline files', () => {
  const { root, cleanup } = tempProject()
  const env = snapshotEnv('VISUAL_CODER_TARGET', 'INBASE_DATA_DIR', 'INBASE_CONFIG')
  try {
    initProject(root)
    const result = cleanupProject(root, 'cline')
    assert.deepEqual(
      result.editors.map((editor) => editor.id),
      ['cline'],
    )
    assert.equal(result.dataDirRemoved, false)
    assert.equal(result.configRemoved, false)
    assert.equal(result.gitignoreRemoved, false)
    assert.equal(fs.existsSync(path.join(root, '.cline')), false)
    assert.equal(fs.existsSync(path.join(root, '.clinerules')), false)
    assert.equal(fs.existsSync(path.join(root, '.cursor/skills/inbase/SKILL.md')), true)
    assert.equal(fs.existsSync(path.join(root, '.cursor/permissions.json')), true)
    assert.equal(fs.existsSync(path.join(root, '.claude/skills/inbase/SKILL.md')), true)
    assert.equal(fs.existsSync(path.join(root, 'inbase.json')), true)
    assert.equal(fs.existsSync(path.join(root, '.inbase')), true)
    assert.throws(() => cleanupProject(root, 'vim'), /Unknown editor 'vim'/)
  } finally {
    restoreEnv(env)
    cleanup()
  }
})

test('cleanup is a no-op on a project without Inbase files', () => {
  const { root, cleanup } = tempProject()
  try {
    fs.mkdirSync(path.join(root, '.cursor/commands'), { recursive: true })
    fs.writeFileSync(path.join(root, '.cursor/commands/accept.md'), 'keep this command\n')
    fs.writeFileSync(path.join(root, '.clinerules'), 'keep this rule\n')
    const result = cleanupProject(root)
    assert.equal(result.dataDirRemoved, false)
    assert.equal(result.configRemoved, false)
    assert.equal(result.gitignoreRemoved, false)
    assert.equal(
      result.editors.every((editor) => editor.removed === false),
      true,
    )
    assert.equal(fs.readFileSync(path.join(root, '.cursor/commands/accept.md'), 'utf8'), 'keep this command\n')
    assert.equal(fs.readFileSync(path.join(root, '.clinerules'), 'utf8'), 'keep this rule\n')
  } finally {
    cleanup()
  }
})

test('cleanup refuses while the visualizer is running', () => {
  const { root, cleanup } = tempProject()
  try {
    writeRunningInstance({
      dataDir: path.join(root, '.inbase'),
      targetRoot: root,
    })
    assert.throws(
      () => cleanupProject(root),
      /Stop the running Inbase server/,
    )
    assert.equal(fs.existsSync(path.join(root, '.inbase')), true)
  } finally {
    cleanup()
  }
})

test('cleanup command removes init files', () => {
  const { root, cleanup } = tempProject()
  const env = snapshotEnv('VISUAL_CODER_TARGET', 'INBASE_DATA_DIR', 'INBASE_CONFIG')
  try {
    initProject(root)
    const extra = runCli(['cleanup', 'cline', 'nope'], { cwd: root })
    assert.notEqual(extra.status, 0)
    assert.match(extra.stderr, /Usage: inbase cleanup \[editor\]/)
    const result = runCli(['cleanup'], { cwd: root })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Removed Cursor skill/)
    assert.match(result.stdout, /Removed inbase.json/)
    assert.equal(fs.existsSync(path.join(root, 'inbase.json')), false)
    const empty = runCli(['cleanup'], { cwd: root })
    assert.equal(empty.status, 0, empty.stderr)
    assert.match(empty.stdout, /Nothing to clean up/)
  } finally {
    restoreEnv(env)
    cleanup()
  }
})

test('help prints usage', async () => {
  let output = ''
  const log = console.log
  console.log = (message) => {
    output += String(message)
  }
  try {
    await main(['help'])
    assert.match(output, /inbase init \[editor\]/)
    assert.match(output, /inbase cleanup \[editor\]/)
    assert.match(output, /inbase run/)
    assert.match(output, /inbase attach \[--session <id>\] \[--color <name>\]/)
    assert.match(output, /inbase accept \[--session <id>\]/)
    assert.match(output, /inbase stop \[--session <id>\]/)
    assert.match(output, /inbase extract-blueprint <folder> <output-file>/)
    assert.doesNotMatch(output, /inbase go \[--session/)
    assert.match(output, /cursor, claude, agents, copilot, cline/)
  } finally {
    console.log = log
  }
})

test('inbase run registers with a live visualizer instead of starting another', async () => {
  const first = tempProject()
  const second = tempProject()
  const env = snapshotEnv(
    'VISUAL_CODER_TARGET',
    'INBASE_DATA_DIR',
    'INBASE_CONFIG',
    'INBASE_HOME',
  )
  process.env.INBASE_HOME = path.join(first.root, 'home')
  delete process.env.VISUAL_CODER_TARGET
  delete process.env.INBASE_DATA_DIR
  delete process.env.INBASE_CONFIG
  let posted = null
  const server = http.createServer((req, res) => {
    if (req.url === '/api/dev-targets' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          enabled: true,
          currentId: first.root,
          targets: [{ id: first.root, label: 'First' }],
          dataDir: path.join(first.root, '.inbase'),
          pid: process.pid,
        }),
      )
      return
    }
    if (req.url === '/api/dev-targets' && req.method === 'POST') {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        posted = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            enabled: true,
            currentId: posted.root,
            targets: [],
          }),
        )
      })
      return
    }
    res.statusCode = 404
    res.end()
  })
  const previousCwd = process.cwd()
  let output = ''
  const log = console.log
  console.log = (message) => {
    output += `${message}\n`
  }
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    writeRunningInstance({
      dataDir: path.join(first.root, '.inbase'),
      targetRoot: first.root,
      port,
      extraDirs: [globalInbaseDir()],
    })
    fs.writeFileSync(
      path.join(second.root, 'inbase.json'),
      `${JSON.stringify({ target: '.' }, null, 2)}\n`,
    )
    process.chdir(second.root)
    await main(['run'])
    assert.equal(path.resolve(posted.root), path.resolve(second.root))
    assert.match(output, /already running/)
    assert.match(output, new RegExp(`Now mapping ${path.resolve(second.root)}`))
    assert.match(output, new RegExp(`Open http://127.0.0.1:${port}/`))
  } finally {
    console.log = log
    process.chdir(previousCwd)
    await new Promise((resolve) => server.close(resolve))
    restoreEnv(env)
    first.cleanup()
    second.cleanup()
  }
})

test('start-session writes a manifest under .inbase', async () => {
  const { root, cleanup } = tempProject()
  const env = snapshotEnv('VISUAL_CODER_TARGET', 'INBASE_DATA_DIR', 'INBASE_CONFIG')
  let output = ''
  const log = console.log
  try {
    applyHostEnv({ cwd: root, target: root, dataDir: path.join(root, '.inbase') })
    ensureDataDir(process.env.INBASE_DATA_DIR)
    console.log = (message) => {
      output += String(message)
    }
    await main([
      'start-session',
      '--session',
      'cli-test-session',
      '--name',
      'CLI test session',
    ])
    const manifest = path.join(root, '.inbase/diff-sessions/cli-test-session/manifest.json')
    assert.equal(fs.existsSync(manifest), true)
    const stored = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    assert.equal(stored.name, 'CLI test session')
    assert.match(output, /VISUAL_CODER_BLUEPRINT_WAIT/)
    assert.match(output, /CLI test session/)
  } finally {
    console.log = log
    restoreEnv(env)
    cleanup()
  }
})

function runCli(args, { cwd, env } = {}) {
  return spawnSync(process.execPath, [path.join(packageRoot, 'bin/inbase.mjs'), ...args], {
    cwd: cwd ?? packageRoot,
    encoding: 'utf8',
    env,
  })
}

test('wait-for-approval and explain wait are removed', () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    writeRunningInstance({ dataDir, targetRoot: root })
    const approval = runCli(['wait-for-approval', '--session', 'gone'], {
      cwd: root,
      env,
    })
    assert.notEqual(approval.status, 0)
    assert.match(approval.stderr, /wait-for-approval was removed/)
    const waiting = runCli(['explain', 'wait'], { cwd: root, env })
    assert.notEqual(waiting.status, 0)
    assert.match(waiting.stderr, /explain wait was removed/)
  } finally {
    cleanup()
  }
})

test('read-blueprint treats an enabled blueprint as the request when there is no instruction', async () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const started = runCli(
      ['start-session', '--session', 'blueprint-only', '--name', 'Blueprint only'],
      { cwd: root, env },
    )
    assert.equal(started.status, 0, started.stderr)
    const empty = runCli(['read-blueprint', '--session', 'blueprint-only'], {
      cwd: root,
      env,
    })
    assert.equal(empty.status, 0, empty.stderr)
    assert.match(empty.stdout, /VISUAL_CODER_NO_REQUEST/)
    assert.match(empty.stdout, /VISUAL_CODER_SAY_BLUEPRINT/)
    assert.match(empty.stdout, /I see nothing on the blueprint yet/)
    assert.doesNotMatch(empty.stdout, /VISUAL_CODER_BLUEPRINT_ONLY/)
    assert.doesNotMatch(empty.stdout, /VISUAL_CODER_INSTRUCTION_START/)

    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    store.updateBlueprint(dataDir, 'blueprint-only', {
      files: [
        {
          id: 'src/Widget.tsx',
          name: 'Widget.tsx',
          path: 'src/Widget.tsx',
          folder: 'src',
        },
      ],
    })
    const withBlueprint = runCli(
      ['read-blueprint', '--session', 'blueprint-only'],
      { cwd: root, env },
    )
    assert.equal(withBlueprint.status, 0, withBlueprint.stderr)
    assert.match(withBlueprint.stdout, /VISUAL_CODER_BLUEPRINT_ONLY/)
    assert.match(withBlueprint.stdout, /VISUAL_CODER_SAY_BLUEPRINT/)
    assert.match(withBlueprint.stdout, /I see on the blueprint/)
    assert.doesNotMatch(withBlueprint.stdout, /VISUAL_CODER_NO_REQUEST/)
    assert.doesNotMatch(withBlueprint.stdout, /VISUAL_CODER_INSTRUCTION_START/)

    store.setInitialInstruction(dataDir, 'blueprint-only', 'Add a clock')
    const withInstruction = runCli(
      ['read-blueprint', '--session', 'blueprint-only'],
      { cwd: root, env },
    )
    assert.equal(withInstruction.status, 0, withInstruction.stderr)
    assert.match(withInstruction.stdout, /VISUAL_CODER_INSTRUCTION_START/)
    assert.match(withInstruction.stdout, /Add a clock/)
    assert.doesNotMatch(withInstruction.stdout, /VISUAL_CODER_BLUEPRINT_ONLY/)
    assert.doesNotMatch(withInstruction.stdout, /VISUAL_CODER_NO_REQUEST/)
  } finally {
    cleanup()
  }
})

test('read-blueprint does not consume a pending map explain', async () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const started = runCli(
      ['start-session', '--session', 'explain-pending', '--name', 'Explain pending'],
      { cwd: root, env },
    )
    assert.equal(started.status, 0, started.stderr)
    const explain = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/explain-store.mjs')).href
    )
    explain.requestExplainTarget(dataDir, {
      kind: 'folder',
      path: 'apps/explorer/scripts',
    })
    const result = runCli(
      ['read-blueprint', '--session', 'explain-pending'],
      { cwd: root, env },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK blueprint/)
    assert.doesNotMatch(result.stdout, /VISUAL_CODER_EXPLAIN The user clicked/)
    assert.equal(explain.readExplain(dataDir).pendingStart.path, 'apps/explorer/scripts')
  } finally {
    cleanup()
  }
})

test('explain start uses a pending map question mark', async () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const explain = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/explain-store.mjs')).href
    )
    fs.mkdirSync(dataDir, { recursive: true })
    writeRunningInstance({ dataDir, targetRoot: root })
    explain.requestExplainTarget(dataDir, {
      kind: 'folder',
      path: 'apps/explorer/src',
    })
    const result = runCli(['explain', 'start'], { cwd: root, env })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK explain: folder apps\/explorer\/src/)
    assert.match(result.stdout, /VISUAL_CODER_EXPLAIN_STARTED/)
    assert.equal(explain.readExplain(dataDir).pendingStart, null)
  } finally {
    cleanup()
  }
})

test('explain start with a question reports a follow-up when explain is active', async () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const explain = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/explain-store.mjs')).href
    )
    fs.mkdirSync(dataDir, { recursive: true })
    writeRunningInstance({ dataDir, targetRoot: root })
    explain.startExplain(dataDir, 'How does World work?')
    explain.reportExplain(dataDir, {
      question: 'How does World work?',
      steps: [{ title: 'World layout' }, { title: 'Folder floors' }],
    })
    const result = runCli(
      ['explain', 'start', '--question', 'Why is World selected?'],
      { cwd: root, env },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK question/)
    assert.match(result.stdout, /VISUAL_CODER_EXPLAIN_FOLLOWUP/)
    assert.match(result.stdout, /VISUAL_CODER_PARENT 1/)
    assert.match(result.stdout, /Why is World selected\?/)
  } finally {
    cleanup()
  }
})

function planSession(store, dataDir, target, sessionId, name, stepTitles) {
  const started = runCli(
    ['start-session', '--session', sessionId, '--name', name],
    {
      cwd: path.dirname(dataDir),
      env: {
        ...process.env,
        VISUAL_CODER_TARGET: target,
        INBASE_DATA_DIR: dataDir,
      },
    },
  )
  assert.equal(started.status, 0, started.stderr)
  store.answerBlueprint(dataDir, sessionId, false)
  store.reportPlan(dataDir, {
    sessionId,
    feature: name,
    stepTitles,
    targetRoot: target,
  })
}

test('report-plan invokes the first plan step', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'continue-chat', 'Continue chat', [
      'Bump value',
      'Bump again',
    ])
    assert.equal(store.readManifest(dataDir, 'continue-chat').phase, 'working')
    assert.equal(store.readManifest(dataDir, 'continue-chat').currentStep, 1)
  } finally {
    cleanup()
  }
})

test('recording a non-last step continues into the next step', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'continue-review', 'Continue review', [
      'Bump value',
      'Bump again',
    ])
    store.appendDiff(dataDir, target, {
      sessionId: 'continue-review',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
    })
    const manifest = store.readManifest(dataDir, 'continue-review')
    assert.equal(manifest.phase, 'working')
    assert.equal(manifest.currentStep, 2)
    assert.equal(manifest.diffs[0].status, 'applied')
    assert.notEqual(manifest.phase, 'review')
  } finally {
    cleanup()
  }
})

test('propose-patch CLI auto-invokes the next step without waiting for /accept', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'continue-cli', 'Continue CLI', [
      'Bump value',
      'Bump again',
    ])
    fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 2\n')
    const result = runCli(['propose-patch', '--session', 'continue-cli'], {
      cwd: root,
      env,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_STEP_READY/)
    assert.match(result.stdout, /VISUAL_CODER_EXECUTE Step 2 is invoked: Bump again/)
    assert.match(result.stdout, /Do not stop/)
    assert.doesNotMatch(result.stdout, /That was the last plan step/)
    const manifest = store.readManifest(dataDir, 'continue-cli')
    assert.equal(manifest.phase, 'working')
    assert.equal(manifest.currentStep, 2)
    assert.equal(manifest.diffs[0].status, 'applied')
  } finally {
    cleanup()
  }
})

test('accept finishes the last step', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'accept-last', 'Accept last', [
      'Bump value',
    ])
    store.appendDiff(dataDir, target, {
      sessionId: 'accept-last',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
    })
    writeRunningInstance({ dataDir, targetRoot: target })
    const result = runCli(['accept', '--session', 'accept-last'], {
      cwd: root,
      env,
    })
    assert.equal(result.status, 5, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_FINISHED/)
    assert.doesNotMatch(result.stdout, /propose-patch --session accept-last --clear/)
    assert.equal(store.readManifest(dataDir, 'accept-last'), null)
    assert.equal(
      fs.readFileSync(path.join(target, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )
  } finally {
    cleanup()
  }
})

test('accept keeps new files and --clear does not revert them', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'accept-create', 'Accept create', [
      'Add helper',
    ])
    fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 2\n')
    fs.writeFileSync(path.join(target, 'src/b.ts'), 'export const extra = 1\n')
    store.appendDiff(dataDir, target, { sessionId: 'accept-create' })
    writeRunningInstance({ dataDir, targetRoot: target })
    const accepted = runCli(['accept', '--session', 'accept-create'], {
      cwd: root,
      env,
    })
    assert.equal(accepted.status, 5, accepted.stderr)
    assert.match(accepted.stdout, /VISUAL_CODER_FINISHED/)
    const cleared = runCli(
      ['propose-patch', '--session', 'accept-create', '--clear'],
      { cwd: root, env },
    )
    assert.equal(cleared.status, 0, cleared.stderr)
    assert.match(cleared.stdout, /Applied files were kept/)
    assert.equal(
      fs.readFileSync(path.join(target, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )
    assert.equal(
      fs.readFileSync(path.join(target, 'src/b.ts'), 'utf8'),
      'export const extra = 1\n',
    )
  } finally {
    cleanup()
  }
})

test('stop restores live files and clears the session', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'stop-live', 'Stop live', [
      'Bump value',
    ])
    fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 9\n')
    fs.writeFileSync(path.join(target, 'src/balloon.ts'), 'export const balloon = 1\n')
    writeRunningInstance({ dataDir, targetRoot: target })
    const result = runCli(['stop', '--session', 'stop-live'], {
      cwd: root,
      env,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK stopped: session cleared/)
    assert.match(result.stdout, /VISUAL_CODER_STOPPED Stopped session stop-live/)
    assert.equal(store.readManifest(dataDir, 'stop-live'), null)
    assert.equal(
      fs.readFileSync(path.join(target, 'src/a.ts'), 'utf8'),
      'export const value = 1\n',
    )
    assert.equal(fs.existsSync(path.join(target, 'src/balloon.ts')), false)
  } finally {
    cleanup()
  }
})

test('go finishes the last proposal', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'go-last', 'Go last', [
      'Bump value',
    ])
    store.appendDiff(dataDir, target, {
      sessionId: 'go-last',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
    })
    writeRunningInstance({ dataDir, targetRoot: target })
    const result = runCli(['go', '--session', 'go-last'], {
      cwd: root,
      env,
    })
    assert.equal(result.status, 5, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_FINISHED/)
    assert.equal(store.readManifest(dataDir, 'go-last'), null)
    assert.equal(
      fs.readFileSync(path.join(target, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )
  } finally {
    cleanup()
  }
})

test('report-plan replaces a waiting last proposal', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'revise-last', 'Revise last', [
      'Bump value',
    ])
    store.appendDiff(dataDir, target, {
      sessionId: 'revise-last',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
    })
    writeRunningInstance({ dataDir, targetRoot: target })
    const result = runCli(
      [
        'report-plan',
        '--session',
        'revise-last',
        '--feature',
        'Revise last',
        '--steps',
        'Tint the value',
        '--steps',
        'Add helper',
      ],
      { cwd: root, env },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_PLAN_READY/)
    assert.match(result.stdout, /from step 1/)
    assert.match(result.stdout, /New remaining steps: 1\. Tint the value; 2\. Add helper/)
    assert.match(result.stdout, /Replaced the waiting proposal/)
    assert.match(result.stdout, /Do not ask the user to \/accept the previous last proposal/)
    assert.match(result.stdout, /VISUAL_CODER_EXECUTE Step 1 is invoked: Tint the value/)
    const manifest = store.readManifest(dataDir, 'revise-last')
    assert.equal(manifest.phase, 'working')
    assert.equal(manifest.currentStep, 1)
    assert.equal(manifest.diffs[0].status, 'extend')
    assert.deepEqual(
      manifest.steps.map((step) => step.title),
      ['Tint the value', 'Add helper'],
    )
  } finally {
    cleanup()
  }
})

test('attach --session on an already attached chat stays in that session', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    store.ensureSessionPool(dataDir)
    writeRunningInstance({ dataDir, targetRoot: target })
    const first = runCli(['attach'], { cwd: root, env })
    assert.equal(first.status, 0, first.stderr)
    assert.match(first.stdout, /VISUAL_CODER_ATTACHED/)
    assert.match(first.stdout, /wrong slot/)
    const sessionId = first.stdout.match(/VISUAL_CODER_SESSION (\S+)/)?.[1]
    assert.ok(sessionId)

    store.reportPlan(dataDir, {
      sessionId,
      feature: 'Keep session',
      stepTitles: ['Build value'],
      targetRoot: target,
    })
    store.appendDiff(dataDir, target, {
      sessionId,
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
    })
    assert.equal(store.readManifest(dataDir, sessionId).phase, 'review')

    const again = runCli(['attach', '--session', sessionId], { cwd: root, env })
    assert.equal(again.status, 0, again.stderr)
    assert.match(again.stdout, /VISUAL_CODER_ALREADY_ATTACHED/)
    assert.match(again.stdout, /Stay in this session/)
    assert.doesNotMatch(again.stdout, /Tell the user you connected/)
    assert.doesNotMatch(again.stdout, /VISUAL_CODER_ATTACHED/)
    assert.equal(store.readManifest(dataDir, sessionId).phase, 'review')
    assert.notEqual(store.sessionIntent(dataDir, sessionId).lastAck.kind, 'attached')
  } finally {
    cleanup()
  }
})

test('attach --color starts clean when leftover LLM work is on that slot', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    store.ensureSessionPool(dataDir)
    writeRunningInstance({ dataDir, targetRoot: target })
    const first = runCli(['attach', '--color', 'coral'], { cwd: root, env })
    assert.equal(first.status, 0, first.stderr)
    const sessionId = first.stdout.match(/VISUAL_CODER_SESSION (\S+)/)?.[1]
    assert.ok(sessionId)
    store.reportPlan(dataDir, {
      sessionId,
      feature: 'Leftover coral',
      stepTitles: ['Build value'],
      targetRoot: target,
    })
    store.appendDiff(dataDir, target, {
      sessionId,
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
    })
    assert.equal(store.readManifest(dataDir, sessionId).phase, 'review')

    const again = runCli(['attach', '--color', 'coral'], { cwd: root, env })
    assert.equal(again.status, 0, again.stderr)
    assert.match(again.stdout, /VISUAL_CODER_ATTACHED/)
    assert.doesNotMatch(again.stdout, /VISUAL_CODER_ALREADY_ATTACHED/)
    const nextId = again.stdout.match(/VISUAL_CODER_SESSION (\S+)/)?.[1]
    assert.ok(nextId)
    assert.notEqual(nextId, sessionId)
    const attached = store.readManifest(dataDir, nextId)
    assert.equal(attached.color, 'coral')
    assert.equal(attached.phase, 'preparing')
    assert.deepEqual(attached.steps, [])
    assert.equal(store.isSessionStopped(dataDir, sessionId), true)
    assert.equal(
      fs.readFileSync(path.join(target, 'src/a.ts'), 'utf8'),
      'export const value = 1\n',
    )
  } finally {
    cleanup()
  }
})

test('propose-patch refuses a waiting proposal until report-plan replaces it', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'revise-wait', 'Revise wait', [
      'Bump value',
    ])
    store.appendDiff(dataDir, target, {
      sessionId: 'revise-wait',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
    })
    writeRunningInstance({ dataDir, targetRoot: target })
    fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 3\n')
    const refused = runCli(['propose-patch', '--session', 'revise-wait'], {
      cwd: root,
      env,
    })
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /A proposal is waiting on step 1/)
    assert.match(refused.stderr, /run report-plan with the new remaining steps first/)
    assert.match(refused.stderr, /Do not edit files first/)
  } finally {
    cleanup()
  }
})

test('report-plan keeps accepted steps when replacing a later proposal', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'keep-later', 'Keep later', [
      'Build value',
      'Finish value',
    ])
    store.appendDiff(dataDir, target, {
      sessionId: 'keep-later',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
    })
    store.appendDiff(dataDir, target, {
      sessionId: 'keep-later',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 2\n+export const value = 3\n',
    })
    writeRunningInstance({ dataDir, targetRoot: target })
    const result = runCli(
      [
        'report-plan',
        '--session',
        'keep-later',
        '--feature',
        'Keep later',
        '--steps',
        'Tint the finish',
        '--steps',
        'Add helper',
      ],
      { cwd: root, env },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /from step 2/)
    assert.match(result.stdout, /Kept step 1/)
    assert.match(result.stdout, /New remaining steps: 2\. Tint the finish; 3\. Add helper/)
    assert.match(result.stdout, /VISUAL_CODER_EXECUTE Step 2 is invoked: Tint the finish/)
    const manifest = store.readManifest(dataDir, 'keep-later')
    assert.deepEqual(
      manifest.steps.map((step) => `${step.index}:${step.title}`),
      ['1:Build value', '2:Tint the finish', '3:Add helper'],
    )
  } finally {
    cleanup()
  }
})

test('explain start detects a waiting proposal', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'explain-proposal', 'Explain proposal', [
      'Bump value',
    ])
    writeRunningInstance({ dataDir, targetRoot: target })
    const withQuestion = runCli(
      ['explain', 'start', '--question', 'why this import'],
      { cwd: root, env },
    )
    assert.equal(withQuestion.status, 0, withQuestion.stderr)
    assert.match(withQuestion.stdout, /VISUAL_CODER_PROPOSAL/)
    assert.match(withQuestion.stdout, /Bump value/)
    assert.match(withQuestion.stdout, /why this import/)
    runCli(['explain', 'stop'], { cwd: root, env })

    const withoutQuestion = runCli(['explain', 'start'], { cwd: root, env })
    assert.equal(withoutQuestion.status, 0, withoutQuestion.stderr)
    assert.match(withoutQuestion.stdout, /VISUAL_CODER_PROPOSAL/)
    assert.match(
      withoutQuestion.stdout,
      /VISUAL_CODER_EXPLAIN_STARTED Explain the current proposal: Bump value/,
    )
  } finally {
    cleanup()
  }
})

test('explain start without a question walks a pending proposal diff', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'explain-review', 'Explain review', [
      'Bump value',
    ])
    store.appendDiff(dataDir, target, {
      sessionId: 'explain-review',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
    })
    writeRunningInstance({ dataDir, targetRoot: target })
    const result = runCli(['explain', 'start'], { cwd: root, env })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_PROPOSAL What has changed in this proposal/)
    assert.match(result.stdout, /Bump value/)
    assert.match(
      result.stdout,
      /VISUAL_CODER_EXPLAIN_STARTED What has changed in this proposal\?/,
    )
    assert.match(result.stdout, /VISUAL_CODER_CHANGES_START/)
    assert.match(result.stdout, /"src\/a.ts"/)
    assert.match(result.stdout, /VISUAL_CODER_CHANGES_END/)
  } finally {
    cleanup()
  }
})

test('explain start without a question walks the git branch diff', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  initGitRepo(target)
  runGit(target, ['add', '.'])
  runGit(target, ['commit', '-m', 'base'])
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 2\n')
  fs.writeFileSync(path.join(target, 'src/Clock.ts'), 'export function Clock() {}\n')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(
    path.join(dataDir, 'user-context.json'),
    `${JSON.stringify({ showBranchChanges: true }, null, 2)}\n`,
  )
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    writeRunningInstance({ dataDir, targetRoot: target })
    const result = runCli(['explain', 'start'], { cwd: root, env })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_DIFF What has changed in this git diff/)
    assert.match(
      result.stdout,
      /VISUAL_CODER_EXPLAIN_STARTED What has changed in this diff\?/,
    )
    assert.match(result.stdout, /VISUAL_CODER_CHANGES_START/)
    assert.match(result.stdout, /"src\/a.ts"/)
    assert.match(result.stdout, /"src\/Clock.ts"/)
    assert.doesNotMatch(result.stdout, /VISUAL_CODER_PROPOSAL/)
  } finally {
    cleanup()
  }
})

test('explain start without a question walks staged files vs remote', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  initGitRepo(target)
  runGit(target, ['add', '.'])
  runGit(target, ['commit', '-m', 'base'])
  const originSha = runGit(target, ['rev-parse', 'HEAD']).stdout.trim()
  runGit(target, ['update-ref', 'refs/remotes/origin/main', originSha])
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 2\n')
  runGit(target, ['add', 'src/a.ts'])
  fs.writeFileSync(path.join(target, 'src/Clock.ts'), 'export function Clock() {}\n')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(
    path.join(dataDir, 'user-context.json'),
    `${JSON.stringify({ showBranchChanges: true, branchChangesMode: 'remote' }, null, 2)}\n`,
  )
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    writeRunningInstance({ dataDir, targetRoot: target })
    const result = runCli(['explain', 'start'], { cwd: root, env })
    assert.equal(result.status, 0, result.stderr)
    assert.match(
      result.stdout,
      /VISUAL_CODER_DIFF What has changed in this git diff \(main staged vs origin\/main\)/,
    )
    assert.match(result.stdout, /VISUAL_CODER_CHANGES_START/)
    assert.match(result.stdout, /"src\/a.ts"/)
    assert.doesNotMatch(result.stdout, /"src\/Clock.ts"/)
  } finally {
    cleanup()
  }
})
