import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from './Logo';

export function AuthLayout({ children, title, description }: { children: ReactNode; title: string; description: string }) {
  return <main className="auth-layout">
    <section className="auth-form-panel">
      <div className="auth-form-panel__top"><Logo /><Link to="/" className="back-link">← Voltar ao início</Link></div>
      <div className="auth-form-panel__content"><p className="eyebrow">BEM-VINDO AO BEAUTYBARBER</p><h1>{title}</h1><p className="auth-description">{description}</p>{children}</div>
      <p className="auth-legal">Uma plataforma em construção, com atenção à sua privacidade.</p>
    </section>
    <aside className="auth-visual"><div className="auth-visual__photo" role="img" aria-label="Ambiente profissional de beleza, fotografia a integrar" /><div className="auth-visual__quote"><span>ESTILO & ORGANIZAÇÃO</span><p>O cuidado com o seu negócio começa pela forma como você organiza cada dia.</p><div className="auth-visual__rule" /></div></aside>
  </main>;
}

