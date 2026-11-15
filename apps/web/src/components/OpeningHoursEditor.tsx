export type OpeningPeriod = { weekday: number; startMinute: number; endMinute: number };

const days = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const minuteToTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2,'0')}:${String(minute % 60).padStart(2,'0')}`;
const timeToMinute = (value: string) => { const [hours,minutes] = value.split(':').map(Number); return hours * 60 + minutes; };

export function OpeningHoursEditor({ periods, onChange, disabled }: {
  periods: OpeningPeriod[]; onChange: (next: OpeningPeriod[]) => void; disabled: boolean;
}) {
  const sundayOpen = periods.some((period) => period.weekday === 0);
  return <>
    <p className="management-hint">Defina os dias e horários em que o estabelecimento recebe clientes. Cada profissional terá seu próprio expediente, mas nenhum atendimento poderá ser agendado fora do horário do salão. Dias sem horários são considerados fechados.</p>
    {periods.length === 0 && !disabled && <button type="button" className="button button--secondary" onClick={() => onChange([1,2,3,4,5,6].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1080 })))}>Preencher segunda a sábado (09h–18h)</button>}
    <label className="form-checkbox"><input type="checkbox" checked={sundayOpen} disabled={disabled || (periods.length >= 28 && !sundayOpen)} onChange={(event) => onChange(event.target.checked ? [...periods, { weekday: 0, startMinute: 540, endMinute: 1080 }] : periods.filter((period) => period.weekday !== 0))} />Abrir aos domingos (opcional)</label>
    <p className="management-hint">{sundayOpen ? 'Domingo aberto: configure o horário correspondente abaixo.' : 'Domingo fechado: a página de agendamento não oferecerá vagas nesse dia.'}</p>
    <div className="hours-form">
      {periods.map((period, index) => <div className="hours-row" key={`${index}-${period.weekday}`}>
        <label>Dia<select disabled={disabled} value={period.weekday} onChange={(event) => onChange(periods.map((item, i) => i === index ? { ...item, weekday: Number(event.target.value) } : item))}>{days.map((day, dayIndex) => <option key={dayIndex} value={dayIndex}>{day}</option>)}</select></label>
        <label>Abre às<input type="time" required disabled={disabled} value={minuteToTime(period.startMinute)} onChange={(event) => onChange(periods.map((item,i) => i === index ? { ...item, startMinute: timeToMinute(event.target.value) } : item))} /></label>
        <label>Fecha às<input type="time" required disabled={disabled} value={minuteToTime(period.endMinute)} onChange={(event) => onChange(periods.map((item,i) => i === index ? { ...item, endMinute: timeToMinute(event.target.value) } : item))} /></label>
        {!disabled && <button type="button" className="record-link" onClick={() => onChange(periods.filter((_,i) => i !== index))}>Remover turno</button>}
      </div>)}
      {!disabled && <button type="button" className="button button--secondary" disabled={periods.length >= 28} onClick={() => onChange([...periods, { weekday: 1, startMinute: 540, endMinute: 1080 }])}>Adicionar turno</button>}
    </div>
  </>;
}
