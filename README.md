# LINHA MORTA

> *"O mundo não esquece você."*

Jogo de sobrevivência, suspense psicológico e exploração. Uma estrada rural brasileira abandonada depois de um apagão inexplicável: um carro batido no meio da pista, a mata fechada dos dois lados, chuva, neblina e luzes que aparecem de vez em quando no fim da estrada.

Este repositório contém o **primeiro marco** do projeto: o menu cinematográfico em 3D, a base técnica da web (PWA pronta para a Vercel) e um **prólogo jogável curto** em primeira pessoa.

- **Tecnologia:** TypeScript, Three.js (WebGL 2), HTML e CSS, Web Audio API e Vite. Não usa Unity, Unreal, Godot nem editores visuais.
- **Conteúdo 100% procedural:** cenário, texturas, ícones e sons são gerados por código. Não há imagens ou áudios externos, nem assets pagos ou sem licença.

---

## O que está implementado

### Abertura e carregamento
- Tela preta cinematográfica: o título surge aos poucos, depois o slogan.
- O progresso mostra **etapas reais** (por exemplo, "Etapa 3 de 7: Gerando texturas"), nunca uma porcentagem inventada. A etapa atual tem uma animação indeterminada.
- As etapas são: verificar compatibilidade, preparar o ambiente, gerar texturas, carregar o cenário, criar chuva e neblina, compilar shaders e inicializar o áudio.
- Botão **Ativar som**, que liga a interferência de rádio e a atmosfera respeitando a política de autoplay do navegador.
- Tratamento de erros com **Tentar novamente** e **Continuar sem 3D**:
  - sem WebGL 2, o menu abre numa versão leve;
  - se o carregamento passar de cerca de 22 s, o jogo avisa e oferece a saída.
- Transição suave do preto para a cena 3D.

### Cena 3D cinematográfica (Three.js, código próprio)
- **Asfalto molhado:**
  - textura procedural com faixas amarela e brancas desgastadas, rachaduras, remendos, buracos e trilhas de pneu;
  - **reflexo planar** esticado em listras verticais, como em pista molhada de verdade;
  - poças com **ondulações de gotas de chuva** animadas.
- **Carro abandonado** (hatch dos anos 90 modelado por código):
  - carroceria com frente amassada, para-brisa trincado, sujeira, ferrugem e pneu furado;
  - **um farol ainda aceso**, com feixe volumétrico, piscando de vez em quando;
  - **pisca-alerta** piscando com a rampa típica de lâmpada incandescente.
- **Vegetação:**
  - eucaliptal em fileiras de um lado da estrada e mata fechada do outro, com palmeiras e arbustos;
  - capim alto nas valetas, tudo balançando com rajadas de vento;
  - impostores "assados" em textura para as árvores distantes.
- **Atmosfera:**
  - neblina exponencial **por altura**, mais densa rente ao chão, com bancos de neblina em movimento;
  - chuva na GPU (até 32 mil gotas) que **brilha ao cruzar o feixe do farol**, além de respingos no chão;
  - céu tempestuoso com nuvens em movimento, **relâmpagos** e lua escondida.
- **Elementos de lugar:**
  - postes sem energia, com um cabo partido caído;
  - guard-rail e placas brasileiras (direção, 80 km/h, curva);
  - marcos de km 113 e km 112 e um ponto de ônibus rural;
  - ao longe, uma casa com janela tremeluzindo e uma torre com luz vermelha.
- **Luzes misteriosas:** de tempos em tempos, um par de faróis surge na neblina, se aproxima e desaparece.
- **Câmera:**
  - movimento lento e câmera na mão sutil;
  - cada tela tem seu enquadramento, e o assunto fica à direita em telas horizontais e na parte de cima em telas verticais.
- **Pós-processamento:**
  - tone mapping ACES e color grading frio;
  - bloom moderado, vinheta, granulação de filme, leve aberração cromática e dithering contra faixas.
- **Respeito ao usuário:** a câmera respeita o movimento reduzido, e relâmpagos e piscadas ficam suaves com "Reduzir flashes".

### Menu principal
**NOVO JOGO · CONTINUAR · CONFIGURAÇÕES · DOAR · ENVIAR UMA IDEIA · CRÉDITOS**, mais um controle de som e um botão de instalação. Todos os botões funcionam.

