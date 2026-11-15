import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { apiRequest } from '../lib/api';
import { DEFAULT_TIMEZONE, todayInZone } from '../lib/dates';

type Service = { id: string; name: string; description: string | null; durationMinutes: number; priceCents: number; category: string };
type Professional = { id: string; fullName: string; serviceIds: string[] };
type EstablishmentResponse = { establishment: { name: string; slug: string; timezone: string; hasLogo: boolean }; services: Service[]; professionals: Professional[]; onlineBookingEnabled: boolean };
type Availability = { items: { professionalId: string; professionalName: string; slots: { time: string; startsAt: string }[] }[] };

const addDays = (date: string, days: number) => {
  const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + days); return next.toISOString().slice(0, 10);
};

export function PublicBookingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<EstablishmentResponse | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const [date, setDate] = useState(todayInZone);
  const [slot, setSlot] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [loading, setLoading] = useState(true);
  const [fetchingSlots, setFetchingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiRequest<EstablishmentResponse>(`/api/public/establishments/${encodeURIComponent(slug ?? '')}`)
      .then((response) => { if (active) { setData(response); setDate(todayInZone(response.establishment.timezone)); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Este estabelecimento não está disponível.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    if (!serviceId || !date || !slug) { setAvailability(null); return; }
    let active = true; setFetchingSlots(true); setSlot('');
    const qs = new URLSearchParams({ serviceId, date });
    if (professionalId) qs.set('professionalId', professionalId);
    apiRequest<Availability>(`/api/public/establishments/${encodeURIComponent(slug)}/availability?${qs}`)
      .then((response) => { if (active) setAvailability(response); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível buscar horários.'); })
      .finally(() => { if (active) setFetchingSlots(false); });
    return () => { active = false; };
  }, [serviceId, date, professionalId, slug]);

  const slots = useMemo(() => availability?.items.flatMap((professional) => professional.slots.map((item) => ({ ...item, professionalId: professional.professionalId, professionalName: professional.professionalName })))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.professionalName.localeCompare(b.professionalName)) ?? [], [availability]);
  const selectedSlot = slots.find((item) => `${item.professionalId}::${item.startsAt}` === slot);
  const timezone = data?.establishment.timezone ?? DEFAULT_TIMEZONE;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedSlot || !slug) return;
    setError(''); setSubmitting(true);
    try {
      await apiRequest(`/api/public/establishments/${encodeURIComponent(slug)}/requests`, {
        method: 'POST', body: JSON.stringify({ serviceId, professionalId: selectedSlot.professionalId,
          startsAt: selectedSlot.startsAt, fullName, email, website })
      });
      setSent(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível solicitar agendamento.'); }
    finally { setSubmitting(false); }
  }

  if (loading) return <div className="page-state" role="status">Carregando agendamento online…</div>;
  return <div className="public-booking">
    <header className="public-booking__header"><Logo /></header>
    <main className="public-booking__main">
      {error && <p className="form-error" role="alert">{error}</p>}
      {!data ? <div className="public-booking__panel"><h1>Estabelecimento indisponível.</h1><p>Confira o endereço do link com o estabelecimento.</p></div> : <>
        <p className="eyebrow">AGENDAMENTO ONLINE</p><h1>Seu próximo horário, com tranquilidade.</h1>
        {data.establishment.hasLogo && <img className="public-booking__business-logo" src={`/api/branding/${encodeURIComponent(data.establishment.slug)}/logo`} alt={`Logotipo de ${data.establishment.name}`} />}
        <p className="public-booking__intro">{data.establishment.name}</p>
        {sent ? <section className="public-booking__panel" role="status"><h2>Confira seu e-mail</h2><p>Enviamos um link de confirmação para <strong>{email}</strong>. Ele expira em 20 minutos. O horário ainda não está reservado; clique no link assim que recebê-lo.</p></section>
          : !data.onlineBookingEnabled ? <section className="public-booking__panel"><h2>Agendamento online temporariamente indisponível</h2><p>O estabelecimento ainda não habilitou a confirmação segura por e-mail. Consulte diretamente os canais de atendimento informados pelo estabelecimento.</p></section>
          : <form className="public-booking__panel" onSubmit={submit}>
            <div className="public-booking__step"><span>01</span><div><h2>Qual serviço você deseja?</h2><label className="sr-only" htmlFor="public-service">Serviço</label><select id="public-service" required value={serviceId} onChange={(e) => { setServiceId(e.target.value); setProfessionalId(''); }}><option value="">Selecione um serviço</option>{data.services.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.durationMinutes} min · {(item.priceCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</option>)}</select></div></div>
            <div className="public-booking__step"><span>02</span><div><h2>Com quem e em qual dia?</h2><div className="public-booking__row"><label>Profissional<select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}><option value="">Qualquer profissional disponível</option>{data.professionals.filter((item) => item.serviceIds.includes(serviceId)).map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label><label>Data<input type="date" required min={todayInZone(timezone)} max={addDays(todayInZone(timezone), 90)} value={date} onChange={(e) => setDate(e.target.value)} /></label></div></div></div>
            <div className="public-booking__step"><span>03</span><div><h2>Escolha um horário</h2>{fetchingSlots ? <p>Consultando disponibilidade…</p> : slots.length ? <fieldset className="public-booking__slots"><legend className="sr-only">Horários disponíveis</legend>{slots.map((item) => <label key={`${item.professionalId}::${item.startsAt}`} className={slot === `${item.professionalId}::${item.startsAt}` ? 'is-selected' : ''}><input type="radio" name="slot" value={`${item.professionalId}::${item.startsAt}`} checked={slot === `${item.professionalId}::${item.startsAt}`} onChange={(e) => setSlot(e.target.value)} /><strong>{item.time}</strong><small>{item.professionalName}</small></label>)}</fieldset> : <p>{serviceId ? 'Este estabelecimento não possui horários disponíveis para esta data. Escolha outro dia.' : 'Selecione um serviço para consultar os horários.'}</p>}</div></div>
            <div className="public-booking__step"><span>04</span><div><h2>Seus dados para confirmação</h2><div className="public-booking__row"><label>Nome completo<input required minLength={2} maxLength={120} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} /></label><label>E-mail<input type="email" required maxLength={255} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label></div>
              <div className="public-booking__honeypot" aria-hidden="true"><label>Site<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label></div>
              <p className="public-booking__privacy">Usaremos seu nome e e-mail apenas para processar o agendamento e comunicá-lo ao estabelecimento. O horário só será reservado após confirmar o e-mail.</p>
              <button type="submit" className="button button--primary" disabled={submitting || !selectedSlot}>{submitting ? 'Enviando…' : 'Enviar confirmação por e-mail'}</button>
            </div></div>
          </form>}
      </>}
    </main>
    <footer className="public-booking__footer">Agendamento por BeautyBarber · Seus dados são utilizados apenas para a finalidade informada.</footer>
  </div>;
}
