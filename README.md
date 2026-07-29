<div align="center">

# 👋 `oPaozinh0/.github`

**Repositório especial do meu perfil no GitHub.**

<img src="https://img.shields.io/badge/Special%20Repo-181717?style=for-the-badge&logo=github&logoColor=white" alt="Special repo" />
<img src="https://img.shields.io/badge/Zero%20depend%C3%AAncias%20externas-FE428E?style=for-the-badge&logo=svg&logoColor=white" alt="Zero dependências externas" />

</div>

---

## 📁 O que tem aqui

| Caminho | O que é |
|---|---|
| [`profile/README.md`](profile/README.md) | O README que aparece no meu perfil ✨ (inglês) |
| [`profile/README.pt-BR.md`](profile/README.pt-BR.md) | A mesma coisa, em português |
| `profile/assets/*.svg` | Todos os cards, banners e gráficos — arquivos estáticos |
| [`scripts/refresh-cards.mjs`](scripts/refresh-cards.mjs) | O gerador que produz todos esses SVGs |
| [`.github/workflows/refresh-cards.yml`](.github/workflows/refresh-cards.yml) | Roda o gerador diariamente |

---

## 🎨 Por que os SVGs são gerados localmente

Os cards são gerados por um script e commitados como arquivos estáticos. Duas vantagens:

- **Carregam sempre** — o perfil não depende de nenhum serviço de terceiros estar de pé
- **Números reais** — o gerador usa um token com escopo `repo`, então as estatísticas
  incluem os repositórios privados, onde está a maior parte do meu trabalho

---

## 🔄 Como atualizar os cards

```bash
node scripts/refresh-cards.mjs             # gera tudo (~2 min)
node scripts/refresh-cards.mjs --no-snake  # pula a cobrinha, que é a etapa lenta
```

Depois é só commitar o que mudou em `profile/assets/`.

**Requisitos:** Node 18+, `git` e `gh auth login` já feito.

O que o script produz:

- `banner.svg` · `typing.svg` · `footer.svg` — identidade visual, com animação SVG nativa
- `stack.svg` — a stack inteira num único arquivo, no lugar de ~45 badges do shields.io
- `metrics.svg` · `achievements.svg` — números de carreira e conquistas
- `stats.svg` · `top-langs.svg` — via `github-readme-stats` rodado localmente
- `streak.svg` · `activity.svg` — calculados direto da API GraphQL
- `github-snake*.svg` — a cobrinha comendo o gráfico de contribuições

Cada card com texto sai em duas versões: inglês e `.pt-BR`. Os SVGs trazem um
`@media (prefers-color-scheme: light)` interno, então **o mesmo arquivo se adapta
ao tema claro ou escuro** do visitante, sem precisar de dois assets.

---

## 🔗 Contato

<div align="center">

<a href="https://www.linkedin.com/in/davio-vieira"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn" /></a>
<a href="mailto:davioliveira353.do@gmail.com"><img src="https://img.shields.io/badge/Email-D14836?style=for-the-badge&logo=gmail&logoColor=white" alt="Email" /></a>
<a href="https://wa.me/5518998268057"><img src="https://img.shields.io/badge/WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="WhatsApp" /></a>

</div>
