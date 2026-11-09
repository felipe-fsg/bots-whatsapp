/**
 * Lista os grupos em que o número do bot está, com o código (JID) de cada um.
 * Uso no servidor: bash scripts/listar-grupos.sh
 */
const base = process.env.AVISA_URL ?? 'https://www.avisaapi.com.br/api';
const tokenEnv = process.argv[2] ?? 'AVISA_TOKEN_FELIPE';
const token = process.env[tokenEnv];
if (!token) {
  console.error(`Variável ${tokenEnv} não encontrada no .env`);
  process.exit(1);
}
const res = await fetch(`${base}/group/list`, { headers: { Authorization: `Bearer ${token}` } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const body: any = await res.json();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const groups: any[] = body?.data?.data?.Groups ?? body?.data?.Groups ?? body?.Groups ?? [];
if (!groups.length) console.log('Nenhum grupo encontrado. Resposta da AvisaAPI:', JSON.stringify(body).slice(0, 300));
for (const g of groups.sort((a, b) => String(a.Name).localeCompare(String(b.Name)))) {
  console.log(`${g.JID}   ${g.Name ?? '(sem nome)'}   (${(g.Participants ?? []).length} pessoas)`);
}
