// Push the current dsh-pet tree to GitHub as a new commit on main.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const token = process.env.GH_TOKEN
if (!token) throw new Error('GH_TOKEN env required')
const repo = 'BOXLINEovo/dsh-pet'
const branch = 'main'
const api = 'https://api.github.com'
const author = { name: 'BOXLINEovo', email: '160148710+BOXLINEovo@users.noreply.github.com' }
const SKIP = new Set(['.git', 'node_modules', 'simulate-client.mjs', 'publish-gh.mjs', 'push-to-github.mjs'])

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
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const root = process.cwd()
const files = walk(root)
const head = await gh(`/repos/${repo}/git/ref/heads/${branch}`)
const parentSha = head.object.sha
const parent = await gh(`/repos/${repo}/git/commits/${parentSha}`)
console.log(`pushing ${files.length} files onto ${parentSha.slice(0, 7)}`)

const entries = []
for (const file of files) {
  const content = readFileSync(file).toString('base64')
  const blob = await gh(`/repos/${repo}/git/blobs`, { method: 'POST', body: { content, encoding: 'base64' } })
  entries.push({ path: relative(root, file).split('\\').join('/'), mode: '100644', type: 'blob', sha: blob.sha })
}

const tree = await gh(`/repos/${repo}/git/trees`, { method: 'POST', body: { base_tree: parent.tree.sha, tree: entries } })
const commit = await gh(`/repos/${repo}/git/commits`, { method: 'POST', body: {
  message: 'feat: 峰谷时段提示 + 余额请求容错\n\n- 气泡新增峰谷行：北京时间 00:30–08:30 低谷（白饭打折），其余高峰（原价），带倒计时\n- 节点半：三级重试阶梯（fetch → 重试 → curl 兜底），失败返回具体原因\n- 客户端：失败自动重试 3 次，副行显示真实错误详情',
  tree: tree.sha,
  parents: [parentSha],
  author,
  committer: author,
} })
await gh(`/repos/${repo}/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: commit.sha, force: true } })
console.log('PUSH OK:', commit.sha)
