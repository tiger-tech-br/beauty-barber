# BeautyBarber — SaaS para salões de beleza e barbearias

Produto comercial multiempresa **BeautyBarber**. Identidade visual aprovada: verde-petróleo `#244B50`, terracota `#B8795C`, fundo claro `#F7F6F3`, texto `#20262D` e superfícies brancas. O nome técnico da pasta e dos pacotes ainda é `studio-saas` para preservar os comandos de desenvolvimento já configurados.

## Tecnologias

- React, TypeScript, Vite, React Router e SCSS no Front-end.
- Node.js, Express, TypeScript e PostgreSQL na API.
- Sessões próprias, com cookies HttpOnly e token persistido somente como hash no banco.
- Docker Compose + Caddy + PostgreSQL exclusivo do BeautyBarber para compartilhar a **Hostinger VPS** com o PetCore, sem compartilhar dados, volumes ou portas públicas.
- Resend opcional para confirmação de agendamentos e recuperação de senha; sem configuração, os pedidos públicos ficam desabilitados.

## Requisitos

1. Node.js **22.12 ou superior** e npm.
2. PostgreSQL 15+ local **ou** Docker Desktop com Compose.
3. VS Code recomendado.

## Começar pelo VS Code (Windows)

Abra a pasta `studio-saas` no VS Code e execute no terminal:

```powershell
copy .env.example .env
npm install
```

Atualize a senha de `DATABASE_URL` para a senha do seu PostgreSQL. Crie um banco local vazio chamado `beautybarber` (separado do PetCore) e execute:

```powershell
npm run db:migrate
```

Em dois terminais separados:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Visite `http://localhost:5173`. A API atende em `http://localhost:3001/api/health`.

**Na VPS compartilhada com o PetCore:** ajuste `DATABASE_URL` para o PostgreSQL privado do BeautyBarber (`postgresql://beautybarber_app:senha@db:5432/beautybarber`) e `WEB_ORIGIN` para o subdomínio **aprovado** `https://beautybarber.tigertech.dev.br` (ainda sem DNS/HTTPS/deploy verificados). O `compose.yaml` usa projeto Docker, rede, usuário, banco, cookie e volumes exclusivos. Por segurança, o Caddy do BeautyBarber atende somente em `127.0.0.1:18080`, sem disputar as portas públicas 80/443 do PetCore. Antes do deploy, será necessário inspecionar o proxy existente para conectar o subdomínio. **Leia `docs/DEPLOY-HOSTINGER.md` antes de qualquer comando na VPS.**

Para habilitar e-mail, crie uma conta Resend, configure e verifique o domínio remetente e preencha `RESEND_API_KEY` e `RESEND_FROM` no `.env`. **Nunca** envie sua chave para o frontend ou para o repositório.

## Módulos implementados no código

- Landing e identidade **BeautyBarber** com logotipo escolhido (opção 02), imagens próprias de salão, barbearia, login e hero.
- Favicon nas abas do navegador e ícone Android com a marca 02. Projeto nativo Android para APK em `android-beautybarber/` (compilação depende da origem HTTPS e do Android SDK; consulte `docs/ANDROID-APK.md`).
- Cadastro de empresa, login/logout, sessões HttpOnly, recuperação de senha por e-mail, convites para equipe, permissões e troca de empresa quando um usuário participa de mais de uma.
- Identidade própria de cada estabelecimento: o responsável pode enviar ou remover seu logotipo PNG (máximo de 256 KB e 1024 × 1024 pixels) em **Configurações**; a página pública de agendamento mostra a marca do salão, sem substituir o logotipo oficial do BeautyBarber. A imagem fica guardada no banco do **BeautyBarber**, isolada por estabelecimento e coberta pelos mesmos backups do PostgreSQL.
- Cadastro de serviços, profissionais e clientes; associação de serviços e turnos/intervalos por profissional. **O estabelecimento escolhe e pode editar seus próprios horários em Configurações**, inclusive abrir/fechar mais cedo e optar por domingos. Também pode cadastrar **horários especiais por data** (feriados, fechamento antecipado, abertura extraordinária) e restaurar o horário semanal sem alterar os outros dias. A agenda disponibiliza apenas a interseção entre o funcionamento do salão e o expediente do profissional. Sem horários cadastrados para o salão, não há vagas disponíveis. Mudanças que afetem agendamentos futuros são recusadas até remarcar ou cancelar os atendimentos. Registro e remoção de folgas/bloqueios, com validação contra atendimentos existentes.
- Histórico de atendimentos por cliente; vinculação da conta de usuário ao cadastro profissional pelo responsável e **agenda pessoal somente para leitura** no perfil Profissional.
- Agenda interna diária, semanal e mensal; disponibilidade por duração, expediente e bloqueios; agendamento, alteração de status, remarcação e histórico. O banco impede conflitos concorrentes para o mesmo profissional.
- Migrações `010_establishment_hours.sql` (funcionamento semanal), `011_special_hours.sql` (exceções por data), `012_establishment_logos.sql` (logotipo próprio) e `013_customer_export_audit.sql` (auditoria de exportação individual), isoladas por empresa no PostgreSQL. Execute `npm run db:migrate` antes de iniciar a versão atualizada.
- Datas, relatórios e folgas usam o fuso horário cadastrado do estabelecimento. Para evitar deslocar reservas, a API recusa a troca de fuso enquanto houver agendamentos futuros ativos.
- Agendamento público em `/agendar/slug-da-empresa` com verificação obrigatória por e-mail antes de reservar o horário; link de cancelamento ao cliente.
- Dashboard com métricas reais, recebimentos registrados manualmente, relatórios básicos e configurações comerciais.
- Área do responsável para assinatura mensal/anual e solicitação de conferência; área restrita para administrador geral revisar solicitações.
- Painel global de estabelecimentos e estado de assinaturas sem dados de clientes; suspensão e reativação manuais com motivo e auditoria.
- Exportação de dados operacionais do estabelecimento em JSON, restrita ao responsável, com nova confirmação de senha e registro da operação sem armazenar o arquivo exportado. Para não sobrecarregar o servidor, exportações acima de 10 mil registros exigem atendimento assistido, sem entrega parcial. Em **Clientes → Histórico**, o responsável também pode exportar o cadastro e os registros de atendimento de um cliente específico, após confirmar a senha; deve verificar a identidade do titular antes de compartilhar o arquivo. **Ainda não implementa solicitações públicas verificadas de acesso nem exclusão/anônimização de dados pessoais.**

