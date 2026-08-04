/**
 * Helper para Geração de Contexto Temporal Dinâmico (15 Dias)
 * 
 * Este módulo fornece funções para gerar o bloco de calendário dinâmico
 * injetado automaticamente nos prompts dos agentes de IA (Clara, Bento, etc.).
 */

export interface TemporalContextOptions {
  days?: number;
  locale?: string;
}

/**
 * Gera a string formatada do calendário sistêmico de N dias (padrão: 15 dias).
 */
export function buildTemporalContext(options: TemporalContextOptions = {}): string {
  const { days = 15, locale = 'pt-BR' } = options;
  const now = new Date();
  const calendarItems: string[] = [];

  for (let i = 0; i <= days; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);

    // Formatação de dia da semana (ex: Seg, Ter, Qua)
    const rawDayName = d.toLocaleDateString(locale, { weekday: 'short' });
    const dayName = rawDayName.charAt(0).toUpperCase() + rawDayName.slice(1).replace('.', '');

    // Formatação da data (ex: 03/08)
    const dayNum = d.getDate().toString().padStart(2, '0');
    const monthNum = (d.getMonth() + 1).toString().padStart(2, '0');
    const dateStr = `${dayNum}/${monthNum}`;

    let tag = '';
    if (i === 0) tag = ' (Hoje)';
    else if (i === 1) tag = ' (Amanhã)';
    else if (i === 2) tag = ' (Depois de amanhã)';

    calendarItems.push(`${dayName} ${dateStr}${tag}`);
  }

  return `[CALENDÁRIO SISTÊMICO - PRÓXIMOS 15 DIAS]\n${calendarItems.join(' | ')}\n\n`;
}

/**
 * Código em JavaScript pronto para copiar e colar em um nó "Code" ou expressão do N8N:
 * 
 * ```javascript
 * const days = 15;
 * const now = new Date();
 * const list = [];
 * 
 * for (let i = 0; i <= days; i++) {
 *   const d = new Date(now);
 *   d.setDate(now.getDate() + i);
 *   const dayName = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
 *   const dateStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
 *   const tag = i === 0 ? ' (Hoje)' : i === 1 ? ' (Amanhã)' : i === 2 ? ' (Depois de amanhã)' : '';
 *   list.push(`${dayName.charAt(0).toUpperCase() + dayName.slice(1)} ${dateStr}${tag}`);
 * }
 * 
 * return `[CALENDÁRIO SISTÊMICO - PRÓXIMOS 15 DIAS]\n${list.join(' | ')}\n\n`;
 * ```
 */