- **Novo jogo:**
  - transição cinematográfica e tela do prólogo;
  - se já existe um jogo salvo, o jogo pede confirmação antes de substituir.
- **Continuar:**
  - só fica ativo quando existe um salvamento **real e válido** do prólogo, e mostra qual é o ponto salvo;
  - sem salvamento, aparece desativado com o aviso "Nenhum jogo salvo ainda".
- **Créditos:** tela própria com animação sutil e exatamente os dados oficiais.
- **Navegação:** mouse, toque, teclado (setas, Tab, Enter, Esc) e **gamepad** (direcional, A e B).

### Prólogo jogável: "A ESTRADA"
Sequência curta (alguns minutos) em primeira pessoa, na mesma cena do menu:

1. Você acorda ao lado do carro.
2. Pega a **lanterna** no porta-luvas.
3. Liga o **rádio**: uma transmissão de emergência entrecortada, com legendas.
4. Lê um **bilhete** no ponto de ônibus.
5. Segue a linha amarela até o km 112, onde as luzes aparecem.

O jogo salva automaticamente em **checkpoints reais**, e é isso que habilita o CONTINUAR. Ao terminar, uma tela informa que **o Capítulo 1 está em desenvolvimento**.

Controles:

| Ação | Teclado e mouse | Controle | Toque |
| --- | --- | --- | --- |
| Andar | W A S D / setas | analógico esquerdo | círculo à esquerda |
| Correr | Shift | LT / L3 | empurrar o círculo até o fim |
| Olhar | mouse (clique para capturar) | analógico direito | arrastar à direita |
| Interagir | E ou clique | A | botão USAR |
| Lanterna | F | Y | botão LUZ |
| Pausar | Esc | Start | botão no canto |

### Doação via PIX (DOAR)
- Modal **APOIE LINHA MORTA** com o texto oficial e a chave completa, `cb82924d-0665-42f5-963a-8a720f8e6302` (chave aleatória).
- Botão **COPIAR CHAVE PIX**:
  - usa a Clipboard API e trata permissão negada;
  - confirma somente depois que a cópia deu certo;
  - se falhar, seleciona a chave para cópia manual.
- Instruções passo a passo e aviso de que a doação é opcional.
- O jogo **não simula pagamentos**, não pede dados bancários e não afirma que uma transferência foi recebida.
- **Não há QR Code.** Um "BR Code" PIX válido exige também o nome e a cidade do recebedor, que não foram fornecidos e verificados. Uma imagem com apenas a chave seria um QR de pagamento inválido.

### Enviar uma ideia
- **Formulário:**
  - campos de título, categoria (Melhoria, Missão, Mecânica, História, Outro jogo, Outro), descrição e nome ou @ opcional;
  - validação, limites de caracteres com contador, estado "Enviando…" e mensagens de sucesso ou erro;
  - botões **Copiar ideia** e **Compartilhar** (quando o aparelho permite) e link para **@0neajx**. Não precisa de login.
- **Servidor: função da Vercel em `/api/ideas`** (`api/ideas.ts`):
  - validação de entrada e limite de 8 KB;
  - antispam: campo-isca invisível, tempo mínimo de preenchimento, limite de links e limite de envios por IP;
  - respostas claras em português.
- **Honestidade:**
  - o sucesso só aparece **depois que o destino confirma o recebimento**;
  - sem destino configurado, o jogo diz isso claramente e oferece copiar ou compartilhar, sem fingir que enviou.

### Configurações (salvas no aparelho)
- **Gráficos:**
  - qualidade **Automática, Baixa, Média, Alta ou Ultra**, ou Personalizada;
  - resolução de renderização, partículas, sombras, pós-processamento, reflexos, densidade da cena e limite de FPS (Tela, 60 ou 30);
  - cada opção tem efeito real na cena.
- **Qualidade automática:**
  - escolhe um nível pela GPU, memória, núcleos e tamanho da tela;
  - **baixa o nível sozinha** se o FPS medido cair, e avisa quando faz isso.
- **Áudio:** liga/desliga e volumes separados para geral, música ambiente, ambiente (chuva e vento) e efeitos sonoros.
- **Tela:**
  - tela cheia, com explicação quando o aparelho não permite (iPhone);
  - campo de visão do prólogo e contador de FPS.
- **Acessibilidade:** movimento reduzido (Sistema, Ativado ou Desativado), reduzir flashes, alto contraste, tamanho do texto (100%, 115% ou 130%) e legendas.
- **Controles:** sensibilidade, inverter eixo Y e lista de comandos.

