# Publicação na Hostinger VPS (preparação)

Projeto preparado para a **mesma VPS que já hospeda o PetCore**, mas numa instalação totalmente separada. Usa Docker Compose: Caddy para interface e proxy interno da API, Express e **PostgreSQL 17 exclusivo do BeautyBarber**. **Não depende do Neon e não usa o banco do PetCore.**

**Domínio informado pelo proprietário:** `tigertech.dev.br`. **Subdomínio aprovado pelo proprietário para o BeautyBarber:** `beautybarber.tigertech.dev.br`. O endereço está definido para a aplicação, **mas o DNS, HTTPS e o deploy ainda não foram configurados nem verificados**. O domínio principal `tigertech.dev.br` e as rotas do PetCore devem permanecer intactos.

O banco `beautybarber` está no serviço Docker `db` e usa o volume próprio `beautybarber_postgres_data`. O volume preserva os dados entre reinícios normais dos contêineres, mas **não é backup**.

## Separação obrigatória dos projetos

| Item | PetCore | BeautyBarber |
| --- | --- | --- |
| Pasta na VPS | Preservar instalação atual | `/srv/beautybarber` (pasta nova) |
| Projeto Docker Compose | Preservar nome atual | `beautybarber` |
| Banco PostgreSQL | Preservar banco atual | `beautybarber` |
| Usuário PostgreSQL | Preservar usuário atual | `beautybarber_app` |
| Volume do banco | Preservar volume atual | `beautybarber_postgres_data` |
| Rede Docker | Preservar rede atual | `beautybarber_private` |
| Cookie | Preservar sessão atual | `beautybarber_session` |
| Portas públicas 80/443 | Preservar proxy atual | **Não ocupa essas portas** |

**Nunca** copie a `DATABASE_URL` do PetCore para o BeautyBarber. Os dois PostgreSQL podem usar a **porta interna 5432** simultaneamente em redes Docker diferentes, sem conflito. A porta 5432 não é publicada no host.

**Trava adicional no código:** a API do BeautyBarber se recusa a iniciar ou migrar um banco chamado `petcore`, `postgres` ou qualquer nome diferente de `beautybarber` em produção. Essa verificação reduz erros de configuração, mas **não substitui** banco e usuário separados com permissões mínimas.

## Antes de publicar

1. **Inspecionar o estado atual da VPS:** contêineres, projetos Compose, redes, volumes, portas, memória e disco, identificando os recursos do PetCore.
   O script `bash scripts/vps-preflight.sh` faz um inventário **somente de leitura** e indica possíveis colisões; guarde a saída sem compartilhar credenciais.
2. Ter backup e plano testado de recuperação do PetCore **antes de alterar o proxy existente**. Não reiniciar nem recriar seus contêineres como parte deste deploy.
3. Verificar que não existem recursos com os nomes `beautybarber_postgres_data` e `beautybarber_private`, nem processo usando a porta local `18080`.
4. Criar `/srv/beautybarber` para este projeto, separado da pasta do PetCore.
5. Após inspecionar a zona DNS atual, criar o registro apropriado para o subdomínio **aprovado** `beautybarber.tigertech.dev.br` apontando à VPS, preservando os registros DNS do domínio principal, PetCore, e-mails e validações. Se o subdomínio já tiver um registro, não substituí-lo automaticamente.
6. Integrar a nova aplicação ao **proxy HTTPS que já atende o PetCore**, com roteamento por domínio para o BeautyBarber. Se o proxy também estiver num contêiner, o acesso à porta local exige inspeção das redes; `127.0.0.1` de outro contêiner não é o host.
7. Configurar backups externos dos **dois bancos separadamente**, monitoramento e atualização de segurança.

## Configuração de ambiente

Crie `.env` na VPS a partir de `.env.example` com **senha forte e única**. Defina:

```dotenv
NODE_ENV=production
POSTGRES_USER=beautybarber_app
POSTGRES_DB=beautybarber
POSTGRES_PASSWORD=SENHA_FORTE_UNICA
DATABASE_URL=postgresql://beautybarber_app:SENHA_FORTE_UNICA@db:5432/beautybarber
BEAUTYBARBER_LOCAL_PORT=18080
SITE_ADDRESS=:80
WEB_ORIGIN=https://beautybarber.tigertech.dev.br
RESEND_API_KEY=
RESEND_FROM=
```

Use uma senha nova **diferente da senha do PetCore**. Se tiver caracteres reservados de URL, codifique-os na `DATABASE_URL`. Não faça commit do `.env`.

**Somente depois** de verificar os nomes, a porta e o proxy na VPS, execute na pasta `/srv/beautybarber`:

```bash
docker compose config
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 api
```

O contêiner da API aplica as migrations **apenas no banco indicado por `DATABASE_URL`**. O Caddy do BeautyBarber atende por HTTP interno em `127.0.0.1:18080`; o proxy público existente é o responsável por HTTPS. **Não instalar outro proxy público competindo pelas portas 80/443.**

### Onde estão armazenados os dados

- `db` roda PostgreSQL dentro da VPS e é acessado pela API pelo nome de serviço `db`, na rede privada do Docker.
- `beautybarber_postgres_data` é um volume exclusivo no disco da VPS. **Não rode `docker compose down --volumes`**, pois isso destruiria o volume do banco.
- A porta `5432` não está publicada no `compose.yaml`; o banco não aceita conexão pública diretamente.
- Não há chave do Neon na configuração. Use `DATABASE_URL` com `@db:5432/beautybarber` **somente para o serviço API no Docker**; no Windows local, a conexão depende do seu PostgreSQL instalado.

### Backup obrigatório antes de receber clientes

Na raiz do projeto, execute na VPS:

```bash
bash scripts/backup-db.sh
```

O script cria um arquivo de backup lógico em `backups/` e valida a leitura da estrutura. Este backup continua **na mesma VPS** até ser copiado. Programe cópias automáticas para um armazenamento externo seguro (de preferência criptografado), defina retenção e teste periodicamente a restauração em **outro banco vazio de teste**. Os snapshots/backups de VPS do hPanel são complementares, não substituem backups lógicos próprios nem o teste de restauração.

**Não restaure um backup sobre o banco de produção sem uma janela de manutenção, um backup recente e um procedimento de recuperação ensaiado.**

### Publicação ainda pendente

Para realmente instalar o banco na Hostinger são necessários **acesso autorizado à VPS existente**, inspeção do PetCore e do proxy, além do subdomínio escolhido. A configuração acima está preparada localmente, **mas ainda não foi instalada na VPS**. A implantação deve ser validada em ambiente de testes antes de receber dados reais.

**Acesso remoto nesta sessão:** a Hostinger restringe o login pelo navegador em nuvem utilizado aqui. Por isso não foi possível consultar a VPS, confirmar o proxy ou editar o DNS. Não foram emitidos comandos para a VPS, e a instalação do PetCore não foi alterada.

**Importante:** esse roteiro prepara a implantação; ainda será necessário validar o DNS, TLS, cronograma de backup, restauração, recursos do servidor e testes de produção antes de disponibilizar a clientes.

