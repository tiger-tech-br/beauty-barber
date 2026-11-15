import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';

const features = [
  { no: '01', title: 'Agenda em um só lugar', body: 'Visualize horários, organize serviços e acompanhe a rotina sem depender de anotações dispersas.' },
  { no: '02', title: 'Organização da equipe', body: 'Uma estrutura para profissionais, expedientes e atendimentos com informações claras.' },
  { no: '03', title: 'Experiência para o cliente', body: 'Uma jornada de agendamento digital simples, feita para funcionar bem no celular.' }
];

export function Landing() {
  return <div className="landing">
    <header className="site-header">
      <div className="site-container site-header__inner">
        <Logo />
        <nav aria-label="Navegação principal" className="site-nav">
          <a href="#funcionalidades">Funcionalidades</a>
          <a href="#para-quem">Para quem é</a>
          <a href="#planos">Planos</a>
          <Link className="nav-signin" to="/entrar">Entrar <span aria-hidden="true">↗</span></Link>
        </nav>
      </div>
    </header>

    <main>
      <section className="hero" aria-labelledby="hero-title">
        <div className="site-container hero__grid">
          <div className="hero__content">
            <p className="eyebrow"><span /> GESTÃO PARA PROFISSIONAIS DE BELEZA</p>
            <h1 id="hero-title">Seu talento merece uma rotina mais <em>leve.</em></h1>
            <p className="hero__description">Da agenda à organização do seu espaço: construa uma operação mais tranquila, com tudo no lugar certo.</p>
            <div className="hero__actions"><Link to="/cadastro" className="button button--primary">Criar minha conta <span aria-hidden="true">↗</span></Link></div>
            <div className="hero__note"><span className="hero__line" /> Uma plataforma para quem cuida de cada detalhe.</div>
          </div>
          <div className="hero__art">
            <div className="hero__photo" role="img" aria-label="Ambiente sofisticado de salão de beleza e barbearia, fotografia a integrar" />
            <div className="hero__photo-caption"><span>01 / 03</span><span>Rotinas bem cuidadas, todos os dias.</span></div>
            <div className="hero__decor" aria-hidden="true">B</div>
          </div>
        </div>
      </section>

      <section className="landing-intro" aria-label="Apresentação">
        <div className="site-container landing-intro__inner">
          <span>O SEU ESPAÇO, NO SEU RITMO</span>
          <p>Menos tempo organizando o dia.<br /><strong>Mais presença em cada atendimento.</strong></p>
        </div>
      </section>

      <section className="features-section" id="funcionalidades" aria-labelledby="features-heading">
        <div className="site-container">
          <div className="section-heading"><div><p className="eyebrow">O QUE IMPORTA, ORGANIZADO</p><h2 id="features-heading">Uma rotina com espaço<br />para o que você faz melhor.</h2></div><p>Uma base prática para simplificar o dia a dia, do primeiro horário ao último cliente.</p></div>
          <div className="features-grid">{features.map((item) => <article className="feature" key={item.no}><span className="feature__number">{item.no} /</span><div className="feature__drawing" aria-hidden="true"><span /><span /><span /></div><h3>{item.title}</h3><p>{item.body}</p></article>)}</div>
          <p className="development-note">Cadastros de serviços e equipe já estão na primeira versão. O calendário de agendamentos está em desenvolvimento.</p>
        </div>
      </section>

      <section className="audience" id="para-quem" aria-labelledby="audience-heading">
        <div className="site-container"><div className="section-heading"><div><p className="eyebrow">FEITA PARA A SUA REALIDADE</p><h2 id="audience-heading">Seu negócio tem personalidade.<br />Sua gestão também pode ter.</h2></div></div>
          <div className="audience__grid">
            <article className="audience-card audience-card--salon"><div className="audience-card__photo" role="img" aria-label="Salão de beleza moderno, fotografia a integrar" /><div className="audience-card__body"><span>01</span><h3>Salões de beleza</h3><p>Do corte à coloração, uma visão mais clara da agenda e da equipe.</p></div></article>
            <article className="audience-card audience-card--barber"><div className="audience-card__photo" role="img" aria-label="Barbearia moderna, fotografia a integrar" /><div className="audience-card__body"><span>02</span><h3>Barbearias</h3><p>Agilidade na organização e mais atenção a quem senta na cadeira.</p></div></article>
          </div>
        </div>
      </section>
      <section className="landing-plans" id="planos" aria-labelledby="plans-heading"><div className="site-container">
        <div className="section-heading"><div><p className="eyebrow">ASSINATURAS</p><h2 id="plans-heading">Um ritmo para cada negócio.</h2></div><p>O BeautyBarber oferece opções de pagamento recorrente pelo PagBank.</p></div>
        <div className="landing-plans__grid">
          <article><strong>PLANO MENSAL</strong><h3>Organize mês após mês.</h3><p>Cobrança automática com recorrência mensal, conforme as condições apresentadas pelo PagBank.</p></article>
          <article><strong>PLANO ANUAL</strong><h3>Planeje o ano inteiro.</h3><p>Cobrança recorrente com frequência anual, com condições disponíveis no checkout.</p></article>
        </div>
        <p className="landing-plans__disclaimer">Cadastre seu estabelecimento para acessar os links de assinatura no painel. Valores, condições e disponibilidade são confirmados no PagBank. A liberação depende de conferência do pagamento.</p>
      </div></section>
    </main>
    <footer className="site-footer"><div className="site-container site-footer__inner"><Logo inverse={true} link={false} /><p>Gestão simples, cuidado em cada detalhe.</p><small>© {new Date().getFullYear()} BeautyBarber</small></div></footer>
  </div>;
}