### Áudio procedural (Web Audio API)
- **Sons:**
  - chuva com gotas, inclusive pingos metálicos no carro;
  - vento nas árvores acompanhando as rajadas visuais;
  - interferência de rádio com murmúrio de "vozes" sem palavras;
  - estruturas metálicas distantes, trovões sincronizados com os relâmpagos e grave de baixa frequência discreto;
  - relé do pisca-alerta, passos no asfalto, cascalho e grama, transições e cliques de interface;
  - **música ambiente generativa** opcional.
- **Comportamento:**
  - o som só começa depois de uma interação do jogador;
  - todos os volumes mudam com rampas, sem estalos;
  - as trilhas nunca tocam em duplicidade;
  - o áudio pausa quando a aba fica em segundo plano.

### PWA (instalável)
- `manifest.webmanifest` com nome e nome curto LINHA MORTA, ícones 192×192 e 512×512, ícone maskable, cores de tema e fundo e modo standalone.
- Service worker (Workbox via `vite-plugin-pwa`):
  - **pré-cache só do essencial** (código, estilos, ícones e fontes, cerca de 1 MB);
  - a API nunca vai para o cache.
- Aviso de **nova versão disponível** com botão Atualizar e aviso de "pronto para offline".
- Botão **Instalar**: usa o prompt nativo quando o navegador oferece; nos outros casos, mostra instruções. O jogo nunca afirma que foi instalado só porque você clicou.

### Celulares e responsividade
- Funciona em computadores (Windows, macOS, Linux), Android, iPhone e iPad, nas orientações vertical e horizontal.
- Respeita as áreas seguras da tela (notch).
- Os efeitos diminuem em aparelhos mais fracos sem perder a identidade visual.
- A renderização pausa quando a aba fica em segundo plano.

---

## Bibliotecas e por que foram usadas

| Biblioteca | Uso | Por quê |
| --- | --- | --- |
| `three` | Renderização 3D (WebGL 2) | Exigência do projeto; maduro e bem documentado. Os passes de pós-processamento usados vêm do próprio pacote. |
| `@fontsource/barlow`, `@fontsource/barlow-condensed`, `@fontsource/cormorant-garamond` | Tipografia | Fontes empacotadas localmente (só o subconjunto latino, licença SIL OFL), sem depender do Google Fonts e funcionando offline. |
| `vite` *(dev)* | Servidor de desenvolvimento e build | Rápido, nativo de ESM, padrão da Vercel. |
| `vite-plugin-pwa` + `workbox-window` *(dev)* | Manifest, service worker e atualização | Solução compatível com Vite, sugerida no escopo. |
| `typescript` *(dev)* | Linguagem principal e checagem de tipos | Exigência do projeto. Fixado em 6.0, a versão suportada pelo `typescript-eslint`. |
| `vitest` *(dev)* | Testes automatizados | Integra com Vite e TypeScript sem configuração extra. |
| `eslint`, `@eslint/js`, `typescript-eslint`, `globals` *(dev)* | Lint | Qualidade de código e proibição de `eval`. |

Não há rastreadores nem sistemas de análise.

---

## Rodar localmente

Requisitos: **Node.js 20.19 ou superior** (testado com Node 22) e npm.

```bash
npm ci            # instala as dependências exatas do package-lock.json
npm run dev       # servidor de desenvolvimento em http://localhost:5173
```

O servidor local também atende `/api/ideas` com o mesmo código da Vercel. Para testar o envio real localmente, crie um `.env.local` com `IDEAS_WEBHOOK_URL=...`.

### Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Desenvolvimento com recarga automática |
| `npm run build` | Checagem de tipos e build de produção em `dist/` |
| `npm run preview` | Serve o build de produção (com a API e os mesmos cabeçalhos de segurança da Vercel) em http://localhost:4173 |
| `npm run typecheck` | Checagem de tipos (app e configurações) |
| `npm run lint` | ESLint |
| `npm test` | Testes automatizados (Vitest) |
| `npm run check` | Tudo acima em sequência |
| `npm run icons` | Regenera os ícones PNG do PWA (precisa do Playwright; os ícones já estão versionados) |

---

## Publicar na Vercel

O projeto já vem com `vercel.json`, que define:

