/** Cria issues num repositório do GitHub (usado pelo #suporte). */
export interface IssueTracker {
  create(issue: { title: string; body: string; labels: string[] }): Promise<{ number: number; url: string }>;
}

export class GitHubIssues implements IssueTracker {
  constructor(
    private readonly repo: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async create(issue: { title: string; body: string; labels: string[] }) {
    const post = (payload: object) =>
      this.fetchFn(`https://api.github.com/repos/${this.repo}/issues`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'bots-whatsapp',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify(payload),
      });
    let res = await post(issue);
    // sem permissão para criar a etiqueta: cria a issue sem ela
    if (res.status === 422 && issue.labels.length) res = await post({ title: issue.title, body: issue.body });
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { number: number; html_url: string };
    return { number: data.number, url: data.html_url };
  }
}

/** GITHUB_ISSUES_TOKEN (+ GITHUB_ISSUES_REPO). Sem token, devolve null e os pedidos ficam só no banco. */
export function issuesFromEnv(env: NodeJS.ProcessEnv = process.env): IssueTracker | null {
  const token = env.GITHUB_ISSUES_TOKEN?.trim();
  if (!token) return null;
  return new GitHubIssues(env.GITHUB_ISSUES_REPO?.trim() || 'felipe-fsg/bots-whatsapp', token);
}
