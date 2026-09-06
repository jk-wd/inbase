import fs from 'node:fs'
import path from 'node:path'
import { commandTemplateDir, copyDir, skillTemplateDir } from '../project.mjs'

export function copySkillAndCommands(projectRoot, { id, skillRel, commandRel }) {
  if (!fs.existsSync(skillTemplateDir)) {
    throw new Error(`Inbase skill template missing at ${skillTemplateDir}`)
  }
  const skillDir = path.join(projectRoot, skillRel)
  copyDir(skillTemplateDir, skillDir)
  const commandDir = path.join(projectRoot, commandRel)
  if (fs.existsSync(commandTemplateDir)) {
    copyDir(commandTemplateDir, commandDir)
  }
  removeRetiredGoCommand(commandDir)
  return { id, skillDir, commandDir }
}

function removeRetiredGoCommand(commandDir) {
  if (!commandDir || !fs.existsSync(commandDir)) return
  const flat = path.join(commandDir, 'go.md')
  if (fs.existsSync(flat)) fs.unlinkSync(flat)
  const skill = path.join(commandDir, 'go')
  if (fs.existsSync(skill)) fs.rmSync(skill, { recursive: true, force: true })
}

const SKILL_TOOL_FRONTMATTER = ['allowed-tools: Bash(npx inbase *)']

const COMMAND_SKILL_FRONTMATTER = (name) => [
  `name: ${name}`,
  'disable-model-invocation: true',
  'allow_implicit_invocation: false',
  'allowed-tools: Bash(npx inbase *)',
]

/** Skill folders for Codex, Copilot, Cline, Gemini CLI, and other SKILL.md agents. */
export function copySkillTree(projectRoot, { id, skillsRel }) {
  if (!fs.existsSync(skillTemplateDir)) {
    throw new Error(`Inbase skill template missing at ${skillTemplateDir}`)
  }
  const commandDir = path.join(projectRoot, skillsRel)
  const skillDir = path.join(commandDir, 'inbase')
  copyDir(skillTemplateDir, skillDir)
  prependYamlFrontmatter(path.join(skillDir, 'SKILL.md'), SKILL_TOOL_FRONTMATTER)
  if (fs.existsSync(commandTemplateDir)) {
    for (const name of fs.readdirSync(commandTemplateDir)) {
      if (!name.endsWith('.md')) continue
      const stem = name.slice(0, -3)
      // The always-on skill already lives at inbase/SKILL.md and is /inbase.
      if (stem === 'inbase') continue
      const dest = path.join(commandDir, stem, 'SKILL.md')
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(path.join(commandTemplateDir, name), dest)
      prependYamlFrontmatter(dest, COMMAND_SKILL_FRONTMATTER(stem))
    }
  }
  removeRetiredGoCommand(commandDir)
  return { id, skillDir, commandDir }
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
