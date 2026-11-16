# Beauty Barber Studio no Android — APK

O aplicativo Android do Beauty Barber Studio fica em `android-beautybarber/` e abre o **mesmo site HTTPS** onde estão o frontend e a API. Assim, o login, as sessões, o agendamento e as assinaturas usam a mesma origem e os mesmos dados do Beauty Barber Studio. O aplicativo não usa banco local ou acesso ao PetCore.

## Antes do APK final

1. Publicar e validar o Beauty Barber Studio em subdomínio HTTPS próprio na Hostinger VPS, sem alterar o proxy e o banco do PetCore.
2. Ter um computador com Android Studio, Android SDK Platform 35, Java 17+ e Gradle 8.13 instalado. O diretório contém o projeto Android nativo; não precisa instalar Capacitor.
3. Origem aprovada pelo proprietário: `https://beautybarber.tigertech.dev.br`. Ela já é o destino padrão do projeto Android. O aplicativo **não funciona** até que esse endereço tenha DNS e HTTPS válidos e o site esteja efetivamente publicado. O APK compilado antes disso não deve ser distribuído.

## Compilação local

1. Abra a pasta `android-beautybarber` no Android Studio e aguarde sincronizar o Gradle. Instale as dependências do Android SDK solicitadas pelo programa.
2. O projeto já aponta para o subdomínio aprovado. Se quiser informá-lo explicitamente na compilação, execute o Gradle 8.13 no terminal:

   ```powershell
   cd android-beautybarber
   gradle :app:assembleDebug -PbeautybarberUrl=https://beautybarber.tigertech.dev.br
   ```

3. Quando a compilação for concluída, o APK de desenvolvimento estará em `android-beautybarber/app/build/outputs/apk/debug/app-debug.apk`.
4. Abra o APK no seu celular Android e teste login, navegação, agendamento e link externo do PagBank. Teste também offline/online e o botão Voltar.

O build de debug é **assinado automaticamente com a chave de desenvolvimento Android**. Para distribuir comercialmente, gere e guarde seu próprio keystore de release, configure a assinatura na máquina de publicação e gere um APK/AAB de release. **Não inclua o keystore nem senhas no Git ou no ZIP.**

Se o Gradle não estiver instalado no terminal, o projeto pode ser compilado pelo Android Studio após configurar o Gradle na sua máquina.

## APK de teste pelo GitHub Actions

O repositório `tiger-tech-br/beauty-barber` compila automaticamente um **APK de desenvolvimento** quando o projeto Android ou seu workflow mudam na branch `main`. Também é possível iniciar uma execução manual em **Actions → Beauty Barber Studio APK debug → Run workflow**, informando a origem HTTPS.

Depois de uma execução bem-sucedida:

1. Abra **Actions → Beauty Barber Studio APK debug** e escolha a execução concluída.
2. Na seção **Artifacts**, baixe `beautybarber-apk-debug`.
3. Extraia o ZIP. Nele estarão `app-debug.apk` e `app-debug.apk.sha256`, que permite conferir o hash do arquivo.
4. Esse APK utiliza `https://beautybarber.tigertech.dev.br` como destino padrão. **A compilação pode passar mesmo que o site ainda não esteja publicado.** Nesse caso, o aplicativo exibirá erro de conexão; não distribua nem venda o APK até validar DNS, HTTPS, login e agendamento no celular real.

O artefato fica disponível no GitHub por **14 dias**. É um build de teste assinado com chave de desenvolvimento, não um lançamento comercial. O APK definitivo exigirá keystore privada de release e testes reais.

## Segurança

- Somente HTTPS: tráfego HTTP desabilitado; conteúdo misto bloqueado.
- O WebView aceita navegação interna exclusivamente no domínio escolhido. Links externos HTTPS e `mailto:` abrem outro aplicativo — incluindo o checkout PagBank.
- Cookies de sessão permanecem sob a política do domínio HTTPS. Não há senha de usuário ou segredo do servidor no APK.
- A origem injetada no build é validada: não permite HTTP, credenciais na URL, porta arbitrária ou caminhos.
- Nenhum APK final foi compilado aqui: a origem está definida, mas o site ainda não está publicado e não há Android SDK acessível neste ambiente.
