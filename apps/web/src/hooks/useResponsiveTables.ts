import { useEffect, useRef } from 'react';

/**
 * Mantém o cabeçalho semântico da tabela e associa seus rótulos às células
 * quando o CSS apresenta cada registro como cartão numa tela estreita.
 */
export function useResponsiveTables() {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    function labelCells() {
      root?.querySelectorAll<HTMLTableElement>('table.record-table').forEach((table) => {
        const headers = Array.from(table.tHead?.rows[0]?.cells ?? [], (cell) => cell.textContent?.trim() || 'Ações');
        Array.from(table.tBodies).forEach((body) => {
          Array.from(body.rows).forEach((row) => {
            Array.from(row.cells).forEach((cell, index) => {
              const label = headers[index] || 'Detalhes';
              if (cell.dataset.label !== label) cell.dataset.label = label;
            });
          });
        });
      });
    }

    const observer = new MutationObserver(labelCells);
    observer.observe(root, { childList: true, subtree: true });
    labelCells();
    return () => observer.disconnect();
  }, []);

  return contentRef;
}
