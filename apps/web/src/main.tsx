import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { SignIn } from './pages/SignIn';
import { SignUp } from './pages/SignUp';
import { Dashboard } from './pages/Dashboard';
import { ServicesPage } from './pages/ServicesPage';
import { ProfessionalsPage } from './pages/ProfessionalsPage';
import { CustomersPage } from './pages/CustomersPage';
import { BillingPage } from './pages/BillingPage';
import { PlatformBillingPage } from './pages/PlatformBillingPage';
import { PlatformEstablishmentsPage } from './pages/PlatformEstablishmentsPage';
import { CalendarPage } from './pages/CalendarPage';
import { AppointmentHistoryPage } from './pages/AppointmentHistoryPage';
import { MyAgendaPage } from './pages/MyAgendaPage';
import { PublicBookingPage } from './pages/PublicBookingPage';
import { PublicBookingActionPage } from './pages/PublicBookingActionPage';
import { ReportsPage } from './pages/ReportsPage';
import { ReceiptsPage } from './pages/ReceiptsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordPages';
import { AcceptInvitationPage } from './pages/AcceptInvitationPage';
import './styles/main.scss';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/entrar" element={<SignIn />} />
        <Route path="/cadastro" element={<SignUp />} />
        <Route path="/painel" element={<Dashboard />} />
        <Route path="/painel/servicos" element={<ServicesPage />} />
        <Route path="/painel/profissionais" element={<ProfessionalsPage />} />
        <Route path="/painel/clientes" element={<CustomersPage />} />
        <Route path="/painel/assinatura" element={<BillingPage />} />
        <Route path="/painel/agenda" element={<CalendarPage />} />
        <Route path="/painel/historico" element={<AppointmentHistoryPage />} />
        <Route path="/painel/minha-agenda" element={<MyAgendaPage />} />
        <Route path="/painel/recebimentos" element={<ReceiptsPage />} />
        <Route path="/painel/relatorios" element={<ReportsPage />} />
        <Route path="/painel/configuracoes" element={<SettingsPage />} />
        <Route path="/plataforma/cobrancas" element={<PlatformBillingPage />} />
        <Route path="/plataforma/estabelecimentos" element={<PlatformEstablishmentsPage />} />
        <Route path="/agendar/confirmar" element={<PublicBookingActionPage action="confirm" />} />
        <Route path="/agendar/cancelar" element={<PublicBookingActionPage action="cancel" />} />
        <Route path="/agendar/:slug" element={<PublicBookingPage />} />
        <Route path="/esqueci-senha" element={<ForgotPasswordPage />} />
        <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
        <Route path="/convite" element={<AcceptInvitationPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

