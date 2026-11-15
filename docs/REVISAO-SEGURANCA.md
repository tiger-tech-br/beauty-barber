# Revisão técnica e de segurança — BeautyBarber

Última revisão de código: 15/11/2026. Escopo: frontend React, API Express, migrações PostgreSQL, Docker Compose e projeto Android. **Esta revisão de código não equivale a pentest nem garante ausência de falhas.**

## Verificado nesta versão

| Área | Evidência no código | Limitação |
| --- | --- | --- |
| Sessões | Cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção; token aleatório e hash no banco | Precisa teste por navegador em HTTPS real |
| Senhas | `scrypt` com salt; reset temporário e invalidação de sessões | Teste de e-mail Resend real pendente |
| Autorização | Autorização por sessão e `establishmentId`; perfis por rota | Testes multiempresa no PostgreSQL de testes pendentes |
| CSRF | Escritas `/api` requerem `Origin` igual a `WEB_ORIGIN` | Confirmar cabeçalhos atrás do proxy existente |
| Exposição de dados | API com `Cache-Control: no-store`; Caddy com CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy` | Verificar cabeçalhos HTTPS no proxy público |
| Agenda | Validação de horários e restrição PostgreSQL `EXCLUDE` para conflitos | Concorrência real ainda precisa de banco de testes |
| Funcionamento e fuso | Salão escolhe seus horários, inclusive domingo opcional; pode definir exceções por data; vagas são a interseção com o expediente do profissional; mudanças não podem desalojar reservas futuras; alterações de fuso são recusadas se há reservas futuras ativas; folgas convertem horário local para UTC | Migrações 010 e 011, alterações semanais, pontuais e de fuso ainda exigem teste integrado com PostgreSQL e navegador |
| PagBank | Links externos; aprovação manual por administrador global com registro de auditoria | Não há webhooks de confirmação; nunca ativar por redirecionamento de checkout |
| Assinaturas | Escrita bloqueável por `SUBSCRIPTION_ENFORCEMENT=true`; desativado por padrão | Definir política de testes, inadimplência e reativação antes de ligar |
| VPS | Compose `beautybarber` com banco, rede, cookie, volumes e porta próprios | Não houve deploy nem acesso ao PetCore |
| Isolamento da conexão | URL PostgreSQL validada: só banco `beautybarber` em produção; nomes `petcore` e `postgres` bloqueados | Conferir no servidor real permissões distintas e volumes exclusivos |
| Android | WebView com HTTPS obrigatório, conteúdo misto desabilitado e destinos externos fora do app | APK não compilado/testado neste ambiente, sem Android SDK e URL HTTPS real |
| Exportação de dados | Apenas responsável autenticado, nova confirmação da senha, consultas filtradas por empresa, `no-store` e evento de auditoria sem conteúdo; exportação individual filtrada por cliente e empresa | Precisa testar com PostgreSQL real e navegador; o responsável deve conferir a identidade de quem solicita; dados pessoais em JSON exigem proteção |
| Logotipos dos estabelecimentos | Upload somente pelo responsável, PNG limitado a 256 KB e 1024 pixels por dimensão; arquivo em `BYTEA` no banco da empresa; rota pública publica somente a imagem do estabelecimento ativo | Inspeção de estrutura PNG e testes locais concluídos; upload, remoção e isolamento precisam de testes integrados e visuais |

## Testes locais realizados

- `npm run check` — TypeScript API e frontend sem erros.
- `npm test` — **28 testes aprovados** (23 na API e 5 no frontend), incluindo teste HTTP de origem e sessão, senha, proteção contra conexão acidental ao PetCore, domingo opcional, exceções de horário por data, validação de arquivo PNG, conversões de fuso e política opcional de assinatura.
- `npm run build` — builds de produção da API e frontend aprovados.
- Workflow `.github/workflows/beautybarber-ci.yml` — prepara PostgreSQL temporário, migrações, testes integrados, TypeScript e build no GitHub Actions; **não executado aqui**, pois ainda não há repositório remoto conectado.
- `npm audit --offline --omit=dev --audit-level=moderate` — sem alerta no cache local; por ser **offline**, não é verificação completa e atualizada de vulnerabilidades.
- Ícones favicon `.ico`, `.png`, manifesto web e ícones Android gerados e integrados.

## Bloqueios objetivos para liberar o SaaS comercialmente

1. Criar `beautybarber_test` em **banco exclusivo de testes** (nunca utilizar PetCore ou produção), aplicar as treze migrations e executar `npm run test:integration`. Inspecionar também rollback e backup-restauração, inclusive as exportações completa e individual, horários especiais e isolamento dos logotipos.
2. Implantar o BeautyBarber na VPS em projeto Docker separado; configurar subdomínio e proxy HTTPS existente **sem sobrescrever** PetCore. Verificar CORS/Origin real, cookies, cabeçalhos e limites de requisições.
3. Configurar Resend, DNS e domínio remetente; testar convites, recuperação de senha, confirmação e cancelamento público.
4. Definir preços, regra de teste grátis (se houver), inadimplência, limites por plano, reembolso e suporte. Validar os dois links recorrentes no PagBank. Integração automática exige documentação/API e eventos de cobrança autenticados, ausentes nesta versão.
5. Implementar e validar políticas LGPD (finalidade, retenção, acesso individual, exclusão/anônimização), termos e privacidade. A exportação de um cliente específico foi adicionada ao painel do responsável, mas depende de verificação manual da identidade e ainda não cria um canal automatizado de solicitação. Não realizar exclusões irreversíveis sem política do responsável.
6. Finalizar testes de interface em 360–430, 768 e 1440 pixels; acessibilidade, teclado, foco e compatibilidade. Validar ações no dispositivo Android real.
7. Instalar Android SDK e compilar o APK após definir a origem HTTPS definitiva; configurar keystore privado para release. Não distribuir build com URL de exemplo.
8. Completar funcionalidades comerciais não implementadas: limites de planos, cancelamento/troca de plano auditados, administração de planos com valores definidos, personalização visual além do logotipo e fluxo verificado de solicitação/exclusão de dados pessoais. O painel atual cobre operações centrais do MVP, não todos os módulos de uma plataforma madura.

**Conclusão:** a fundação e os principais fluxos estão codificados; sem as verificações acima, o produto não está validado para venda. Os resultados locais positivos não substituem testes integrados, auditoria em produção e revisão jurídica.