### Assinaturas PagBank — atenção

Links recorrentes fornecidos pelo proprietário:

- Mensal: `https://pag.ae/82miujJ7H`
- Anual: `https://pag.ae/82miv8vhM`

O checkout é externo. Estes links **não** fornecem ao BeautyBarber, por si só, dados suficientes para associar automaticamente o pagamento a uma empresa. A ativação implementada é **manual**, após a conferência no painel oficial do PagBank. Não existem webhooks de cobrança integrados. Existe controle opcional por `SUBSCRIPTION_ENFORCEMENT=true`, que bloqueia novas alterações operacionais e agendamentos públicos de empresas sem assinatura confirmada e vigente, mas permite consultas, acesso à conta, cobrança e cancelamento público de compromissos existentes. **A opção vem desativada por padrão**. A escolha de preços, regras de teste e limites por plano ainda precisa ser formalizada antes de ativá-la e comercializar.

Para habilitar o responsável pelo painel global, somente um operador confiável com acesso ao banco deve definir `users.is_platform_admin = true` para a conta indicada. Nunca ofereça esse campo no cadastro público. O administrador poderá então abrir `/plataforma/cobrancas`.

### Pendências antes de vender

- Testar as migrations de ponta a ponta com PostgreSQL real, incluindo conflitos simultâneos e isolamento entre empresas; revisar fluxos manualmente no navegador, desktop e celular.
- Configurar Resend, domínio HTTPS, DNS e backups na Hostinger VPS, testar entrega de e-mails e restaurar backups em ambiente seguro.
- Definir política comercial de acesso, testes gratuitos e inadimplência; integrar uma API de assinaturas quando a conta PagBank permitir, ou manter processo manual documentado.
- Completar gerenciamento financeiro avançado, relatórios mais completos, personalização adicional do estabelecimento além do logotipo e fluxo verificado de solicitação de dados/exclusão/anônimização de clientes.

Checklist detalhado e limites da validação atual: `docs/REVISAO-SEGURANCA.md`. O projeto Android fica em `android-beautybarber/`; até informar a origem HTTPS real e compilar num ambiente com Android SDK, **não existe APK final validado**.

**O código não foi declarado pronto para comercialização.** O build e os testes unitários podem ser executados sem banco; os testes de integração dependem de PostgreSQL disponível.

## Testes e atualização do banco

Após baixar uma versão atualizada do ZIP, **não apague sua base de dados**. O comando `npm run db:migrate` aplica somente migrations ainda não registradas.

```powershell
npm run check
npm test
npm run build
npm run db:migrate
```

Para validar o isolamento real entre empresas, crie **um segundo banco vazio** com nome terminado em `_test` (ex.: `beautybarber_test`), aplique nele as mesmas migrations e depois execute:

```powershell
$env:TEST_DATABASE_URL="postgresql://beautybarber_app:senha@localhost:5432/beautybarber_test"
$env:DATABASE_URL=$env:TEST_DATABASE_URL
npm run db:migrate
Remove-Item Env:DATABASE_URL
npm run test:integration -w @studio/api
```

O teste de integração se recusa a executar se o nome do banco não terminar em `_test`. Ele cria duas empresas temporárias, testa isolamento, CSRF, concorrência de agenda, bloqueios, histórico de clientes, agenda individual do profissional e exceções de funcionamento por data. **Nunca use dados reais de clientes no banco de testes.**

O arquivo `.github/workflows/beautybarber-ci.yml` executa esse mesmo roteiro automaticamente em um PostgreSQL **temporário e descartável** do GitHub Actions quando o código for enviado a um repositório GitHub. Ele não acessa a Hostinger nem o PetCore e não precisa das credenciais do servidor. **O fluxo passou no GitHub Actions em 16/11/2026**, incluindo integração multiempresa e backup/restauração em PostgreSQL temporário ([execução](https://github.com/tiger-tech-br/beauty-barber/actions/runs/43966025373)). Isso não substitui testes na VPS de produção.

## Princípios de segurança

- Todo acesso a registros de uma empresa deverá obter `establishmentId` **exclusivamente da sessão autenticada**.
- A API usa origem permitida para ações que modificam dados, hashes de senha scrypt, SQL parametrizado e controle de taxa nos endpoints de autenticação.
- A conta de administrador global não é criada pelo formulário público.
- O banco guarda usuários e sua vinculação a estabelecimentos separadamente, permitindo trocar de empresa quando um profissional participa de mais de um local.

Consulte `docs/ARQUITETURA.md` para as próximas etapas.