- framework Vite, `npm ci` e `npm run build`, com saída em `dist`;
- a função `/api/ideas`;
- cabeçalhos de segurança (CSP, `nosniff`, `frame-ancestors`);
- cache imutável para `/assets`;
- sem cache para `sw.js` e para o manifest;
- reescrita para `index.html`, para que links diretos funcionem.

1. Envie o repositório para o GitHub (já está em `jeanvicen/linha-morta`).
2. Em [vercel.com](https://vercel.com), clique em **Add New… → Project** e importe o repositório. A Vercel detecta tudo pelo `vercel.json`.
3. (Opcional, mas recomendado) Configure `IDEAS_WEBHOOK_URL`, conforme a seção seguinte.
4. Clique em **Deploy**. Cada novo push na branch principal gera uma nova publicação.

Pela linha de comando: `npm i -g vercel`, depois `vercel` (pré-visualização) e `vercel --prod`.

> **Observação:** a publicação ainda **não foi feita** a partir deste ambiente. É preciso conectar sua conta da Vercel como descrito acima.

---

## Receber as ideias de verdade (`IDEAS_WEBHOOK_URL`)

Sem essa variável, o formulário avisa com honestidade que o envio automático não está disponível e oferece copiar ou compartilhar.

**Opção mais simples (Discord):**
1. No seu servidor do Discord: **Configurações do servidor → Integrações → Webhooks → Novo webhook**.
2. Escolha o canal e clique em **Copiar URL do webhook**.
3. Na Vercel: **Project → Settings → Environment Variables**:
   - **Name:** `IDEAS_WEBHOOK_URL`
   - **Value:** a URL copiada
   - **Environments:** Production (e Preview, se quiser)
4. Faça um novo deploy (**Deployments → … → Redeploy**). As ideias passam a chegar como mensagens no canal.

Também funciona com:
- **Slack**: `https://hooks.slack.com/services/...`;
- **qualquer URL HTTPS** que aceite `POST` com JSON (recebe `{ source, type, receivedAt, title, category, categoryLabel, description, author }`).

> ⚠️ **Nunca** crie essa variável com o prefixo `VITE_`. Variáveis `VITE_*` são embutidas no código do navegador e exporiam a URL. A URL fica apenas no servidor e nunca é devolvida nas respostas da API.

Para conferir se está ativo, abra `https://SEU-DOMINIO/api/ideas`. Deve aparecer `{"ok":true,"configured":true}`.

---

## Instalar como aplicativo (PWA)

Instalar o PWA **não é a mesma coisa** que baixar um APK Android ou um app de loja. **Não existe APK oficial.** O PWA usa o próprio navegador do aparelho, com ícone e janela própria.

- **Android (Chrome, Edge, Samsung Internet):** abra o site, toque no menu **⋮** e depois em **Instalar app** (ou **Adicionar à tela inicial**). O botão **Instalar** do menu do jogo também abre o pedido de instalação quando o navegador permite.
- **iPhone e iPad (Safari):** abra o site no Safari, toque em **Compartilhar** (quadrado com seta para cima), depois em **Adicionar à Tela de Início** e confirme.
- **Computador (Chrome ou Edge):** clique no ícone de instalação na barra de endereço, ou no botão **Instalar** do menu do jogo.

Depois de aberto uma vez, o menu e o prólogo funcionam offline.

---

## Estrutura do projeto

```
api/ideas.ts                 Função da Vercel (/api/ideas): validação, antispam e encaminhamento
public/                      favicon, ícones do PWA, robots.txt
scripts/generate-icons.mjs   Gera os ícones PNG a partir de um SVG
src/
  main.ts                    Ponto de entrada (fontes, estilos e App)
  app/                       App (orquestração), LoadingFlow (etapas reais), versão
  core/                      eventos tipados, armazenamento seguro, dispositivo/qualidade, erros, DOM, clipboard, matemática
  features/
    settings/                esquema, predefinições, validação e SettingsStore (persistência)
    save/                    salvamento do prólogo (validação de dados salvos)
    donation/pix.ts          chave e textos do PIX
    ideas/ideas.ts           validação, envio e alternativas do formulário de ideias
    pwa/install.ts           instalação e atualização do service worker
    credits.ts               créditos oficiais
  render/                    RenderManager (loop, DPR, limite de FPS, qualidade adaptativa), pós-processamento, reflexo planar
  world/                     cena: céu, neblina por altura, estrada/terreno, carro, vegetação, objetos, chuva, luzes, câmera
    procedural/              ruído e texturas procedurais
  audio/                     AudioManager e síntese procedural
  ui/                        ScreenManager (foco, Esc, gamepad), controles acessíveis, telas
  game/                      prólogo: entrada (teclado/mouse/gamepad/toque), jogador e colisões, HUD, roteiro
  styles/main.css            identidade visual
tests/                       testes (configurações, salvamento, qualidade automática, API de ideias, conteúdo oficial)
```

---

## Testes executados

**Verificações automáticas** (todas sem erros):
- `npm run typecheck`;
- `npm run lint`;
- `npm test`: **55 testes passando**. Cobrem:
  - validação e persistência das configurações e predefinições de qualidade;
  - salvamento (validação e "nunca inventar progresso");
  - estimativa de qualidade por GPU;
  - API de ideias **com e sem** `IDEAS_WEBHOOK_URL` (sucesso só após confirmação, falha do destino, erro de rede, antispam, limite de tamanho, limite por IP, URL nunca exposta);
  - chave PIX e créditos exatos;
- `npm run build`: build de produção, manifest e service worker gerados;
- `npm ci` com npm 10 validado contra o `package-lock.json` (o mesmo processo da Vercel).

**Testes no navegador** (Chromium headless com WebGL por software, servindo o build de produção com `npm run preview`, ou seja, com a CSP e os cabeçalhos da Vercel ativos):
- Carregamento até o menu sobre a cena 3D.
- Configurações: abas e predefinições aplicadas de verdade.
- Doar: cópia da chave PIX confirmada pela Clipboard API.
- Enviar uma ideia:
  - validação dos campos;
  - estado "envio não configurado" detectado via `/api/ideas`, com o botão Enviar oculto.
- Créditos.
- Novo jogo, introdução do prólogo e prólogo:
  - objetivo e legendas;
  - andar até o carro, pegar a lanterna e ligar o rádio (checkpoint);
  - pausar com Esc, "Salvar e voltar ao menu" e CONTINUAR habilitado com "Prólogo — O rádio";
  - a partir de um salvamento no checkpoint "A estrada": CONTINUAR, seguir pela estrada, aparição das luzes e tela "FIM DO PRÓLOGO".
- Celular em retrato: menu centralizado, painel de configurações em tela cheia, controles de toque no prólogo.
- Nenhum erro de console. Aparece só um aviso do WebGL por software sobre `KHR_parallel_shader_compile`.

**Não foi possível testar aqui:**
- desempenho em GPU real (o servidor não tem GPU; as predefinições Alta e Ultra são pesadas demais para o renderizador por software capturar tela);
- som audível (navegador sem saída de áudio);
- publicação real na Vercel.

## Limitações conhecidas

- Este é o **primeiro marco**. O mundo aberto e os sistemas de sobrevivência ainda não existem. O prólogo é curto e termina avisando que o Capítulo 1 está em desenvolvimento.
- Os testes visuais foram feitos com WebGL por software (sem GPU), que é muito mais lento que um aparelho real. O desempenho em GPUs reais não foi medido aqui. Por isso a qualidade automática também se ajusta pelo FPS medido no aparelho do jogador.
- O limite de envios por IP da API é por instância serverless (sem banco de dados). Para proteção forte contra spam, use também os recursos do destino (por exemplo, permissões do canal no Discord).
- No iPhone, páginas web não podem entrar em tela cheia. Instalar na Tela de Início resolve.
- A estimativa automática de qualidade depende do nome da GPU informado pelo navegador. Alguns navegadores escondem esse nome, e então o jogo usa um palpite conservador e corrige pelo FPS.
- WebGPU não foi usado: o WebGL 2 tem suporte muito maior hoje e atende todos os efeitos desta versão.

---

## Licenças de terceiros

- [three.js](https://github.com/mrdoob/three.js): MIT.
- Barlow, Barlow Condensed e Cormorant Garamond (via Fontsource): SIL Open Font License 1.1.

---

## Créditos

**CRIADOR:** Jean Carlos de Souza Vicen
**PROGRAMAÇÃO:** jeanvicen
**DESIGN:** jeanvicen
**HISTÓRIA:** jeanvicen
**INSTAGRAM:** [@0neajx](https://www.instagram.com/0neajx/)
