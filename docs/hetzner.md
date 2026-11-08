# Colocar o núcleo no ar na Hetzner

Este passo a passo leva uns 30 minutos. Você só precisa do terminal do seu computador
(PowerShell no Windows, Terminal no Mac). Nenhum programa extra.

## 1. Criar a chave de acesso (SSH) no seu computador

A chave é como uma senha que fica guardada no seu computador. Rode no terminal:

```bash
ssh-keygen -t ed25519 -C "felipe-bots"
```

Aperte Enter em todas as perguntas. Depois mostre a parte pública da chave e copie o texto todo:

- Windows (PowerShell): `type $env:USERPROFILE\.ssh\id_ed25519.pub`
- Mac: `cat ~/.ssh/id_ed25519.pub`

## 2. Criar o servidor

1. Crie a conta em <https://www.hetzner.com/cloud> e cadastre o cartão.
2. No painel (Cloud Console), crie um projeto, por exemplo `bots`.
3. Clique em **Add Server** (Criar servidor):
   - **Location:** qualquer uma da Europa (Falkenstein, Nuremberg ou Helsinki). O bot não precisa estar perto do Brasil.
   - **Image:** Ubuntu 24.04.
   - **Type:** Shared vCPU, a menor opção com 2 vCPU e 4 GB de memória (fica em torno de 4 a 5 euros por mês).
   - **SSH keys:** clique em **Add SSH key** e cole o texto que você copiou no passo 1.
   - **Name:** `bots-1`.
4. Clique em **Create & Buy now** e anote o **IP** do servidor (algo como `91.98.12.34`).

## 3. Preparar as chaves

Você vai colar estas chaves durante a instalação:

| Chave | Onde pegar |
|---|---|
| Token do GitHub (só leitura) | GitHub > Settings > Developer settings > **Fine-grained tokens** > Generate new token. Em *Repository access* escolha só `bots-whatsapp`; em *Permissions* > *Contents* escolha **Read-only**. |
| Token da AvisaAPI | O mesmo que está na credencial *AvisaAPI* do n8n. |
| Chave do Gemini | <https://aistudio.google.com/apikey> (pode ser a mesma que o n8n usa). |
| Chave do Google Maps | A que você criou para o n8n (Places API New). |

## 4. Instalar

No terminal do seu computador, troque `IP` pelo IP do servidor:

```bash
ssh root@IP
```

Na primeira vez ele pergunta se confia no servidor: digite `yes`. Você está dentro do servidor quando aparecer `root@bots-1`.
Agora rode as duas linhas abaixo e responda às perguntas. Quando ele perguntar o domínio, aperte Enter.

```bash
curl -fsSL -H "Authorization: Bearer TOKEN_DO_GITHUB" \
  https://raw.githubusercontent.com/felipe-fsg/bots-whatsapp/main/scripts/instalar-servidor.sh -o instalar.sh
bash instalar.sh
```

No fim deve aparecer `No ar: https://...sslip.io/health`. Abra esse endereço no navegador: tem que mostrar `{"ok":true}`.

## 5. Cadastrar o Splinter

Baixe o arquivo `splinter-desafio-verao-2026.json` da pasta do projeto no Claude. Antes de enviar, confira o
`raio_metros` (a planilha estava com 15). Depois mande o arquivo para o servidor, rodando **no seu computador**
(numa janela nova do terminal, na pasta onde o arquivo está):

```bash
scp splinter-desafio-verao-2026.json root@IP:/root/
```

E **no servidor**:

```bash
cd /opt/bots-whatsapp
bash scripts/cadastrar.sh /root/splinter-desafio-verao-2026.json
```

Ele mostra o endereço do webhook, algo como
`https://91-98-12-34.sslip.io/webhook/avisa/ab0d...?key=...`. Guarde esse endereço: ele funciona como senha.

## 6. Virar a chave

1. No n8n, **desative** os fluxos *Splinter - Mestre Splinter* e *Splinter - Localização vencida*, para não ter mensagem repetida.
2. No painel da AvisaAPI, troque o webhook do número pelo endereço do passo 5.
3. Mande `#ranking` no grupo de testes. O bot tem que responder em poucos segundos.

Para voltar atrás, basta colocar de novo o webhook antigo do n8n na AvisaAPI e reativar os dois fluxos.

**Bot de dúvidas:** com o webhook novo, o n8n para de receber as mensagens. Se o bot de dúvidas precisar continuar
funcionando, preencha `repassar_para` (endereço do webhook do n8n) e `repassar_so_estes_grupos` (os grupos dele)
no arquivo JSON e rode o passo 5 de novo. Assim o n8n só recebe esses grupos e a cota de execuções para de estourar.

## Comandos úteis no servidor

```bash
cd /opt/bots-whatsapp
docker compose logs -f app          # ver o que o bot está fazendo (Ctrl+C para sair)
docker compose restart app          # reiniciar
bash scripts/instalar-servidor.sh   # atualizar para a versão nova do GitHub
```
