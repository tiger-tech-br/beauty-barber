# Arquitetura e roteiro de evolução

## Objetivo

SaaS por assinatura para salões de beleza, barbearias e negócios de estética, operado por várias empresas isoladas. Interface em português brasileiro, moeda BRL, datas locais e boa experiência de uso no celular.

## Módulos do MVP

| Ordem | Módulo | Situação |
| --- | --- | --- |
| 1 | Fundação, cadastro, login e sessões | Implementado no código; falta validação com PostgreSQL real |
| 2 | Equipe, serviços, clientes, expediente e bloqueios | CRUDs, turnos e folgas implementados; falta teste de interface |
| 3 | Agenda diária/semanal/mensal, conflitos e histórico | Implementado no código; falta integração real e QA |
| 4 | Agendamento público e prevenção de spam | Fluxo por e-mail implementado; depende do Resend configurado |
| 5 | Dashboard e relatórios operacionais | Indicadores e relatórios básicos implementados; evoluções previstas |
| 6 | Planos e assinatura PagBank | Checkout por link e aprovação manual; automação não disponível |
| 7 | E-mails Resend, segurança avançada, LGPD e lançamento | E-mails no código; infraestrutura, conformidade e testes pendentes |

## Papéis

- `owner`: administrador do estabelecimento; configura equipe, agenda e serviços.
- `receptionist`: administra operação e agenda; sem administração de assinaturas.
- `professional`: consulta somente seus próprios atendimentos quando o responsável vincula a conta ao cadastro profissional.
- `is_platform_admin` (usuário global): acesso à operação da plataforma por rotas **separadas** e sem acesso geral a dados de clientes.

O cadastro aberto atribui somente `owner` à nova empresa. Convites de equipe são controlados pelo responsável; o perfil profissional não acessa os cadastros administrativos.

## Fluxos

1. Visitante acessa landing `/` e escolhe **Criar conta** → `/cadastro`.
2. Preenche nome, e-mail, senha e nome do estabelecimento → cadastro transacional → sessão → `/painel`.
3. Usuário existente entra por `/entrar` → sessão → `/painel`.
4. O painel lê `/api/overview` usando cookie de sessão. O servidor resolve o estabelecimento autorizado sem aceitar `establishmentId` da URL ou do corpo da requisição.
5. Proprietário configura horários do salão em Configurações e expediente dos profissionais em Profissionais; a agenda oferece somente a interseção dos dois. Cria serviços e clientes → agenda interna; cliente recebe link público `/agendar/:slug` → solicita horário → verifica e-mail → reserva pendente.
6. O responsável convida um usuário profissional em Configurações e vincula essa conta no cadastro do profissional → o usuário consulta a própria agenda em `/painel/minha-agenda`.

## Banco PostgreSQL

Migração `001_core.sql`:

- `establishments`: dados de cada negócio.
- `users`: identidade global do usuário.
- `memberships`: função do usuário em cada empresa, com FK composta para impedir combinações inválidas.
- `sessions`: token de sessão guardado por hash e contexto de empresa autorizado.

Migração `002_management.sql`:

- `services`: duração, preço em centavos, categoria, status.
- `professionals` e `professional_services`: relação de profissionais com serviços de sua própria empresa, protegida por FKs compostas.
- `working_hours`: períodos semanais; restrição `EXCLUDE` impede sobreposição de turnos para o mesmo profissional e dia.
- `schedule_blocks`: estrutura para folgas e bloqueios futuros.
- `customers`: nome obrigatório; telefone, e-mail e observações operacionais opcionais.

Migrações adicionais implementadas: `003_appointments.sql` (agenda, histórico, restrição de conflito); `004_billing.sql` (assinaturas e pedidos de conferência manual); `005_public_booking.sql` (solicitações de agendamento com e-mail verificado); `006_receipts.sql` (recebimentos anotados manualmente); `007_account.sql` (equipe, convites, recuperação de senha, dados comerciais); `008_professional_account.sql` (vinculação opcional da conta do usuário ao profissional); `009_data_exports.sql` (auditoria de exportações); `010_establishment_hours.sql` (funcionamento semanal por empresa); `011_special_hours.sql` (aberturas e fechamentos excepcionais por data); `012_establishment_logos.sql` (PNG de marca do estabelecimento, armazenado no PostgreSQL e isolado por empresa); `013_customer_export_audit.sql` (auditoria de exportação individual por cliente).

