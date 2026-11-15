import { useEffect, useState, type FormEvent } from 'react';
import { todayInZone } from '../lib/dates';
import type { OpeningPeriod } from './OpeningHoursEditor';

export type SpecialPeriod = { startMinute: number; endMinute: number };
export type SpecialDay = { date: string; closed: boolean; periods: SpecialPeriod[] };

const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2,'0')}:${String(minute % 60).padStart(2,'0')}`;
const minute = (value: string) => { const [h,m] = value.split(':').map(Number); return h * 60 + m; };
const plusYear = (date: string) => {
  const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 365);
  return next.toISOString().slice(0,10);
};

export function SpecialHoursEditor({ weekly, exceptions, timezone, disabled, onSave, onRestore }: {
  weekly: OpeningPeriod[];
  exceptions: SpecialDay[];
  timezone: string;
  disabled: boolean;
  onSave: (date: string, details: { closed: boolean; periods: SpecialPeriod[] }) => Promise<void>;
  onRestore: (date: string) => Promise<void>;
}) {
  const [date, setDate] = useState(() => todayInZone(timezone));
  const [closed, setClosed] = useState(false);
  const [periods, setPeriods] = useState<SpecialPeriod[]>([]);
  const minDate = todayInZone(timezone);
  const current = exceptions.find((item) => item.date === date);

  useEffect(() => {
    if (date < minDate) { setDate(minDate); return; }
    const existing = exceptions.find((item) => item.date === date);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const regular = weekly.filter((item) => item.weekday === weekday)
      .map((item) => ({startMinute:item.startMinute,endMinute:item.endMinute}));
    const chosen = existing ? existing.periods : regular;
    setClosed(existing ? existing.closed : regular.length === 0);
    setPeriods(chosen);
  }, [date, exceptions, weekly, minDate]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave(date,{closed,periods:closed?[]:periods});
  }

  return <>
    <p className="management-hint">Use para feriados, eventos ou dias em que deseja abrir ou fechar em outro horário. A mudança vale apenas para a data selecionada e não altera o funcionamento semanal.</p>
    <form className="hours-form" onSubmit={(event) => void submit(event)}>
      <label>Data especial<input required type="date" min={minDate} max={plusYear(minDate)} value={date} disabled={disabled} onChange={(event) => setDate(event.target.value)} /></label>
      <p className="management-hint">{current ? 'Há um horário especial salvo para esta data.' : 'Esta data ainda segue o funcionamento semanal.'}</p>
      <label className="form-checkbox"><input type="checkbox" checked={closed} disabled={disabled} onChange={(event) => {setClosed(event.target.checked); if (!event.target.checked && periods.length === 0) setPeriods([{startMinute:540,endMinute:1080}]);}} />Fechar completamente nesta data</label>
      {!closed && <>
        {periods.map((period,index) => <div className="hours-row" key={index}>
          <label>Abre às<input type="time" required disabled={disabled} value={time(period.startMinute)} onChange={(event) => setPeriods(periods.map((item,i)=>i===index?{...item,startMinute:minute(event.target.value)}:item))} /></label>
          <label>Fecha às<input type="time" required disabled={disabled} value={time(period.endMinute)} onChange={(event) => setPeriods(periods.map((item,i)=>i===index?{...item,endMinute:minute(event.target.value)}:item))} /></label>
          {!disabled && <button type="button" className="record-link" onClick={()=>setPeriods(periods.filter((_,i)=>i!==index))}>Remover intervalo</button>}
        </div>)}
        {!disabled && <button className="button button--secondary" type="button" disabled={periods.length>=4} onClick={()=>setPeriods([...periods,{startMinute:540,endMinute:1080}])}>Adicionar intervalo</button>}
      </>}
      {!disabled && <div className="management-form__actions">
        {current && <button className="button button--secondary" type="button" onClick={()=>void onRestore(date)}>Restaurar horário semanal</button>}
        <button className="button button--primary" type="submit" disabled={!closed && periods.length===0}>Salvar horário especial</button>
      </div>}
    </form>
    {exceptions.length > 0 && <div className="record-table-wrap"><table className="record-table"><thead><tr><th>Datas especiais cadastradas</th><th>Funcionamento</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{exceptions.map((item)=><tr key={item.date}><td>{new Date(`${item.date}T12:00:00Z`).toLocaleDateString('pt-BR',{timeZone:'UTC'})}</td><td>{item.closed?'Fechado':item.periods.map((period)=>`${time(period.startMinute)}–${time(period.endMinute)}`).join(' / ')}</td><td><button type="button" className="record-link" disabled={disabled} onClick={()=>setDate(item.date)}>Ver data</button></td></tr>)}</tbody></table></div>}
  </>;
}
