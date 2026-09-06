import fs from 'node:fs'
import path from 'node:path'
import { copyDir } from '../project.mjs'
import { copySkillAndCommands } from './layout.mjs'

export const id = 'cline'
export const label = 'Cline'

const RULE_REL_PATHS = ['.cline/rules/inbase.md', '.clinerules/inbase.md']

const CLINE_PREAMBLE = `# Inbase visual edits (Cline)

This rule is **mandatory** for every source-file change in this repository.
Skip it only for git, lockfiles, \`.inbase\`, editor skill folders, questions
with no code changes, or \`/extract-blueprint\`.

Cline (including Qwen) must **execute** tools. Do not paste \`npx inbase\`
commands as chat text. Do not explore the repo first. Use this XML:

<execute_command>
<command>npx inbase attach</command>
<requires_approval>false</requires_approval>
</execute_command>

Replace \`SESSION_ID\` with the \`VISUAL_CODER_SESSION\` value from this chat.

On a new file-change request, in this order:
1. Run \`npx inbase attach\` (or \`npx inbase attach --color COLOR\` if the user
   named a color). Stop if the output is \`VISUAL_CODER_NOT_RUNNING\`.
2. Reply: \`Connecting to the <color> session.\`
3. Run \`npx inbase read-blueprint --session SESSION_ID\`
4. Reply: \`I see on the blueprint ...\` (name files, folders, symbols, notes)
5. Run \`npx inbase report-plan --session SESSION_ID --feature "..." --steps "..."\`
6. Edit files only after \`VISUAL_CODER_EXECUTE\`. Then run
   \`npx inbase propose-patch --session SESSION_ID\` with no patch file. Then stop.

If this chat already printed \`VISUAL_CODER_SESSION\`, skip attach. Stay in
that session. \`/accept\` runs \`npx inbase accept --session SESSION_ID\`.

Follow the rest of this rule exactly.
`

export function stripYamlFrontmatter(text) {
  if (!text.startsWith('---\n')) return text
  const end = text.indexOf('\n---\n', 4)
  if (end === -1) return text
  return text.slice(end + 5).replace(/^\n*/, '')
}

export function toClineExecuteCommand(markdown) {
  const withSession = markdown.replaceAll('<session-id>', 'SESSION_ID')
  return withSession.replace(/```bash\n([\s\S]*?)```/g, (_, body) => {
    const command = escapeXml(body.trim())
    return [
      '<execute_command>',
      `<command>${command}</command>`,
      '<requires_approval>false</requires_approval>',
      '</execute_command>',
    ].join('\n')
  })
}

function escapeXml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function install(projectRoot) {
  const installed = copySkillAndCommands(projectRoot, {
    id,
    skillRel: '.cline/skills/inbase',
    commandRel: '.cline/workflows',
  })
  removeLegacyCommandSkills(path.join(projectRoot, '.cline/skills'))
  rewriteMarkdownDir(installed.commandDir)
  const skillFile = path.join(installed.skillDir, 'SKILL.md')
  if (fs.existsSync(skillFile)) {
    fs.writeFileSync(skillFile, toClineExecuteCommand(fs.readFileSync(skillFile, 'utf8')))
  }
  const legacyWorkflows = path.join(projectRoot, '.clinerules/workflows')
  if (installed.commandDir && fs.existsSync(installed.commandDir)) {
    copyDir(installed.commandDir, legacyWorkflows)
  }
  writeClineRules(projectRoot, installed.skillDir)
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

function rewriteMarkdownDir(dir) {
  if (!dir || !fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const file = path.join(dir, name)
    fs.writeFileSync(file, toClineExecuteCommand(fs.readFileSync(file, 'utf8')))
  }
}

function writeClineRules(projectRoot, skillDir) {
  const skillFile = path.join(skillDir, 'SKILL.md')
  const skill = fs.existsSync(skillFile) ? fs.readFileSync(skillFile, 'utf8') : ''
  const body = toClineExecuteCommand(stripYamlFrontmatter(skill)).trim()
  const text = `${CLINE_PREAMBLE.trim()}\n\n${body}\n`
  for (const rel of RULE_REL_PATHS) {
    const file = path.join(projectRoot, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
}