Os agendamentos possuem uma **exclusion constraint por profissional e intervalo de tempo** (`btree_gist` + `tstzrange`) para impedir conflitos simultâneos no próprio banco. Os relacionamentos multiempresa usam `establishment_id` e chaves compostas. **Esse desenho precisa ser validado num PostgreSQL de testes**, que não está disponível no ambiente atual.

## Rotas iniciais

| Método | Rota | Autenticação |
| --- | --- | --- |
| GET | `/api/health` | Pública |
| POST | `/api/auth/register` | Pública, limitada |
| POST | `/api/auth/login` | Pública, limitada |
| POST | `/api/auth/logout` | Sessão + origem |
| GET | `/api/auth/me` | Sessão |
| GET | `/api/overview` | Sessão + empresa |
| GET/PUT | `/api/account/opening-hours` | Consulta autenticada/edição pelo responsável |
| GET/POST | `/api/services` | Responsável/recepção |
| PUT | `/api/services/:id` | Responsável/recepção |
| GET/POST | `/api/professionals` | Responsável/recepção |
| PUT | `/api/professionals/:id` | Responsável/recepção |
| GET/PUT | `/api/professionals/:id/working-hours` | Responsável/recepção |
| GET/POST | `/api/customers` | Responsável/recepção |
| PUT | `/api/customers/:id` | Responsável/recepção |
| GET | `/api/customers/:id/history` | Responsável/recepção |
| GET/POST/DELETE | `/api/calendar/blocks` | Responsável/recepção (DELETE por ID) |
| GET | `/api/calendar/mine` | Profissional, apenas agenda vinculada |
| PUT | `/api/professionals/:id/account` | Responsável |

## Navegação principal prevista

Landing → Criar conta / Entrar → Visão geral → Agenda, Serviços, Profissionais, Clientes, Recebimentos, Relatórios, Configurações e Assinatura. Para o perfil Profissional: Visão geral, Minha agenda e Configurações.

## Hostinger VPS compartilhada com o PetCore

`compose.yaml` usa o projeto Docker `beautybarber`, volume de banco `beautybarber_postgres_data`, usuário `beautybarber_app`, base `beautybarber` e rede privada `beautybarber_private`. Publicação HTTP somente em `127.0.0.1:18080`; o proxy existente do PetCore já ocupa 80/443. **Nenhum deploy na VPS foi feito** e o planejamento do roteamento HTTPS permanece pendente. Consulte `DEPLOY-HOSTINGER.md` antes de instalar.

O acesso à escrita operacional e aos novos agendamentos públicos pode ser exigido pela flag `SUBSCRIPTION_ENFORCEMENT=true`, que consulta assinatura **ativa e vigente** no banco exclusivo da plataforma. O padrão é `false` até serem definidas regras de teste e inadimplência; o checkout externo nunca ativa a assinatura automaticamente. O aplicativo Android nativo utiliza uma origem HTTPS própria, configurada no build, e mantém cookies sob o mesmo domínio. Consulte `ANDROID-APK.md`.

## Segurança e riscos

- Sessões armazenadas no PostgreSQL e cookies `HttpOnly`, `SameSite=Lax`, `Secure` quando HTTPS.
- O registro da primeira empresa e associação do dono ocorre numa transação.
- Revisão de identidade, CSRF, rate limiting persistente em proxy, recuperação de senha, logs de auditoria, backups e restauração **antes de vender**.
- Para o PagBank: confirmar se o contrato contratado permite gerir planos e consumir webhooks recorrentes; nunca marcar como pago apenas por retorno do navegador.
- Para agendamento público: limitar tentativas, validar e-mail e pensar em antifraude, acessibilidade e retenção de dados.
- Política LGPD, exportação e exclusão de dados, termos e registros de consentimento ainda precisarão ser definidos.

