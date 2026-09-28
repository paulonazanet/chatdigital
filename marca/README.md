# Marca ChatDigital

Logomarcas e manual de identidade visual do **ChatDigital** (produto da marca **Eu no Digital**).

## Manual de identidade visual

📄 [`manual-identidade-visual-chat-digital.pdf`](./manual-identidade-visual-chat-digital.pdf) — versão 1.0,
setembro de 2026. Tem as regras completas (espaço livre, tamanhos mínimos, fundos permitidos, o que não
fazer). Resumo do que importa pro dia a dia do projeto:

### Cores oficiais

| Cor | Hex | RGB | Uso |
|---|---|---|---|
| Azul-marinho | `#172A5B` | 23, 42, 91 | Contorno do balão, palavra "chat", textos principais |
| Laranja | `#ED813B` | 237, 129, 59 | Pontinhos, cursor, palavra "digital" — cor de destaque |
| Cinza-azulado | `#64667D` | 100, 102, 125 | Slogan e textos de apoio |
| Cinza-azulado claro (fundo escuro) | `#C9CDE0` | — | Slogan sobre fundo escuro |

Em fundo escuro: contorno do balão e a palavra "chat" ficam brancos; o laranja não muda.

### Tipografia

**Poppins** (Google Fonts, gratuita) — Bold para o nome da marca e títulos, Regular/Medium para
slogan e textos. Sem a fonte disponível: usar Arial ou Calibri. Nunca redesenhar o logo com outra
fonte.

### Duas versões do símbolo

- **v2 "cursor"** — balão de conversa + cursor laranja (o cursor é o elo visual com a marca-mãe Eu no
  Digital). **Versão principal**, usar sempre que houver espaço.
- **v1 "balão"** — só o balão com os três pontinhos, sem cursor. Usar em tamanhos pequenos: abaixo de
  64 px, favicon, avatares — no v2 o cursor e o slogan ficam ilegíveis nesses tamanhos.

### Regra rápida de uso

- Espaço de sobra → logo horizontal completo v2.
- Espaço curto → só o símbolo (v2 se ≥ 64 px, v1 se menor).
- Site/app → preferir SVG. Redes sociais e e-mail → PNG.
- Fundo escuro → sempre a versão "fundo-escuro" (nunca o logo azul-marinho normal sobre fundo
  escuro/colorido).
- Margem livre mínima ao redor do logo: 2x (x = diâmetro de um pontinho laranja).

## Arquivos desta pasta

```
marca/
  logo-horizontal-v1-transparente.png      logo completo (símbolo v1, sem cursor) + nome, fundo transparente
  logo-horizontal-v2-transparente.png      logo completo v2 (com cursor) + nome + slogan, fundo transparente
  logo-horizontal-v2-fundo-branco.png      logo completo v2, fundo branco sólido
  logo-horizontal-v2-fundo-escuro.png      logo completo v2, fundo azul-marinho (para usar sobre telas escuras)
  icone-v1-balao-transparente.png          só o símbolo v1 (balão), sem texto, fundo transparente
  icone-v1-balao-fundo-branco.png          símbolo v1, fundo branco
  icone-v1-balao-fundo-escuro.png          símbolo v1, versão clara p/ fundo escuro
  icone-v2-cursor-transparente.png         só o símbolo v2 (balão + cursor), sem texto, fundo transparente
  icone-v2-cursor-fundo-branco.png         símbolo v2, fundo branco
  icone-v2-cursor-fundo-escuro.png         símbolo v2, versão clara p/ fundo escuro
  manual-identidade-visual-chat-digital.pdf  manual completo (regras, espaçamento, tipografia)

  svg/                                     mesmas versões acima em SVG (vetorial — preferir no site/app)
    logo-horizontal-v1.svg
    logo-horizontal-v2.svg
    logo-horizontal-v2-fundo-escuro.svg
    simbolo-v1-balao.svg
    simbolo-v1-balao-fundo-branco.svg
    simbolo-v1-balao-fundo-escuro.svg
    simbolo-v2-cursor.svg
    simbolo-v2-cursor-fundo-branco.svg
    simbolo-v2-cursor-fundo-escuro.svg

  favicon/                                 ícone da aba do navegador (traço mais grosso, pontinhos
                                            maiores — feito pra ficar legível em tamanho pequeno)
    favicon.svg, favicon.ico
    favicon-16x16.png, favicon-32x32.png, favicon-48x48.png, favicon-192x192.png, favicon-512x512.png
    apple-touch-icon.png                   180px, fundo branco, tela inicial do iPhone
```

### Qual arquivo usar em cada lugar do painel

- **Favicon do navegador**: `favicon/favicon.ico` + o set de PNGs em `favicon/`.
- **Sidebar do painel (`.marca`)**: `svg/logo-horizontal-v2.svg` (fundo claro) — o painel usa fundo
  claro na sidebar hoje.
- **Login / setup** (se tiver fundo azul-marinho): `svg/logo-horizontal-v2-fundo-escuro.svg`.
- **Ícone pequeno / avatar / PWA**: `svg/simbolo-v1-balao.svg` (abaixo de 64px, conforme o manual).
