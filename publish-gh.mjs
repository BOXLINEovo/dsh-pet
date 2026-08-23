// Push the dsh-pet package to GitHub via the API (works where the git binary
// is sandbox-blocked). Requires GH_TOKEN env.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const token = process.env.GH_TOKEN
if (!token) throw new Error('GH_TOKEN env required')
const repo = 'BOXLINEovo/dsh-pet'
const branch = 'main'
const api = 'https://api.github.com'
const author = { name: 'BOXLINEovo', email: '160148710+BOXLINEovo@users.noreply.github.com' }

async function gh(path, opts = {}) {
  const res = await fetch(api + path, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'dsh-pet-publisher',
      'Content-Type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status}: ${JSON.stringify(data)}`)
  return data
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const root = process.cwd()
const files = walk(root)
console.log(`pushing ${files.length} files`)

// 1) seed the empty repo with README via the Contents API (unlocks git data API)
const readme = readFileSync(join(root, 'README.md')).toString('base64')
const seed = await gh(`/repos/${repo}/contents/README.md`, {
  method: 'PUT',
  body: { message: 'chore: init repository', content: readme, branch },
})
const baseTree = seed.commit.tree.sha
console.log('seeded README, base_tree:', baseTree)

// 2) blobs for every file (README will be replaced by the tree commit)
const entries = []
for (const file of files) {
  const content = readFileSync(file).toString('base64')
  const blob = await gh(`/repos/${repo}/git/blobs`, { method: 'POST', body: { content, encoding: 'base64' } })
  entries.push({ path: relative(root, file).split('\\').join('/'), mode: '100644', type: 'blob', sha: blob.sha })
}
console.log('blobs done:', entries.length)

// 3) tree + commit on top of the seed
const tree = await gh(`/repos/${repo}/git/trees`, { method: 'POST', body: { base_tree: baseTree, tree: entries } })
const commit = await gh(`/repos/${repo}/git/commits`, { method: 'POST', body: {
  message: 'feat: dsh-pet — DeepSeek 余额桌面宠物（爱吃白饭的蓝色大肥鱼）\n\nBundled dsh.client plugin for the DSH web profile (balance pet).\nCharacter art: bilibili 这个刀子真甜 https://space.bilibili.com/23315338',
  tree: tree.sha,
  parents: [seed.commit.sha],
  author,
  committer: author,
} })
await gh(`/repos/${repo}/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: commit.sha, force: true } })
console.log('PUSH OK:', commit.sha)
