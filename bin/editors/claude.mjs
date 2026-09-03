import fs from 'node:fs'
import path from 'node:path'
import { copySkillAndCommands, prependYamlFrontmatter } from './layout.mjs'

export const id = 'claude'
export const label = 'Claude Code'

const SKILL_FRONTMATTER = [
  'user-invocable: false',
  'allowed-tools: Bash(npx inbase *)',
]

const COMMAND_FRONTMATTER = [
  'disable-model-invocation: true',
  'allowed-tools: Bash(npx inbase *)',
]

export function install(projectRoot) {
  const installed = copySkillAndCommands(projectRoot, {
    id,
    skillRel: '.claude/skills/inbase',
    commandRel: '.claude/commands',
  })
  prependYamlFrontmatter(path.join(installed.skillDir, 'SKILL.md'), SKILL_FRONTMATTER)
  if (fs.existsSync(installed.commandDir)) {
    for (const name of fs.readdirSync(installed.commandDir)) {
      if (!name.endsWith('.md')) continue
      prependYamlFrontmatter(path.join(installed.commandDir, name), COMMAND_FRONTMATTER)
    }
  }
  return { ...installed, label }
}
