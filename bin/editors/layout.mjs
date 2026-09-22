import fs from 'node:fs'
import path from 'node:path'
import {
  commandTemplateDir,
  copyDir,
  removeEmptyParents,
  skillTemplateDir,
} from '../project.mjs'

const RETIRED_COMMAND_NAMES = [
  'explain',
  'go',
  'accept',
  'skipinbase',
  'pink',
  'emerald',
  'fuchsia',
  'magenta',
  'gold',
  'blueprint-structure',
  'blueprint-strucure',
]

export function looksLikeInbaseFile(file) {
  try {
    if (!fs.statSync(file).isFile()) return false
    const text = fs.readFileSync(file, 'utf8')
    return /npx inbase|VISUAL_CODER|inbase attach|\/skipinbase|\bInbase\b/.test(text)
  } catch {
    return false
  }
}

const COMMAND_TEMPLATE_SUBDIRS = ['attach']

function listCommandTemplates() {
  const files = []
  if (!fs.existsSync(commandTemplateDir)) return files
  for (const name of fs.readdirSync(commandTemplateDir)) {
    const full = path.join(commandTemplateDir, name)
    if (isFile(full) && name.endsWith('.md')) {
      files.push({ stem: name.slice(0, -3), src: full })
    }
  }
  for (const sub of COMMAND_TEMPLATE_SUBDIRS) {
    const dir = path.join(commandTemplateDir, sub)
    if (!isDir(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md')) continue
      files.push({ stem: name.slice(0, -3), src: path.join(dir, name) })
    }
  }
  return files
}

function commandTemplateStems() {
  return listCommandTemplates().map((file) => file.stem)
}

function copyCommandTemplates(commandDir) {
  fs.mkdirSync(commandDir, { recursive: true })
  for (const { stem, src } of listCommandTemplates()) {
    fs.copyFileSync(src, path.join(commandDir, `${stem}.md`))
  }
  removeRetiredCommands(commandDir)
  removeLeftoverAttachFolder(commandDir)
}

function removeLeftoverAttachFolder(commandDir) {
  const leftoverAttach = path.join(commandDir, 'attach')
  if (!isDir(leftoverAttach)) return
  for (const { stem } of listCommandTemplates()) {
    const nested = path.join(leftoverAttach, `${stem}.md`)
    if (isFile(nested)) fs.unlinkSync(nested)
  }
  if (fs.existsSync(leftoverAttach) && fs.readdirSync(leftoverAttach).length === 0) {
    fs.rmdirSync(leftoverAttach)
  }
}

function installedCommandNames() {
  return [...new Set([...commandTemplateStems(), ...RETIRED_COMMAND_NAMES])]
}

const ALWAYS_REMOVE_COMMANDS = new Set(['inbase', 'skipinbase', 'extract-blueprint'])

function isDir(target) {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

function isFile(target) {
  try {
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}

function removeDir(dir) {
  if (!fs.existsSync(dir)) return false
  fs.rmSync(dir, { recursive: true, force: true })
  return true
}

export function removeManagedFile(file) {
  if (!looksLikeInbaseFile(file)) return false
  fs.unlinkSync(file)
  return true
}

function removeKnownCommandFile(file, stem) {
  if (!isFile(file)) return false
  if (ALWAYS_REMOVE_COMMANDS.has(stem)) {
    fs.unlinkSync(file)
    return true
  }
  return removeManagedFile(file)
}

function removeManagedSkillDir(dir) {
  const skill = path.join(dir, 'SKILL.md')
  if (!isFile(skill) || !looksLikeInbaseFile(skill)) return false
  fs.rmSync(dir, { recursive: true, force: true })
  return true
}

/** Remove the `inbase` skill and any other skill folder whose SKILL.md is Inbase-managed. */
export function sweepInbaseSkills(skillsDir) {
  if (!isDir(skillsDir)) return false
  let removed = false
  for (const name of fs.readdirSync(skillsDir)) {
    const dir = path.join(skillsDir, name)
    if (isFile(dir) && name === 'SKILL.md') {
      if (removeManagedFile(dir)) removed = true
      continue
    }
    if (!isDir(dir)) continue
    if (name === 'inbase') {
      if (removeDir(dir)) removed = true
      continue
    }
    if (removeManagedSkillDir(dir)) removed = true
  }
  return removed
}

/** Remove Inbase rule files (`inbase.md`, `inbase.mdc`, or content that looks like ours). */
export function sweepInbaseRules(rulesPath) {
  if (isFile(rulesPath)) return removeManagedFile(rulesPath)
  if (!isDir(rulesPath)) return false
  let removed = false
  for (const name of fs.readdirSync(rulesPath)) {
    const target = path.join(rulesPath, name)
    if (isDir(target)) {
      if (name === 'inbase' && removeDir(target)) removed = true
      continue
    }
    if (!isFile(target) || !/\.(md|mdc)$/i.test(name)) continue
    const stem = name.replace(/\.(md|mdc)$/i, '')
    if (stem === 'inbase') {
      fs.unlinkSync(target)
      removed = true
      continue
    }
    if (removeManagedFile(target)) removed = true
  }
  return removed
}

export function copySkillAndCommands(projectRoot, { id, skillRel, commandRel }) {
  if (!fs.existsSync(skillTemplateDir)) {
    throw new Error(`Inbase skill template missing at ${skillTemplateDir}`)
  }
  const skillDir = path.join(projectRoot, skillRel)
  copyDir(skillTemplateDir, skillDir)
  const commandDir = path.join(projectRoot, commandRel)
  copyCommandTemplates(commandDir)
  return { id, skillDir, commandDir }
}

function removeRetiredCommands(commandDir) {
  if (!commandDir || !fs.existsSync(commandDir)) return
  for (const name of RETIRED_COMMAND_NAMES) {
    const flat = path.join(commandDir, `${name}.md`)
    if (fs.existsSync(flat)) fs.unlinkSync(flat)
    const skill = path.join(commandDir, name)
    if (fs.existsSync(skill)) fs.rmSync(skill, { recursive: true, force: true })
  }
}

const SKILL_TOOL_FRONTMATTER = ['allowed-tools: Bash(npx inbase *)']

const COMMAND_SKILL_FRONTMATTER = (name, { listCommandSkills = false } = {}) => {
  const lines = [`name: ${name}`]
  // Codex/Zed/Copilot: hide slash skills from auto-routing. Bionic treats the
  // same flag as "omit from the skill list", so LM Studio/Bionic skip it.
  if (!listCommandSkills) {
    lines.push('disable-model-invocation: true', 'allow_implicit_invocation: false')
  }
  lines.push('allowed-tools: Bash(npx inbase *)')
  return lines
}

/** Skill folders for Codex, Copilot, Gemini CLI, and other SKILL.md agents. */
export function copySkillTree(projectRoot, { id, skillsRel, listCommandSkills = false }) {
  if (!fs.existsSync(skillTemplateDir)) {
    throw new Error(`Inbase skill template missing at ${skillTemplateDir}`)
  }
  const commandDir = path.join(projectRoot, skillsRel)
  const skillDir = path.join(commandDir, 'inbase')
  copyDir(skillTemplateDir, skillDir)
  prependYamlFrontmatter(path.join(skillDir, 'SKILL.md'), SKILL_TOOL_FRONTMATTER)
  if (fs.existsSync(commandTemplateDir)) {
    for (const { stem, src } of listCommandTemplates()) {
      // The inbase skill already lives at inbase/SKILL.md and is /inbase.
      if (stem === 'inbase') continue
      const dest = path.join(commandDir, stem, 'SKILL.md')
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(src, dest)
      prependYamlFrontmatter(dest, COMMAND_SKILL_FRONTMATTER(stem, { listCommandSkills }))
    }
  }
  removeRetiredCommands(commandDir)
  if (isDir(path.join(commandDir, 'attach'))) {
    fs.rmSync(path.join(commandDir, 'attach'), { recursive: true, force: true })
  }
  return { id, skillDir, commandDir }
}

export function removeSkillAndCommands(projectRoot, { id, skillRel, commandRel }) {
  const skillDir = path.join(projectRoot, skillRel)
  const commandDir = path.join(projectRoot, commandRel)
  let removed = removeDir(skillDir)
  if (sweepInbaseSkills(path.dirname(skillDir))) removed = true
  for (const name of installedCommandNames()) {
    if (removeKnownCommandFile(path.join(commandDir, `${name}.md`), name)) removed = true
    if (removeKnownCommandFile(path.join(commandDir, 'attach', `${name}.md`), name)) {
      removed = true
    }
  }
  const leftoverAttach = path.join(commandDir, 'attach')
  if (isDir(leftoverAttach) && fs.readdirSync(leftoverAttach).length === 0) {
    fs.rmdirSync(leftoverAttach)
    removed = true
  }
  removeEmptyParents(path.dirname(skillDir), projectRoot)
  removeEmptyParents(commandDir, projectRoot)
  return { id, skillDir, commandDir, removed }
}

export function removeSkillTree(projectRoot, { id, skillsRel }) {
  const commandDir = path.join(projectRoot, skillsRel)
  const skillDir = path.join(commandDir, 'inbase')
  let removed = removeDir(skillDir)
  if (sweepInbaseSkills(commandDir)) removed = true
  removeEmptyParents(commandDir, projectRoot)
  return { id, skillDir, commandDir, removed }
}

export function prependYamlFrontmatter(file, lines) {
  if (!fs.existsSync(file) || lines.length === 0) return
  const text = fs.readFileSync(file, 'utf8')
  if (!text.startsWith('---\n')) return
  const end = text.indexOf('\n---', 4)
  const block = end === -1 ? text.slice(4) : text.slice(4, end)
  const existing = new Set(
    block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  )
  const extra = lines.filter((line) => !existing.has(line.trim()))
  if (extra.length === 0) return
  fs.writeFileSync(file, `---\n${extra.join('\n')}\n${text.slice(4)}`)
}
