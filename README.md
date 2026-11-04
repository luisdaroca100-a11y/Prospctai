# Prospecção de clientes por nicho

Ferramenta simples e prática para o Luis achar negócios por nicho e raio,
ver endereço, telefone, nota, se têm site (e uma estimativa da qualidade
do site) e chamar no WhatsApp com a mensagem pronta.

Arquitetura igual à dos outros projetos dele (FinanSmart, teste fal.ai):
frontend estático + serverless Vercel, zero dependências, sem login nem
banco de dados. Os contatos marcados ficam só no aparelho (localStorage).

## Como funciona

1. Digite o nicho (ex.: `pizzaria`), escolha o raio (5/10/25/50 km) e a
   cidade (padrão: Piracicaba, SP).
2. A fonte de dados depende da configuração (veja "Fonte de dados"
   abaixo): com a chave do Google, a busca usa o Google Places API
   (New); **sem a chave, usa o mapa grátis OpenStreetMap**
   (geocoding via Nominatim + busca via Overpass API). Mostra nome,
   categoria, endereço, distância, nota (só no Google), telefone e
   site. Como o viés de círculo não restringe, o servidor ainda corta
   pelo raio a lista devolvida (só fica quem está dentro dos km
   escolhidos).
3. Filtros: Todos / Sem site / Com site. Ordenação: distância ou avaliação.
4. "Avaliar site" abre o site no servidor e estima a qualidade por sinais
   (acessível, https, viewport mobile, link de WhatsApp, título) — é uma
   estimativa, não um veredito.
5. "WhatsApp" abre um painel com a mensagem pronta (variante com site /
   sem site, editável). "Abrir WhatsApp" abre o `wa.me` com o texto
   preenchido — **você envia**. Nada é disparado em massa automaticamente.

## Fonte de dados: mapa grátis (padrão) e Google (upgrade)

**Padrão, sem chave nenhuma: OpenStreetMap (grátis).** A cidade é
localizada pelo Nominatim e os negócios são buscados na Overpass API
por etiquetas (ex.: pizzaria → restaurante/fast-food com culinária
pizza) mais um fallback pelo nome do negócio. Limites honestos: o
OpenStreetMap tem **menos negócios cadastrados que o Google** (sobretudo
comércios pequenos), **telefone e site muitas vezes faltam** e **não há
nota/avaliação** (a lista mostra "Sem nota"). O que vem de lá é dado
real — nunca inventado.

**Com a chave `GOOGLE_PLACES_API_KEY`: Google Places API (New).** Mais
resultados, com telefone, site e nota. A troca é automática: basta a
chave estar configurada no ambiente — nenhum código muda.

**Demonstração (só para testar a interface):** abrir a busca com
`?demo=1` na URL devolve 6 negócios **obviamente fictícios**
(ex.: "Pizzaria Exemplo"), todos marcados `DEMONSTRAÇÃO`. Fora dessa
flag, a demonstração não aparece em nenhum fluxo. Nunca apresente a
demonstração como resultado real.

**Política de uso do mapa grátis:** o Nominatim e a Overpass pedem
identificação da aplicação (o código envia `User-Agent:
prospeccao-clientes/1.0`) e uso educado: uma busca faz no máximo 1
chamada de geocoding (com cache por cidade) + 1 chamada Overpass.
Não faça buscas em rajada — em uso normal (algumas dezenas por dia)
não há problema.

## Configuração (só nomes de variáveis — nunca cole valores no chat)

1. No Google Cloud Console, crie um projeto (ou use um existente) e ative
   o **faturamento** (a Places API exige conta de faturamento; há cotas
   gratuitas mensais — veja "Custo" abaixo).
2. Ative as APIs **Places API (New)** e **Geocoding API**.
3. Crie uma **chave de API** restrita a essas duas APIs (e, se quiser,
   restrita por HTTP referrer/endereço do app) e guarde o valor.
4. Crie o repositório no GitHub (sugestão de nome: `prospeccao-clientes`)
   e suba estes arquivos.
5. Na Vercel, importe o repositório e crie a variável de ambiente
   `GOOGLE_PLACES_API_KEY` com o valor da chave (aba Environment
   Variables, ambiente Production). **Nunca** cole a chave no chat nem no
   código.
6. Faça o deploy. A página mostra "Busca real ativa" quando a chave está
   configurada.

Desenvolvimento local: `npx vercel dev` (as rotas `/api/*` precisam do
runtime serverless; abrir o `index.html` direto mostra erro de servidor
— com `?demo=1` na URL, mostra a demonstração).

## Custo

**Mapa grátis (OpenStreetMap): R$ 0.** Sem chave, sem cadastro, sem
faturamento. É a fonte padrão do sistema.

**Google (upgrade, aproximado — confirme na página de preços do Google)**

A busca usa os campos website/telefone/nota, que ficam no nível
Enterprise do Places API (New): cerca de US$ 35 a cada 1.000 buscas,
com 1.000 buscas grátis por mês. Uma busca = uma chamada (até 20
resultados). Uso leve (algumas centenas de buscas/mês) fica dentro da
cota gratuita. O Google mudou a estrutura de preços em 2025 (aposentou
o crédito de US$ 200 e passou a cotas gratuitas por SKU) — confira os
valores atuais na página oficial de preços do Google Maps Platform
antes de orçar.

## WhatsApp: modo seguro (v1) e API oficial (futuro)

A v1 usa o modo **semiautomático seguro**: a mensagem é preparada e o
WhatsApp abre para você enviar, um por um. Sem disparo em massa.

A API oficial do WhatsApp (Meta Cloud API) **não** está na v1. Ela
exige conta WhatsApp Business, verificação da empresa, modelos de
mensagem pré-aprovados pela Meta e custa por mensagem entregue
(~R$ 0,32 por mensagem de marketing no Brasil, valores de 2026).
Mesmo pela API oficial, mandar mensagem promocional em massa para quem
não pediu pode derrubar a qualidade do número e **banir o número**.
Não use esta ferramenta para disparo em massa.

## Estrutura

```
index.html            interface (pt-BR, mobile-first)
styles.css            tema escuro (preto/grafite + verde-esmeralda)
app.js                busca, filtros, painel do WhatsApp, contatados
api/_lib.js           lógica pura compartilhada (telefone, wa.me, mapa, nota)
api/osm.js            mapa grátis: Nominatim + Overpass (nicho → etiquetas, mapeamento)
api/config.js         GET → { placesConfigured, source } (nunca expõe a chave)
api/search.js         POST → busca no Google Places, no mapa grátis ou demonstração (?demo=1)
api/check-site.js     POST → estimativa de qualidade do site
test/test-prospeccao.js  testes sem rede (node test/test-prospeccao.js)
```

## Testes

```
node --check api/_lib.js api/osm.js api/config.js api/search.js api/check-site.js app.js
node test/test-prospeccao.js
```
