import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';

const features = [
  { no: '01', title: 'Agenda e histórico', body: 'Consulte horários por dia, semana ou mês e registre confirmações, remarcações e cancelamentos.' },
  { no: '02', title: 'Serviços e profissionais', body: 'Defina duração, preço, expediente, intervalos e folgas de cada profissional.' },
  { no: '03', title: 'Clientes e recebimentos', body: 'Cadastre clientes, consulte atendimentos anteriores e registre valores recebidos.' }
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
            <p className="eyebrow"><span /> SISTEMA PARA SALÕES E BARBEARIAS</p>
            <h1 id="hero-title">Agenda, equipe e clientes <em>no mesmo sistema.</em></h1>
            <p className="hero__description">Configure horários de atendimento, receba agendamentos online e acompanhe serviços, profissionais e recebimentos.</p>
            <div className="hero__actions"><Link to="/cadastro" className="button button--primary">Criar minha conta <span aria-hidden="true">↗</span></Link></div>
            <div className="hero__note"><span className="hero__line" /> Os agendamentos respeitam o expediente do salão e dos profissionais.</div>
          </div>
          <div className="hero__art">
            <div className="hero__photo" role="img" aria-label="Interior de salão de beleza e barbearia" />
            <div className="hero__photo-caption"><span>01 / 03</span><span>Agenda de atendimentos</span></div>
            <div className="hero__decor" aria-hidden="true">B</div>
          </div>
        </div>
      </section>

      <section className="landing-intro" aria-label="Apresentação">
        <div className="site-container landing-intro__inner">
          <span>HORÁRIOS DE FUNCIONAMENTO</span>
          <p>Defina os dias e turnos de atendimento.<br /><strong>O cliente vê somente horários disponíveis.</strong></p>
        </div>
      </section>

      <section className="features-section" id="funcionalidades" aria-labelledby="features-heading">
        <div className="site-container">
          <div className="section-heading"><div><p className="eyebrow">FUNCIONALIDADES</p><h2 id="features-heading">Controle os atendimentos<br />do agendamento ao recebimento.</h2></div><p>Os dados e as permissões de cada estabelecimento ficam separados na plataforma.</p></div>
          <div className="features-grid">{features.map((item) => <article className="feature" key={item.no}><span className="feature__number">{item.no} /</span><div className="feature__drawing" aria-hidden="true"><span /><span /><span /></div><h3>{item.title}</h3><p>{item.body}</p></article>)}</div>
          <p className="development-note">A agenda permite consultar períodos futuros. Os agendamentos anteriores ficam disponíveis no histórico, em lista.</p>
        </div>
      </section>

      <section className="audience" id="para-quem" aria-labelledby="audience-heading">
        <div className="site-container"><div className="section-heading"><div><p className="eyebrow">ESTABELECIMENTOS</p><h2 id="audience-heading">Atendimento para salões<br />de beleza e barbearias.</h2></div></div>
          <div className="audience__grid">
            <article className="audience-card audience-card--salon"><div className="audience-card__photo" role="img" aria-label="Interior de salão de beleza" /><div className="audience-card__body"><span>01</span><h3>Salões de beleza</h3><p>Organize cortes, escovas, colorações e outros serviços por profissional e duração.</p></div></article>
            <article className="audience-card audience-card--barber"><div className="audience-card__photo" role="img" aria-label="Interior de barbearia" /><div className="audience-card__body"><span>02</span><h3>Barbearias</h3><p>Cadastre cortes e barbas, defina intervalos e consulte a disponibilidade de cada barbeiro.</p></div></article>
          </div>
        </div>
      </section>
      <section className="landing-plans" id="planos" aria-labelledby="plans-heading"><div className="site-container">
        <div className="section-heading"><div><p className="eyebrow">ASSINATURAS</p><h2 id="plans-heading">Planos mensal e anual.</h2></div><p>O pagamento recorrente é realizado no checkout do PagBank.</p></div>
        <div className="landing-plans__grid">
          <article><strong>PLANO MENSAL</strong><h3>Assinatura mensal</h3><p>Cobrança recorrente a cada mês, conforme as condições apresentadas pelo PagBank.</p></article>
          <article><strong>PLANO ANUAL</strong><h3>Assinatura anual</h3><p>Cobrança recorrente a cada ano, conforme as condições apresentadas pelo PagBank.</p></article>
        </div>
        <p className="landing-plans__disclaimer">Cadastre seu estabelecimento para acessar os links de assinatura no painel. Valores, condições e disponibilidade são confirmados no PagBank. A liberação depende de conferência do pagamento.</p>
      </div></section>
    </main>
    <footer className="site-footer"><div className="site-container site-footer__inner"><Logo inverse={true} link={false} /><p>Agenda e gestão para salões e barbearias.</p><small>© {new Date().getFullYear()} Beauty Barber Studio</small></div></footer>
  </div>;
}

