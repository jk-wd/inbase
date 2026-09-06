import fs from 'node:fs'
import path from 'node:path'
import { copyDir } from '../project.mjs'
import { copySkillAndCommands } from './layout.mjs'

export const id = 'cline'
export const label = 'Cline'

const RULE_REL_PATHS = ['.cline/rules/inbase.md', '.clinerules/inbase.md']

const CLINE_RULE = `# Inbase visual edits

Apply this whenever the work is file changes in this repository.
Skip it for git, lockfiles, \`.inbase\`, \`.cursor\`, \`.claude\`, \`.agents\`,
\`.cline\`, \`.clinerules\`, \`.github/skills\`, questions with no code changes,
or \`/extract-blueprint\`.

Read \`.cline/skills/inbase/SKILL.md\` and follow it.

- \`/skipinbase\`: do the request without Inbase.
- \`/extract-blueprint\`: extract a valuable blueprint from a folder. Do not attach.
- \`/inbase\`, or this chat already has \`VISUAL_CODER_SESSION\`: follow the skill
  from \`read-blueprint\`. After that, say what you see on the blueprint.
- \`/accept\`, \`/explain\`, \`/coral\` and the other session colors: follow the
  matching workflow under \`.cline/workflows/\` or \`.clinerules/workflows/\`.
- Any other file-change request: attach if needed, then follow the skill.
`

export function install(projectRoot) {
  const installed = copySkillAndCommands(projectRoot, {
    id,
    skillRel: '.cline/skills/inbase',
    commandRel: '.cline/workflows',
  })
  removeLegacyCommandSkills(path.join(projectRoot, '.cline/skills'))
  const legacyWorkflows = path.join(projectRoot, '.clinerules/workflows')
  if (installed.commandDir && fs.existsSync(installed.commandDir)) {
    copyDir(installed.commandDir, legacyWorkflows)
  }
  writeClineRules(projectRoot)
  return { ...installed, label }
}

function removeLegacyCommandSkills(skillsDir) {
  if (!fs.existsSync(skillsDir)) return
  for (const name of fs.readdirSync(skillsDir)) {
    if (name === 'inbase') continue
    const dir = path.join(skillsDir, name)
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

function writeClineRules(projectRoot) {
  for (const rel of RULE_REL_PATHS) {
    const file = path.join(projectRoot, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${CLINE_RULE.trim()}\n`)
  }
}
